import assert from "node:assert/strict";

/**
 * Smoke test: both plugin entrypoints must load and expose a valid
 * `Plugin.define` shape (an id and a setup function). Runs under Bun, which is
 * the runtime OpenCode uses for CLI plugins.
 */

const assertPlugin = (plugin: unknown, label: string): string => {
  assert.ok(plugin && typeof plugin === "object", `${label}: default export is not an object`);
  const record = plugin as { id?: unknown; setup?: unknown };
  assert.equal(typeof record.id, "string", `${label}: plugin id must be a string`);
  assert.ok((record.id as string).length > 0, `${label}: plugin id must not be empty`);
  assert.equal(typeof record.setup, "function", `${label}: plugin setup must be a function`);
  return record.id as string;
};

const { default: server } = await import("../src/index.ts");
const { default: tui } = await import("../src/tui.tsx");

const serverID = assertPlugin(server, "server");
const tuiID = assertPlugin(tui, "tui");
console.log(`opencode-voice-stt smoke ok: ${serverID} / ${tuiID}`);
