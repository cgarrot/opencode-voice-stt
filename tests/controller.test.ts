import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDictationController, type DictationControllerOptions } from "../src/core/dictation-controller";
import { resolveStrings } from "../src/i18n/strings";
import { audioFixture, deferred, testConfig } from "./helpers";

const setup = (overrides: Partial<DictationControllerOptions> = {}) => {
  const appended: string[] = [];
  const toasts: Array<{ message: string; variant?: string }> = [];
  let submitted = 0;
  let recordings = 0;
  const controller = createDictationController({
    keybind: "ctrl+r",
    strings: resolveStrings("en"),
    loadConfig: async () => testConfig(),
    createProvider: () => ({ transcribe: async () => ({ text: "super base send" }) }),
    createCleanup: () => null,
    createRecorder: () => ({
      start: () => {
        recordings += 1;
        return { outputPath: "recording.wav", stop: async () => "recording.wav", dispose: async () => {} };
      },
    }),
    appendPrompt: async (text) => {
      appended.push(text);
    },
    submitPrompt: async () => {
      submitted += 1;
    },
    notify: (toast) => {
      toasts.push({ message: toast.message, variant: toast.variant });
    },
    onError: (error) => {
      throw error;
    },
    ...overrides,
  });
  return { controller, appended, toasts, getSubmitted: () => submitted, getRecordings: () => recordings };
};

test("file transcription returns metadata without side effects; insertion never submits", async (t) => {
  const { cwd, path } = await audioFixture(t);
  const config = testConfig();
  config.output.submitOnStop = true;
  const { controller, appended, getSubmitted, getRecordings } = setup({ loadConfig: async () => config });
  t.after(() => controller.dispose());
  assert.deepEqual(await controller.transcribeFile("./meeting.mp3", { cwd }), {
    text: "Supabase send",
    provider: "mistral",
    model: config.provider.model,
    path,
  });
  assert.deepEqual(appended, []);
  await controller.transcribeFile(path, { cwd, insertIntoPrompt: true });
  assert.deepEqual(appended, ["Supabase send "]);
  assert.equal(getSubmitted(), 0);
  assert.equal(getRecordings(), 0);
  assert.equal(await readFile(path, "utf8"), "fake audio");
  assert.equal(controller.getMode(), "idle");
});

test("provider errors include provider, path, size and original detail without editing or retrying", async (t) => {
  const { cwd, path } = await audioFixture(t);
  let calls = 0;
  const { controller, appended } = setup({
    createProvider: () => ({
      transcribe: async () => {
        calls += 1;
        throw new Error("413: upload too large");
      },
    }),
  });
  t.after(() => controller.dispose());
  await assert.rejects(controller.transcribeFile(path, { cwd, insertIntoPrompt: true }), (error: Error) => {
    assert.ok(error.message.includes(path));
    assert.match(error.message, /mistral.*10 bytes.*413: upload too large/);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(appended, []);
  assert.equal(controller.getMode(), "idle");
});

test("file transcription is rejected while recording", async (t) => {
  const { path } = await audioFixture(t);
  const { controller } = setup();
  t.after(() => controller.dispose());
  await controller.toggle();
  await assert.rejects(controller.transcribeFile(path), /busy/);
  assert.equal(controller.getMode(), "recording");
  await controller.cancel();
});

for (const cancelWith of ["cancel", "signal", "dispose"] as const) {
  test(`${cancelWith} aborts file transcription; concurrent files and recording are blocked`, async (t) => {
    const { cwd, path } = await audioFixture(t);
    const started = deferred<AbortSignal>();
    const external = new AbortController();
    const { controller, appended, getRecordings } = setup({
      createProvider: () => ({
        transcribe: async ({ signal }) => {
          started.resolve(signal);
          return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
        },
      }),
    });
    t.after(() => controller.dispose());
    const pending = controller.transcribeFile(path, { cwd, signal: external.signal, insertIntoPrompt: true });
    const rejection = assert.rejects(pending, /cancelled/);
    const signal = await started.promise;
    await assert.rejects(controller.transcribeFile(path, { cwd }), /busy/);
    await controller.toggle();
    assert.equal(getRecordings(), 0);
    if (cancelWith === "signal") external.abort();
    else if (cancelWith === "cancel") await controller.cancel();
    else await controller.dispose();
    await rejection;
    assert.equal(signal.aborted, true);
    assert.deepEqual(appended, []);
    assert.equal(controller.getMode(), "idle");
  });
}

test("pre-cancelled requests never call the provider and release processing state", async (t) => {
  const { cwd, path } = await audioFixture(t);
  const { controller } = setup({
    createProvider: () => {
      throw new Error("provider must not be called");
    },
  });
  t.after(() => controller.dispose());
  const external = new AbortController();
  external.abort();
  await assert.rejects(controller.transcribeFile(path, { cwd, signal: external.signal }), { name: "AbortError" });
  assert.equal(controller.getMode(), "idle");
});

test("cancelling while polishing leaves the prompt unchanged and blocks other operations", async (t) => {
  const { cwd, path } = await audioFixture(t);
  const started = deferred<AbortSignal>();
  const { controller, appended, getRecordings, toasts } = setup({
    createCleanup: () => ({
      clean: ({ signal }) => {
        started.resolve(signal);
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
      },
    }),
  });
  t.after(() => controller.dispose());
  const pending = controller.transcribeFile(path, { cwd, insertIntoPrompt: true });
  const rejection = assert.rejects(pending, /aborted/);
  const signal = await started.promise;
  assert.equal(controller.getMode(), "polishing");
  await assert.rejects(controller.transcribeFile(path, { cwd }), /busy/);
  await controller.toggle();
  assert.equal(getRecordings(), 0);
  await controller.cancel();
  await rejection;
  assert.equal(signal.aborted, true);
  assert.deepEqual(appended, []);
  assert.equal(controller.getMode(), "idle");
  assert.ok(toasts.some((toast) => /cancelled/i.test(toast.message)));
});

test("microphone flow inserts, sends, discards and adds newlines", async (t) => {
  for (const [text, expected, submitted] of [
    ["super base", ["Supabase "], 0],
    ["super base send", ["Supabase "], 1],
    ["super base clear", [], 0],
    ["super base new line", ["Supabase ", "\n"], 0],
  ] as const) {
    const { controller, appended, getSubmitted } = setup({ createProvider: () => ({ transcribe: async () => ({ text }) }) });
    t.after(() => controller.dispose());
    await controller.toggle();
    await controller.stop();
    assert.deepEqual(appended, expected);
    assert.equal(getSubmitted(), submitted);
  }
});

test("stopAndSend submits after inserting", async (t) => {
  const { controller, appended, getSubmitted } = setup({
    createProvider: () => ({ transcribe: async () => ({ text: "super base" }) }),
  });
  t.after(() => controller.dispose());
  await controller.toggle();
  await controller.stopAndSend();
  assert.deepEqual(appended, ["Supabase "]);
  assert.equal(getSubmitted(), 1);
});

test("empty transcripts warn without touching the prompt", async (t) => {
  const { controller, appended, toasts, getSubmitted } = setup({
    createProvider: () => ({ transcribe: async () => ({ text: "   " }) }),
  });
  t.after(() => controller.dispose());
  await controller.toggle();
  await controller.stop();
  assert.deepEqual(appended, []);
  assert.equal(getSubmitted(), 0);
  assert.ok(toasts.some((toast) => toast.variant === "warning"));
});

test("stopping while still processing warns and keeps the active operation", async (t) => {
  const started = deferred<void>();
  const release = deferred<void>();
  const { controller, toasts } = setup({
    createProvider: () => ({
      transcribe: async () => {
        started.resolve();
        await release.promise;
        return { text: "hello" };
      },
    }),
  });
  t.after(() => controller.dispose());
  await controller.toggle();
  const first = controller.stop();
  await started.promise;
  await controller.stop();
  assert.ok(toasts.some((toast) => /still processing/i.test(toast.message)));
  release.resolve();
  await first;
  assert.equal(controller.getMode(), "idle");
});

test("rapid toggles are debounced", async (t) => {
  const { controller, getRecordings } = setup();
  t.after(() => controller.dispose());
  await controller.toggle();
  await controller.toggle();
  assert.equal(getRecordings(), 1);
  assert.equal(controller.getMode(), "recording");
  await controller.cancel();
});

test("cancel during processing disposes the active recording handle and aborts the provider", async () => {
  let stopStarted = false;
  let stopResolve: ((path: string) => void) | undefined;
  let disposeCount = 0;
  let transcribeSawAbort = false;

  const controller = createDictationController({
    keybind: "ctrl+r",
    strings: resolveStrings("en"),
    loadConfig: async () => testConfig(),
    createRecorder: () => ({
      start: () => ({
        outputPath: "pending.wav",
        stop: async () => {
          stopStarted = true;
          return new Promise<string>((resolve) => {
            stopResolve = resolve;
          });
        },
        dispose: async () => {
          disposeCount += 1;
          stopResolve?.("audio.wav");
        },
      }),
    }),
    createProvider: () => ({
      transcribe: async ({ signal }) => {
        transcribeSawAbort = signal.aborted;
        throw new Error("aborted");
      },
    }),
    createCleanup: () => null,
    appendPrompt: async () => assert.fail("cancelled transcription should not append"),
    submitPrompt: async () => assert.fail("cancelled transcription should not submit"),
    notify: () => {},
    onError: (error) => {
      throw error;
    },
  });

  await controller.toggle();
  const stopPromise = controller.stop();
  assert.equal(stopStarted, true);

  await controller.cancel();
  await stopPromise;

  assert.ok(disposeCount >= 1);
  assert.equal(transcribeSawAbort, true);
  assert.equal(controller.getMode(), "idle");
});
