import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { createRecorder } from "./audio/factory";
import { createCleanup } from "./cleanup/factory";
import { createSessionCleanup } from "./cleanup/session-generate";
import { loadConfig, readConfigFile } from "./config/load-config";
import { DEFAULT_MODE, isKnownMode, listModeNames } from "./core/modes";
import { DEFAULT_PROFILE, isKnownProfile, listProfileNames, resolveEffectiveProfile, writeProfileState } from "./config/profiles";
import { resolveStartupOptions } from "./config/startup";
import type { PluginConfig } from "./config/types";
import { createDictationController, type DictationToast } from "./core/dictation-controller";
import { resolveStrings } from "./i18n/strings";
import { createProvider } from "./providers/factory";
import { createPromptBridge } from "./tui/bridge";
import { runSttCommand, type SttCommandDeps } from "./tui/commands";
import { createVoiceIndicator } from "./tui/indicator";
import { BRAND, showToast } from "./tui/notify";
import { objectFrom, textFrom } from "./utils/coerce";
import { formatError } from "./utils/text";

/**
 * OpenCode Voice STT — TUI plugin.
 *
 * Owns the interactive dictation flow: keyboard shortcuts, the prompt-footer
 * indicator, slash-command controls, microphone capture, and delivering the
 * transcript to the prompt. The server-side entrypoint (`src/index.ts`) shares
 * the config/provider/audio modules and exposes the `transcribe_audio` tool.
 */
export default Plugin.define({
  id: "opencode-voice-stt.tui",
  async setup(context: Context) {
    const rawOptions = objectFrom(context.options);
    const startup = resolveStartupOptions(rawOptions);
    const strings = resolveStrings(startup.locale);
    const debugEnabled = textFrom(process.env.OPENCODE_STT_DEBUG) === "1" || rawOptions.debug === true;
    const debugPath = textFrom(process.env.OPENCODE_STT_DEBUG_FILE) || join(tmpdir(), "opencode-voice-stt.log");
    const log = debugEnabled
      ? (message: string) => {
          try {
            appendFileSync(debugPath, `${new Date().toISOString()} ${message}\n`);
          } catch {
            // Debug logging must never break dictation.
          }
        }
      : undefined;

    let activeMode = startup.mode || DEFAULT_MODE;
    let activeProfile = startup.profile || DEFAULT_PROFILE;
    let lastConfig: PluginConfig | undefined;
    let lastSessionID: string | undefined;

    // Fold in the persisted profile selection (sidecar state next to the config).
    const fileConfig = await readConfigFile(startup.configPath).catch(() => ({}));
    const effective = await resolveEffectiveProfile({
      configPath: startup.configPath,
      envProfile: textFrom(process.env.OPENCODE_STT_PROFILE),
      configProfile: startup.profile,
    }).catch(() => startup.profile);
    activeProfile = isKnownProfile(fileConfig, effective) ? effective : isKnownProfile(fileConfig, startup.profile) ? startup.profile : DEFAULT_PROFILE;

    const getConfig = async (): Promise<PluginConfig> => {
      lastConfig = await loadConfig({ configPath: startup.configPath, mode: activeMode, profile: activeProfile });
      log?.(`config loaded (configPath="${startup.configPath || "none"}" mode="${activeMode}" profile="${activeProfile}" provider="${lastConfig.provider.type}/${lastConfig.provider.model}")`);
      return lastConfig;
    };

    const indicator = createVoiceIndicator(context, { strings, keybind: startup.keybind });
    indicator.setProfile(activeProfile);

    const bridge = createPromptBridge(context, {
      debug: log,
      sessionID: () => {
        const route = context.ui.router.current();
        return route.type === "session" ? route.sessionID : lastSessionID;
      },
    });

    const notify = (toast: DictationToast) => showToast(context, toast);
    const reportError = (error: unknown) => showToast(context, { variant: "error", message: formatError(error) });
    const runCatching = (promise: Promise<unknown>) => {
      void promise.catch(reportError);
    };

    const controller = createDictationController({
      keybind: startup.keybind,
      strings,
      loadConfig: getConfig,
      createRecorder: (config) => createRecorder(config.capture),
      createProvider: (config) => createProvider(config.provider),
      createCleanup: (config) =>
        createSessionCleanup(context, config.cleanup, () => {
          const route = context.ui.router.current();
          return route.type === "session" ? route.sessionID : lastSessionID;
        }) ?? createCleanup(config.cleanup),
      appendPrompt: async (text) => {
        const method = lastConfig?.output.insertMethod ?? "auto";
        if (method === "send") {
          if (text.trim()) await bridge.insert(text, "send");
          return;
        }
        await bridge.insert(text, method);
      },
      submitPrompt: async () => {
        const method = lastConfig?.output.insertMethod ?? "auto";
        if (method === "send") return; // the transcript was already posted
        await bridge.submit();
      },
      notify,
      onModeChange: (mode) => indicator.setMode(mode),
      onError: reportError,
    });

    const busyWithDictation = () => controller.getMode() !== "idle";

    const switchProfile = async (name: string) => {
      if (busyWithDictation()) {
        notify({ title: BRAND, message: strings.profile.busy, variant: "warning" });
        return;
      }
      activeProfile = name;
      indicator.setProfile(name);
      try {
        await writeProfileState(startup.configPath, name);
      } catch {
        notify({ title: BRAND, message: strings.profile.persistFailed, variant: "warning" });
      }
      notify({ title: BRAND, message: strings.profile.set(name), variant: "success" });
    };

    const showProfileMenu = async () => {
      if (busyWithDictation()) {
        notify({ title: BRAND, message: strings.profile.busy, variant: "warning" });
        return;
      }
      const currentFileConfig = await readConfigFile(startup.configPath).catch(() => ({}));
      const names = listProfileNames(currentFileConfig);
      if (names.length <= 1) {
        notify({ title: BRAND, message: strings.profile.none, variant: "warning" });
        return;
      }
      const chosen = await context.ui.dialog.select({
        title: strings.profile.menuTitle,
        current: activeProfile,
        options: names.map((name) => ({
          title: name === activeProfile ? `${name} (${strings.profile.activeMarker})` : name,
          value: name,
        })),
      });
      if (!chosen || chosen === activeProfile) return;
      if (!isKnownProfile(currentFileConfig, chosen)) {
        notify({ title: BRAND, message: strings.profile.unknown(chosen), variant: "error" });
        return;
      }
      await switchProfile(chosen);
    };

    const commandDeps: SttCommandDeps = {
      context,
      controller,
      strings,
      startup,
      cwd: context.location?.directory ?? process.cwd(),
      loadConfig: getConfig,
      notify,
      reportError,
      getActiveMode: () => activeMode,
      setActiveMode: (mode) => {
        activeMode = mode;
      },
      getActiveProfile: () => activeProfile,
      switchProfile,
      showProfileMenu,
    };

    context.keymap.layer(() => ({
      mode: "global",
      priority: 50,
      commands: [
        {
          id: "voice-stt.toggle",
          title: "Voice: start or stop dictation",
          description: "Record microphone audio, transcribe it, and insert the transcript into the prompt.",
          group: "Voice",
          bind: startup.keybind,
          palette: true,
          suggested: true,
          run: () => runCatching(controller.toggle()),
        },
        {
          id: "voice-stt.stop-and-send",
          title: "Voice: stop recording and send",
          description: "Stop the recording, transcribe it, and send the prompt.",
          group: "Voice",
          bind: "return",
          enabled: () => controller.getMode() === "recording",
          run: () => runCatching(controller.stopAndSend()),
        },
        {
          id: "voice-stt.cancel",
          title: "Voice: cancel dictation",
          description: "Discard the active recording or transcription.",
          group: "Voice",
          bind: "escape",
          enabled: () => controller.getMode() !== "idle",
          run: () => runCatching(controller.cancel()),
        },
        {
          id: "voice-stt.profile",
          title: "Voice: choose STT profile",
          description: "Select the speech-to-text profile used for the next recording.",
          group: "Voice",
          bind: startup.profileKeybind,
          palette: true,
          run: () => runCatching(showProfileMenu()),
        },
        {
          id: "voice-stt.command",
          title: "Voice: speech-to-text controls (/stt)",
          description: "start, stop, send, file <path>, cancel, mode, profile, status, doctor",
          group: "Voice",
          slash: { name: "stt", arguments: true },
          palette: true,
          run: (input) => runCatching(runSttCommand(commandDeps, input ?? "")),
        },
      ],
    }));

    const disposeSlot = context.ui.slot({
      append: "prompt.footer",
      render: (input) => {
        lastSessionID = input.sessionID;
        return indicator.render();
      },
    });

    // Dev aid: OPENCODE_STT_DUMP_TREE=1 dumps the renderable tree (ids, layout
    // boxes, text) to the debug log a few seconds after startup.
    if (textFrom(process.env.OPENCODE_STT_DUMP_TREE) === "1") {
      const timer = setTimeout(() => {
        try {
          const lines: string[] = [];
          const seen = new Set<unknown>();
          let count = 0;
          const walk = (node: unknown, depth: number) => {
            if (!node || typeof node !== "object" || seen.has(node) || depth > 40 || count > 2000) return;
            seen.add(node);
            count += 1;
            const record = node as Record<string, unknown>;
            const id = typeof record.id === "string" ? record.id : "";
            const name = (node as { constructor?: { name?: string } }).constructor?.name ?? "?";
            let text = "";
            try {
              if (typeof record.plainText === "string") text = record.plainText;
              else if (typeof record.text === "string") text = record.text;
            } catch {
              // Some renderables throw while reading text before first layout.
            }
            const parts = [`${"  ".repeat(Math.min(depth, 24))}${name} id="${id}"`];
            for (const key of ["x", "y", "width", "height"]) {
              const value = record[key];
              if (typeof value === "number") parts.push(`${key}=${Math.round(value)}`);
            }
            if (text) parts.push(`text=${JSON.stringify(text.slice(0, 80))}`);
            lines.push(parts.join(" "));
            try {
              const children = typeof record.getChildren === "function" ? (record.getChildren as () => unknown[])() : undefined;
              if (Array.isArray(children)) for (const child of children) walk(child, depth + 1);
            } catch {
              // Ignore renderables that cannot enumerate children.
            }
          };
          walk(context.renderer.root, 0);
          appendFileSync(debugPath, `=== RENDERABLE TREE DUMP ===\n${lines.join("\n")}\n=== END ===\n`);
        } catch (error) {
          appendFileSync(debugPath, `tree dump failed: ${String(error)}\n`);
        }
      }, 9000);
      timer.unref?.();
    }

    log?.("OpenCode Voice STT TUI plugin ready");

    return async () => {
      disposeSlot();
      indicator.dispose();
      await controller.dispose();
    };
  },
});
