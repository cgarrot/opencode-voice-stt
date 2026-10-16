import test from "node:test";
import assert from "node:assert/strict";
import server from "../src/index";

test("the server entrypoint is a valid plugin definition", () => {
  assert.equal(typeof server, "object");
  assert.equal((server as { id?: unknown }).id, "opencode-voice-stt");
  assert.equal(typeof (server as { setup?: unknown }).setup, "function");
});
