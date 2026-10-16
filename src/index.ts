import { Plugin } from "@opencode/plugin";
import { validateAudioFile } from "./audio/file";
import { createCleanup } from "./cleanup/factory";
import { loadConfig } from "./config/load-config";
import { resolveStartupOptions } from "./config/startup";
import { transcribeAudioPath } from "./core/transcribe";
import { createProvider } from "./providers/factory";
import { assertProviderReady } from "./providers/readiness";
import { formatError } from "./utils/text";

/**
 * OpenCode Voice STT — server plugin.
 *
 * Exposes the `transcribe_audio` tool so agents can transcribe local audio
 * files with the same configuration as the interactive dictation flow
 * (`src/tui.tsx`). The actual recording and prompt integration live in the
 * TUI entrypoint; this entrypoint only serves file transcription.
 */
export default Plugin.define({
  id: "opencode-voice-stt",
  async setup(ctx) {
    const registration = await ctx.tool.transform((editor) => {
      editor.add({
        name: "transcribe_audio",
        description: "Transcribe a local audio file using the configured OpenCode Voice STT provider.",
        input: {
          type: "object",
          properties: {
            path: {
              type: "string",
              minLength: 1,
              description: "Local audio file path, relative to the session working directory or absolute.",
            },
          },
          required: ["path"],
          additionalProperties: false,
        },
        execute: async (input, toolContext) => {
          const rawPath = String((input as { path?: unknown } | undefined)?.path ?? "");
          const cwd = ctx.location?.directory ?? process.cwd();
          const signal = toolContext?.signal ?? new AbortController().signal;

          // Resolve the config per call so a config file created (or moved)
          // after plugin load is picked up without restarting the server.
          const startup = resolveStartupOptions((ctx.options ?? {}) as Record<string, unknown>);

          const file = await validateAudioFile(rawPath, cwd);
          const config = await loadConfig({ configPath: startup.configPath, mode: startup.mode, profile: startup.profile });
          assertProviderReady(config.provider);

          try {
            const result = await transcribeAudioPath({
              audioPath: file.path,
              config,
              signal,
              processVoiceCommands: false,
              createProvider: (current) => createProvider(current.provider),
              createCleanup: (current) => createCleanup(current.cleanup),
            });
            return { content: result.text };
          } catch (error) {
            throw new Error(
              `Transcription failed (${config.provider.type}/${config.provider.model}) for "${file.path}" (${file.size} bytes): ${formatError(error)}`,
              { cause: error },
            );
          }
        },
      });
    });

    return async () => {
      await registration.dispose();
    };
  },
});
