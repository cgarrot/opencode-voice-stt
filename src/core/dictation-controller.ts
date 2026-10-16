import type { AudioRecorder, RecordingHandle } from "../audio/types";
import type { PluginConfig } from "../config/types";
import { validateAudioFile } from "../audio/file";
import { assertProviderReady } from "../providers/readiness";
import type { Strings } from "../i18n/strings";
import { formatError } from "../utils/text";
import { formatTranscriptForPrompt } from "./output";
import { transcribeAudioPath, type TranscriptionServices } from "./transcribe";

export type DictationMode = "idle" | "recording" | "processing" | "polishing";

export type DictationToast = {
  variant?: "info" | "success" | "warning" | "error";
  title?: string;
  message: string;
  duration?: number;
};

export type DictationControllerOptions = TranscriptionServices & {
  keybind: string;
  strings: Strings;
  loadConfig(): Promise<PluginConfig>;
  createRecorder(config: PluginConfig): AudioRecorder;
  /** Append text to the active prompt (host-specific delivery lives outside). */
  appendPrompt(text: string): Promise<unknown>;
  /** Submit the active prompt to chat. */
  submitPrompt(): Promise<unknown>;
  notify(toast: DictationToast): void;
  onModeChange?(mode: DictationMode): void;
  onError(error: unknown): void;
};

type StopRecordingOptions = {
  submitAfterAppend?: boolean;
};

type TranscribeFileOptions = {
  cwd?: string;
  signal?: AbortSignal | undefined;
  insertIntoPrompt?: boolean;
};

// OpenCode applies prompt mutations through the TUI event loop; wait a short
// frame so the prompt store sees the inserted transcript before we submit.
const PROMPT_APPEND_FLUSH_DELAY_MS = 50;

const waitForPromptAppendFlush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, PROMPT_APPEND_FLUSH_DELAY_MS);
  });

export const createDictationController = (options: DictationControllerOptions) => {
  let recording: RecordingHandle | undefined;
  let recordingConfig: PluginConfig | undefined;
  let activeRecordingHandle: RecordingHandle | undefined;
  let activeOperation: Promise<unknown> | undefined;
  let transcriptionController: AbortController | undefined;
  let processing = false;
  let cancelRequested = false;
  let mode: DictationMode = "idle";
  let disposed = false;

  const setMode = (nextMode: DictationMode) => {
    if (disposed && nextMode !== "idle") return;
    mode = nextMode;
    options.onModeChange?.(nextMode);
  };

  const notify = (toast: DictationToast) => {
    if (!disposed) options.notify(toast);
  };

  const appendPrompt = async (text: string) => {
    if (disposed || !text) return;
    await options.appendPrompt(text);
  };

  const submitPrompt = async () => {
    if (disposed) return;
    await options.submitPrompt();
  };

  const transcribe = (audioPath: string, config: PluginConfig, signal: AbortSignal, processVoiceCommands: boolean) =>
    transcribeAudioPath({
      audioPath,
      config,
      signal,
      processVoiceCommands,
      createProvider: options.createProvider,
      createCleanup: options.createCleanup,
      onPolishing: () => setMode("polishing"),
      onCleanupFailed: () => notify({ title: "OpenCode Voice STT", message: options.strings.toast.cleanupFailed, variant: "warning" }),
    });

  const deliverTranscript = async (config: PluginConfig, result: { text: string; command: "send" | "clear" | "newline" | null }, submitAfterAppend: boolean) => {
    if (result.command === "clear") {
      notify({ title: "OpenCode Voice STT", message: options.strings.toast.cleared, variant: "info" });
      return;
    }

    const formatted = formatTranscriptForPrompt(result.text, config.output);
    if (!formatted) {
      notify({ title: "OpenCode Voice STT", message: options.strings.toast.emptyTranscript, variant: "warning" });
      return;
    }

    await appendPrompt(formatted);
    if (result.command === "newline") await appendPrompt("\n");

    const shouldSubmit = submitAfterAppend || result.command === "send";
    if (shouldSubmit) {
      // Give the host a beat to flush the appended text into the prompt store.
      await waitForPromptAppendFlush();
      await submitPrompt();
    }
    if (!cancelRequested) {
      notify({
        title: "OpenCode Voice STT",
        message: shouldSubmit ? options.strings.toast.sent : options.strings.toast.inserted,
        variant: "success",
      });
    }
  };

  const stopActiveRecording = async (active: RecordingHandle, config: PluginConfig, stopOptions: StopRecordingOptions) => {
    const controller = new AbortController();
    transcriptionController = controller;

    try {
      notify({ title: "OpenCode Voice STT", message: options.strings.toast.stopping, variant: "info" });
      const audioPath = await active.stop();
      if (disposed) return;
      try {
        const result = await transcribe(audioPath, config, controller.signal, true);
        if (cancelRequested || disposed) return;
        await deliverTranscript(config, result, Boolean(stopOptions.submitAfterAppend));
      } catch (error) {
        if (cancelRequested || disposed) return;
        throw new Error(
          `Transcription failed (${config.provider.type}/${config.provider.model}): ${formatError(error)}`,
          { cause: error },
        );
      }
    } finally {
      if (transcriptionController === controller) transcriptionController = undefined;
      await active.dispose();
    }
  };

  const transcribeFile = async (path: string, fileOptions: TranscribeFileOptions = {}) => {
    if (disposed) throw new Error("OpenCode Voice STT has been disposed.");
    if (recording || processing) throw new Error("OpenCode Voice STT is busy. Stop or cancel the current recording/transcription first.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    fileOptions.signal?.addEventListener("abort", abort, { once: true });
    if (fileOptions.signal?.aborted) abort();
    transcriptionController = controller;
    processing = true;
    setMode("processing");

    const operation = (async () => {
      controller.signal.throwIfAborted();
      const file = await validateAudioFile(path, fileOptions.cwd ?? process.cwd());
      const config = await options.loadConfig();
      controller.signal.throwIfAborted();
      try {
        assertProviderReady(config.provider);
        const result = await transcribe(file.path, config, controller.signal, false);
        controller.signal.throwIfAborted();
        if (fileOptions.insertIntoPrompt) {
          await deliverTranscript(config, { ...result, command: null }, false);
        }
        return { text: result.text, provider: config.provider.type, model: config.provider.model, path: file.path };
      } catch (error) {
        throw new Error(`Transcription failed (${config.provider.type}/${config.provider.model}) for "${file.path}" (${file.size} bytes): ${formatError(error)}`, {
          cause: error,
        });
      }
    })();
    activeOperation = operation;
    try {
      return await operation;
    } finally {
      fileOptions.signal?.removeEventListener("abort", abort);
      if (transcriptionController === controller) transcriptionController = undefined;
      if (activeOperation === operation) activeOperation = undefined;
      processing = false;
      cancelRequested = false;
      setMode("idle");
    }
  };

  const stopRecording = async (stopOptions: StopRecordingOptions = {}) => {
    if (disposed) return;
    if (processing) {
      notify({ title: "OpenCode Voice STT", message: options.strings.toast.stillProcessing, variant: "warning" });
      return;
    }

    if (!recording) return;

    processing = true;
    setMode("processing");
    const active = recording;
    const activeConfig = recordingConfig;
    recording = undefined;
    recordingConfig = undefined;
    activeRecordingHandle = active;
    if (active.timeout) clearTimeout(active.timeout);

    const operation = activeConfig
      ? stopActiveRecording(active, activeConfig, stopOptions)
      : Promise.reject(new Error("Recording config was not available."));
    activeOperation = operation;
    try {
      await operation;
    } catch (error) {
      if (!cancelRequested && !disposed) throw error;
    } finally {
      if (activeOperation === operation) activeOperation = undefined;
      if (activeRecordingHandle === active) activeRecordingHandle = undefined;
      processing = false;
      cancelRequested = false;
      setMode("idle");
    }
  };

  const cancelActiveRecording = async (active: RecordingHandle) => {
    if (active.timeout) clearTimeout(active.timeout);
    await active.dispose();
  };

  const cancel = async () => {
    if (disposed) return;

    if (recording && !processing) {
      cancelRequested = true;
      const active = recording;
      recording = undefined;
      recordingConfig = undefined;
      await cancelActiveRecording(active);
      cancelRequested = false;
      setMode("idle");
      notify({ title: "OpenCode Voice STT", message: options.strings.toast.recordingCancelled, variant: "info" });
      return;
    }

    if (processing) {
      cancelRequested = true;
      transcriptionController?.abort();
      if (activeRecordingHandle) {
        await activeRecordingHandle.dispose().catch(() => {});
      }
      notify({ title: "OpenCode Voice STT", message: options.strings.toast.transcriptionCancelled, variant: "info" });
      try {
        await activeOperation;
      } catch {
        // stopRecording handles aborted transcription.
      }
    }
  };

  const startRecording = async () => {
    if (disposed) return;
    processing = true;
    try {
      const config = await options.loadConfig();
      if (disposed) return;
      assertProviderReady(config.provider);
      const recorder = options.createRecorder(config);
      recording = await recorder.start();
      recordingConfig = config;
      recording.timeout = setTimeout(() => {
        if (!recording || processing || disposed) return;
        void stopRecording().catch((error) => options.onError(error));
      }, config.capture.maxSeconds * 1000);
      setMode("recording");
      notify({
        title: "OpenCode Voice STT",
        message: options.strings.toast.startRecording(options.keybind),
        variant: "info",
        duration: 5000,
      });
    } finally {
      processing = false;
    }
  };

  let lastToggleTime = 0;
  const toggle = async () => {
    const now = Date.now();
    if (now - lastToggleTime < 400) return;
    lastToggleTime = now;
    if (recording || processing) {
      await stopRecording();
      return;
    }
    await startRecording();
  };

  const dispose = async () => {
    disposed = true;
    transcriptionController?.abort();
    const operation = activeOperation;
    if (!recording) {
      const active = activeRecordingHandle;
      if (active) await active.dispose().catch(() => {});
      await operation?.catch(() => {});
      setMode("idle");
      return;
    }
    const active = recording;
    recording = undefined;
    recordingConfig = undefined;
    if (active.timeout) clearTimeout(active.timeout);
    await active.dispose();
    await operation?.catch(() => {});
    setMode("idle");
  };

  return {
    transcribeFile,
    toggle,
    stop: () => stopRecording(),
    stopAndSend: () => stopRecording({ submitAfterAppend: true }),
    cancel,
    dispose,
    getMode: () => mode,
  };
};

export type DictationController = ReturnType<typeof createDictationController>;
