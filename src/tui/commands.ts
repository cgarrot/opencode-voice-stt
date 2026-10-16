import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Context } from "@opencode/plugin/tui/context";
import { checkBridgeRecorderHealth } from "../audio/bridge-recorder";
import { readConfigFile } from "../config/load-config";
import { isKnownMode, listModeNames } from "../core/modes";
import { isKnownProfile } from "../config/profiles";
import type { StartupOptions } from "../config/startup";
import type { PluginConfig } from "../config/types";
import type { DictationController, DictationToast } from "../core/dictation-controller";
import type { Strings } from "../i18n/strings";
import { assertProviderReady } from "../providers/readiness";
import { formatError } from "../utils/text";
import { BRAND } from "./notify";

const execFileAsync = promisify(execFile);

export type SttAction = "start" | "stop" | "send" | "file" | "cancel" | "mode" | "profile" | "status" | "doctor" | "help";

export type SttCommand = { action: SttAction; param: string };

export const STT_USAGE =
  "Usage: /stt [start|stop|send|file <path>|cancel|mode <name>|profile <name>|status|doctor]";

/** Parse the raw slash-command input into an action plus its argument. */
export const parseSttCommand = (input: string): SttCommand => {
  const trimmed = input.trim().replace(/^\/stt\b/i, "").trim();
  if (!trimmed) return { action: "help", param: "" };
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  const head = (match?.[1] ?? "").toLowerCase();
  const param = (match?.[2] ?? "").trim();
  if (head === "file" || head === "mode" || head === "profile") return { action: head, param };
  if (head === "start" || head === "stop" || head === "send" || head === "cancel" || head === "status" || head === "doctor") {
    return { action: head, param };
  }
  return { action: "help", param: "" };
};

/** Strip one layer of surrounding quotes from an audio file path. */
export const unquotePath = (param: string): string => {
  if ((param.startsWith("\"") || param.startsWith("'")) && (param.length < 2 || !param.endsWith(param[0] ?? ""))) {
    throw new Error("Unclosed quote in audio file path.");
  }
  return param.replace(/^(["'])(.*)\1$/s, "$2");
};

export type SttCommandDeps = {
  context: Context;
  controller: DictationController;
  strings: Strings;
  startup: StartupOptions;
  cwd: string;
  loadConfig(): Promise<PluginConfig>;
  notify(toast: DictationToast): void;
  reportError(error: unknown): void;
  getActiveMode(): string;
  setActiveMode(mode: string): void;
  getActiveProfile(): string;
  switchProfile(name: string): Promise<void>;
  showProfileMenu(): Promise<void>;
};

export const runSttCommand = async (deps: SttCommandDeps, input: string): Promise<void> => {
  const { action, param } = parseSttCommand(input);
  const { controller } = deps;

  switch (action) {
    case "help": {
      deps.notify({ title: BRAND, message: STT_USAGE, variant: "info" });
      return;
    }

    case "start": {
      if (controller.getMode() === "idle") await controller.toggle();
      else deps.notify({ title: BRAND, message: `OpenCode Voice STT is already ${controller.getMode()}.`, variant: "warning" });
      return;
    }

    case "stop": {
      await controller.stop();
      return;
    }

    case "send": {
      await controller.stopAndSend();
      return;
    }

    case "cancel": {
      await controller.cancel();
      return;
    }

    case "file": {
      if (!param) throw new Error("Usage: /stt file <path>");
      const path = unquotePath(param);
      await controller.transcribeFile(path, { cwd: deps.cwd, insertIntoPrompt: true });
      return;
    }

    case "mode": {
      const fileConfig = await readConfigFile(deps.startup.configPath).catch(() => ({}));
      const names = listModeNames(fileConfig);
      if (!param) {
        deps.notify({ title: BRAND, message: `OpenCode Voice STT mode: ${deps.getActiveMode()} · available: ${names.join(", ")}`, variant: "info" });
        return;
      }
      const next = param.toLowerCase();
      if (!isKnownMode(fileConfig, next)) {
        deps.notify({ title: BRAND, message: `Unknown mode "${next}". Available: ${names.join(", ")}`, variant: "error" });
        return;
      }
      deps.setActiveMode(next);
      deps.notify({ title: BRAND, message: `OpenCode Voice STT mode set to "${next}".`, variant: "success" });
      return;
    }

    case "profile": {
      if (!param) {
        await deps.showProfileMenu();
        return;
      }
      const fileConfig = await readConfigFile(deps.startup.configPath).catch(() => ({}));
      const next = param.toLowerCase();
      if (!isKnownProfile(fileConfig, next)) {
        deps.notify({ title: BRAND, message: deps.strings.profile.unknown(next), variant: "error" });
        return;
      }
      if (next === deps.getActiveProfile()) {
        deps.notify({ title: BRAND, message: `OpenCode Voice STT profile is already "${next}".`, variant: "info" });
        return;
      }
      await deps.switchProfile(next);
      return;
    }

    case "doctor": {
      try {
        const config = await deps.loadConfig();
        assertProviderReady(config.provider);
        if (config.capture.type === "bridge") {
          await checkBridgeRecorderHealth(config.capture);
        } else {
          await execFileAsync(config.capture.ffmpegPath, ["-version"], { timeout: 5000 });
        }
        deps.notify({
          title: BRAND,
          message: `OpenCode Voice STT ready (${config.capture.type}, ${config.provider.type}/${config.provider.model}).`,
          variant: "success",
        });
      } catch (error) {
        deps.reportError(new Error(`Doctor check failed: ${formatError(error)}`));
      }
      return;
    }

    case "status":
    default: {
      const configPath = deps.startup.configPath || "defaults only (set OPENCODE_STT_CONFIG or ~/.config/opencode/stt.json)";
      deps.notify({
        title: BRAND,
        message: `OpenCode Voice STT: ${controller.getMode()} · mode ${deps.getActiveMode()} · profile ${deps.getActiveProfile()} · keybind ${deps.startup.keybind} · config ${configPath}`,
        variant: "info",
      });
      return;
    }
  }
};
