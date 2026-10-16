import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { objectFrom, textFrom } from "../utils/coerce";
import { resolvePath } from "../utils/path";
import { DEFAULT_PROFILE } from "./profiles";

export type StartupOptions = {
  configPath: string;
  keybind: string;
  profileKeybind: string;
  locale: string;
  mode: string;
  profile: string;
};

/** Values the host may pass through plugin options (opencode.json / cli.json). */
export type StartupOverrides = {
  configPath?: unknown;
  keybind?: unknown;
  profileKeybind?: unknown;
  locale?: unknown;
  mode?: unknown;
  profile?: unknown;
};

/** Default config location: `$XDG_CONFIG_HOME/opencode/stt.json` or `~/.config/opencode/stt.json`. */
export const defaultConfigPath = (): string => {
  const xdg = textFrom(process.env.XDG_CONFIG_HOME);
  const base = xdg ? resolvePath(xdg) : join(homedir(), ".config");
  return join(base, "opencode", "stt.json");
};

const readJsonIfPresent = (path: string): Record<string, unknown> => {
  if (!path || !existsSync(path)) return {};
  try {
    return objectFrom(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // Malformed configs are reported with a friendly error by loadConfig;
    // startup only needs the cheap settings and must never crash the plugin.
    return {};
  }
};

/**
 * Resolve startup options from, in decreasing precedence: environment
 * variables, plugin options, the config file's flat keys, then defaults.
 *
 * The config path itself resolves as: `OPENCODE_STT_CONFIG` env var > plugin
 * `configPath` option > the default file when it exists > no config file
 * (built-in defaults only).
 */
export const resolveStartupOptions = (overrides: StartupOverrides = {}): StartupOptions => {
  const envConfigPath = textFrom(process.env.OPENCODE_STT_CONFIG);
  const optionConfigPath = textFrom(overrides.configPath);
  const fallbackPath = defaultConfigPath();
  const configPath = envConfigPath
    ? resolvePath(envConfigPath)
    : optionConfigPath
      ? resolvePath(optionConfigPath)
      : existsSync(fallbackPath)
        ? fallbackPath
        : "";

  const config = readJsonIfPresent(configPath);
  const keybind = textFrom(process.env.OPENCODE_STT_KEYBIND, textFrom(overrides.keybind, textFrom(config.keybind, "ctrl+r")));
  const locale = textFrom(process.env.OPENCODE_STT_LOCALE, textFrom(overrides.locale, textFrom(config.locale, "en")));
  const mode = textFrom(process.env.OPENCODE_STT_MODE, textFrom(overrides.mode, textFrom(config.mode, "default")));
  const profileKeybind = textFrom(
    process.env.OPENCODE_STT_PROFILE_KEYBIND,
    textFrom(overrides.profileKeybind, textFrom(config.profileKeybind, "alt+r")),
  );
  const profile = textFrom(process.env.OPENCODE_STT_PROFILE, textFrom(overrides.profile, textFrom(config.profile, DEFAULT_PROFILE)));

  return { configPath, keybind, profileKeybind, locale, mode, profile };
};
