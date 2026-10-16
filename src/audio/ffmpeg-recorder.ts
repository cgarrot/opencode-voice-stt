import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FfmpegCaptureConfig } from "../config/types";
import { formatError, truncate } from "../utils/text";
import type { AudioRecorder, RecordingHandle } from "./types";
import { maxPcm16LeAmplitude, SILENCE_MAX_AMPLITUDE } from "./wav";

const MAX_STDERR_BYTES = 24 * 1024;

const collectStderr = (stream: NodeJS.ReadableStream): (() => string) => {
  let stderr = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    stderr += chunk;
    if (Buffer.byteLength(stderr, "utf8") > MAX_STDERR_BYTES) {
      stderr = stderr.slice(-MAX_STDERR_BYTES);
    }
  });
  return () => stderr;
};

const waitForExit = (process: ChildProcess): Promise<string> => {
  return new Promise((resolve) => {
    process.once("error", (error) => resolve(`process error: ${formatError(error)}`));
    process.once("close", (code, signal) => resolve(signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`));
  });
};

export const createFfmpegRecorder = (config: FfmpegCaptureConfig): AudioRecorder => ({
  start() {
    const tempDir = mkdtempSync(join(tmpdir(), "opencode-voice-stt-"));
    const outputPath = join(tempDir, "recording.wav");
    const isDshow = config.inputFormat === "dshow";
    const args = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-f",
      config.inputFormat,
      ...(isDshow ? ["-audio_buffer_size", "20"] : []),
      "-i",
      config.input,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      String(config.sampleRate),
      "-ac",
      String(config.channels),
      "-y",
      outputPath,
    ];
    const child = spawn(config.ffmpegPath, args, {
      stdio: ["pipe", "ignore", "pipe"],
    });

    const getStderr = collectStderr(child.stderr);
    const exited = waitForExit(child);
    let stopped = false;

    const terminate = () => {
      if (child.exitCode !== null) return;
      if (process.platform === "win32") {
        try {
          if (child.stdin && !child.stdin.destroyed && child.stdin.writable) {
            child.stdin.write("q\n");
            child.stdin.end();
            return;
          }
        } catch { /* ignore */ }
      }
      try { child.kill("SIGINT"); } catch { /* already dead */ }
    };

    const forceKill = () => {
      if (child.exitCode !== null) return;
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    };

    const stop = async () => {
      if (!stopped) {
        stopped = true;
        terminate();
      }
      const killTimer = setTimeout(forceKill, 3000);
      const exitResult = await exited;
      clearTimeout(killTimer);
      const stderrText = getStderr();

      let size = 0;
      try {
        size = (await stat(outputPath)).size;
      } catch {
        throw new Error(`ffmpeg did not create an audio file (${exitResult}). ${truncate(stderrText)}`);
      }

      if (size < config.minBytes) {
        throw new Error(
          `Recording is too small (${size} bytes) — the audio source produced no data. ` +
            `Check microphone permission and that capture.inputFormat/capture.input point to a real device. ` +
            `On Linux, if the default PulseAudio source is empty, try ALSA (inputFormat "alsa", input "default"; list with: arecord -L). ` +
            truncate(stderrText),
        );
      }

      const maxAmplitude = maxPcm16LeAmplitude(await readFile(outputPath));
      if (maxAmplitude !== undefined && maxAmplitude <= SILENCE_MAX_AMPLITUDE) {
        throw new Error(
          `Recording is silent (peak amplitude ${maxAmplitude}) — the audio source produced no sound. ` +
            `Check microphone permission and that capture.inputFormat/capture.input point to a real device. ` +
            `On macOS, list devices with: ffmpeg -f avfoundation -list_devices true -i "" and set capture.input to the real microphone (e.g. ":1"). ` +
            truncate(stderrText),
        );
      }
      return outputPath;
    };

    const dispose = async () => {
      if (!stopped) {
        stopped = true;
        terminate();
      }
      const killTimer = setTimeout(forceKill, 3000);
      await exited.catch((error: unknown) => {
        console.warn(`OpenCode Voice STT recording cleanup failed: ${formatError(error)}`);
      });
      clearTimeout(killTimer);
      await rm(tempDir, { force: true, recursive: true }).catch((error: unknown) => {
        console.warn(`OpenCode Voice STT temp cleanup failed: ${formatError(error)}`);
      });
    };

    return {
      outputPath,
      stop,
      dispose,
    } satisfies RecordingHandle;
  },
});
