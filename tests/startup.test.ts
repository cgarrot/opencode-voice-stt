import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { defaultConfigPath, resolveStartupOptions } from "../src/config/startup";

const ENV_KEYS = [
  "OPENCODE_STT_CONFIG",
  "OPENCODE_STT_KEYBIND",
  "OPENCODE_STT_PROFILE_KEYBIND",
  "OPENCODE_STT_LOCALE",
  "OPENCODE_STT_MODE",
  "OPENCODE_STT_PROFILE",
  "XDG_CONFIG_HOME",
] as const;

/** Clear STT env vars, isolate XDG_CONFIG_HOME, and restore everything after. */
const withIsolatedEnv = async (t: TestContext): Promise<string> => {
  const saved = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  const dir = await mkdtemp(join(tmpdir(), "opencode-stt-startup-"));
  process.env.XDG_CONFIG_HOME = dir;
  t.after(async () => {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
};

test("built-in defaults when nothing is configured", async (t) => {
  await withIsolatedEnv(t);
  assert.deepEqual(resolveStartupOptions(), {
    configPath: "",
    keybind: "ctrl+r",
    profileKeybind: "alt+r",
    locale: "en",
    mode: "default",
    profile: "default",
  });
});

test("the default config file is discovered below XDG_CONFIG_HOME", async (t) => {
  const dir = await withIsolatedEnv(t);
  await mkdir(join(dir, "opencode"), { recursive: true });
  const file = join(dir, "opencode", "stt.json");
  await writeFile(file, JSON.stringify({ mode: "raw", locale: "fr", profileKeybind: "alt+p", profile: "local" }));

  const options = resolveStartupOptions();
  assert.equal(options.configPath, file);
  assert.equal(options.mode, "raw");
  assert.equal(options.locale, "fr");
  assert.equal(options.profileKeybind, "alt+p");
  assert.equal(options.profile, "local");
  assert.equal(defaultConfigPath(), file);
});

test("environment variables win over the config file", async (t) => {
  const dir = await withIsolatedEnv(t);
  await mkdir(join(dir, "opencode"), { recursive: true });
  await writeFile(join(dir, "opencode", "stt.json"), JSON.stringify({ keybind: "ctrl+g", mode: "raw" }));

  process.env.OPENCODE_STT_KEYBIND = "ctrl+shift+v";
  process.env.OPENCODE_STT_MODE = "default";

  const options = resolveStartupOptions();
  assert.equal(options.keybind, "ctrl+shift+v");
  assert.equal(options.mode, "default");
  assert.ok(options.configPath.endsWith(join("opencode", "stt.json")));
});

test("plugin options act as defaults and an explicit configPath wins over discovery", async (t) => {
  const dir = await withIsolatedEnv(t);
  await mkdir(join(dir, "opencode"), { recursive: true });
  await writeFile(join(dir, "opencode", "stt.json"), JSON.stringify({ mode: "raw" }));

  const custom = join(dir, "custom.json");
  await writeFile(custom, "{ this is not json");

  const options = resolveStartupOptions({ configPath: custom, locale: "fr", keybind: "ctrl+b" });
  assert.equal(options.configPath, custom);
  assert.equal(options.locale, "fr");
  assert.equal(options.keybind, "ctrl+b");
  // A malformed file must not crash startup; flat keys fall back to defaults.
  assert.equal(options.mode, "default");
});

test("the OPENCODE_STT_CONFIG env var wins over the plugin option", async (t) => {
  const dir = await withIsolatedEnv(t);
  const fromEnv = join(dir, "from-env.json");
  await writeFile(fromEnv, JSON.stringify({ keybind: "ctrl+e" }));
  process.env.OPENCODE_STT_CONFIG = fromEnv;

  const options = resolveStartupOptions({ configPath: join(dir, "ignored.json") });
  assert.equal(options.configPath, fromEnv);
  assert.equal(options.keybind, "ctrl+e");
});
