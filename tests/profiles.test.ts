import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyProfileOverride,
  DEFAULT_PROFILE,
  isKnownProfile,
  listProfileNames,
  profileOverrideFrom,
  profileStatePath,
  readProfileState,
  resolveEffectiveProfile,
  writeProfileState,
} from "../src/config/profiles";
import { loadConfig } from "../src/config/load-config";

test("listProfileNames always includes default plus user profiles", () => {
  const names = listProfileNames({ profiles: { local: {}, mistral: {} } });
  assert.deepEqual(names, [DEFAULT_PROFILE, "local", "mistral"]);
  assert.equal(listProfileNames({}).length, 1);
});

test("isKnownProfile accepts user profiles and default, rejects unknown", () => {
  const fileConfig = { profiles: { local: {} } };
  assert.equal(isKnownProfile(fileConfig, "default"), true);
  assert.equal(isKnownProfile(fileConfig, "local"), true);
  assert.equal(isKnownProfile(fileConfig, "nope"), false);
});

test("profileOverrideFrom returns empty override for default and unknown", () => {
  const fileConfig = { profiles: { local: { provider: { model: "x" } } } };
  assert.deepEqual(profileOverrideFrom(fileConfig, "default"), {});
  assert.deepEqual(profileOverrideFrom(fileConfig, "nope"), {});
});

test("profileOverrideFrom returns the user profile object", () => {
  const override = profileOverrideFrom({ profiles: { local: { provider: { model: "crisperwhisper-large" } } } }, "local");
  assert.deepEqual(override, { provider: { model: "crisperwhisper-large" } });
});

test("profileStatePath appends .profile.json and is empty without config path", () => {
  assert.equal(profileStatePath(""), "");
  assert.equal(profileStatePath("/tmp/stt.json"), "/tmp/stt.json.profile.json");
});

test("readProfileState returns persisted profile or empty when missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-stt-profiles-"));
  const configPath = join(dir, "stt.json");
  try {
    assert.equal(await readProfileState(configPath), "");
    await writeProfileState(configPath, "mistral");
    assert.equal(await readProfileState(configPath), "mistral");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeProfileState is atomic and leaves no temp files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-stt-profiles-"));
  const configPath = join(dir, "stt.json");
  try {
    await writeProfileState(configPath, "local");
    await writeProfileState(configPath, "mistral");
    assert.equal(await readProfileState(configPath), "mistral");
    const leftovers = await readdir(dir);
    assert.deepEqual(leftovers.sort(), ["stt.json.profile.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveEffectiveProfile precedence: env > persisted > config > default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-stt-profiles-"));
  const configPath = join(dir, "stt.json");
  try {
    assert.equal(await resolveEffectiveProfile({ configPath }), "default");
    assert.equal(await resolveEffectiveProfile({ configPath, configProfile: "local" }), "local");
    await writeProfileState(configPath, "mistral");
    assert.equal(await resolveEffectiveProfile({ configPath, configProfile: "local" }), "mistral");
    assert.equal(await resolveEffectiveProfile({ configPath, configProfile: "local", envProfile: "env" }), "env");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig applies the selected profile before the mode override", async () => {
  const base = {
    provider: { type: "openai-compatible", endpoint: "http://127.0.0.1:8788/v1/audio/transcriptions", model: "crisperwhisper-large", language: "fr", apiKey: "" },
    cleanup: { enabled: true },
    profiles: { mistral: { provider: { type: "mistral", apiKey: "test-key" } } },
    modes: { raw: { cleanup: { enabled: false } } },
  };
  const withProfile = await loadConfig({ ...base, profile: "mistral" });
  assert.equal(withProfile.provider.type, "mistral");
  assert.equal(withProfile.provider.apiKey, "test-key");
  assert.equal(withProfile.capture.type, "ffmpeg");
  const withProfileAndRawMode = await loadConfig({ ...base, profile: "mistral", mode: "raw" });
  assert.equal(withProfileAndRawMode.provider.type, "mistral");
  assert.equal(withProfileAndRawMode.cleanup.enabled, false);
});

test("applyProfileOverride replaces provider block when the profile changes type", () => {
  const base = {
    provider: { type: "openai-compatible", endpoint: "http://127.0.0.1:8788/v1/audio/transcriptions", model: "crisperwhisper-large", apiKey: "" },
  };
  const override = profileOverrideFrom(
    { ...base, profiles: { mistral: { provider: { type: "mistral", model: "voxtral-mini-2602", apiKeyEnv: "MISTRAL_API_KEY" } } } },
    "mistral",
  );
  const merged = applyProfileOverride(base, override);
  const provider = merged.provider as { type?: string; endpoint?: unknown; apiKeyEnv?: string };
  assert.equal(provider.type, "mistral");
  assert.equal(provider.endpoint, undefined);
  assert.equal(provider.apiKeyEnv, "MISTRAL_API_KEY");
});

test("loadConfig profile provider switch does not leak the base provider endpoint", async () => {
  const config = await loadConfig({
    provider: { type: "openai-compatible", endpoint: "http://127.0.0.1:8788/v1/audio/transcriptions", model: "crisperwhisper-large", apiKey: "" },
    profiles: { mistral: { provider: { type: "mistral", apiKey: "k", apiKeyEnv: "" } } },
    profile: "mistral",
  });
  assert.equal(config.provider.type, "mistral");
  assert.equal(config.provider.endpoint, "https://api.mistral.ai/v1/audio/transcriptions");
});
