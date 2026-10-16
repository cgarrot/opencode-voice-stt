import test from "node:test";
import assert from "node:assert/strict";
import { parseSttCommand, unquotePath } from "../src/tui/commands";

test("parseSttCommand maps input to actions and params", () => {
  assert.deepEqual(parseSttCommand(""), { action: "help", param: "" });
  assert.deepEqual(parseSttCommand("/stt"), { action: "help", param: "" });
  assert.deepEqual(parseSttCommand("status"), { action: "status", param: "" });
  assert.deepEqual(parseSttCommand("/stt status"), { action: "status", param: "" });
  assert.deepEqual(parseSttCommand("start"), { action: "start", param: "" });
  assert.deepEqual(parseSttCommand("send"), { action: "send", param: "" });
  assert.deepEqual(parseSttCommand("cancel"), { action: "cancel", param: "" });
  assert.deepEqual(parseSttCommand("doctor"), { action: "doctor", param: "" });
  assert.deepEqual(parseSttCommand("/stt file ./my recordings/a b.mp3"), { action: "file", param: "./my recordings/a b.mp3" });
  assert.deepEqual(parseSttCommand("MODE Raw"), { action: "mode", param: "Raw" });
  assert.deepEqual(parseSttCommand("/stt profile local"), { action: "profile", param: "local" });
  assert.deepEqual(parseSttCommand("/stt nope"), { action: "help", param: "" });
});

test("unquotePath strips one layer of quotes and rejects unclosed quotes", () => {
  assert.equal(unquotePath('"a b.mp3"'), "a b.mp3");
  assert.equal(unquotePath("'x.mp3'"), "x.mp3");
  assert.equal(unquotePath("plain.mp3"), "plain.mp3");
  assert.throws(() => unquotePath('"unclosed'), /Unclosed quote/);
});
