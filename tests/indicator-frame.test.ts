import test from "node:test";
import assert from "node:assert/strict";
import { resolveStrings } from "../src/i18n/strings";
import { indicatorColorFrom, indicatorCompactFrame, indicatorFrame } from "../src/tui/indicator-frame";

const strings = resolveStrings("en");

test("idle frame shows the keybind and the profile only when not default", () => {
  assert.deepEqual(indicatorFrame("idle", 0, strings, "ctrl+r", "default"), { label: "voice ctrl+r", color: "dim" });
  assert.deepEqual(indicatorFrame("idle", 0, strings, "ctrl+r", "local"), { label: "voice · local ctrl+r", color: "dim" });
  assert.deepEqual(indicatorFrame("idle", 0, strings, "ctrl+r", ""), { label: "voice ctrl+r", color: "dim" });
});

test("recording blinks between filled and hollow dots in the error color", () => {
  const even = indicatorFrame("recording", 0, strings, "ctrl+r", "default");
  const odd = indicatorFrame("recording", 1, strings, "ctrl+r", "default");
  assert.ok(even.label.startsWith("● recording"));
  assert.ok(odd.label.startsWith("○ recording"));
  assert.ok(even.label.includes("enter send"));
  assert.equal(even.color, "error");
});

test("processing and polishing animate with their own colors", () => {
  const processing = indicatorFrame("processing", 0, strings, "ctrl+r", "default");
  assert.equal(processing.color, "warning");
  assert.ok(processing.label.includes("transcribing"));
  const polishing = indicatorFrame("polishing", 1, strings, "ctrl+r", "default");
  assert.equal(polishing.color, "accent");
  assert.ok(polishing.label.includes("polishing"));
});

test("the French locale switches indicator labels", () => {
  const fr = resolveStrings("fr");
  assert.deepEqual(indicatorFrame("idle", 0, fr, "ctrl+r", "default"), { label: "voix ctrl+r", color: "dim" });
});

test("the compact frame drops the keyboard hints", () => {
  assert.deepEqual(indicatorCompactFrame("idle", 0, strings, "ctrl+r", "default"), { label: "voice ctrl+r", color: "dim" });
  assert.deepEqual(indicatorCompactFrame("idle", 0, strings, "ctrl+r", "local"), { label: "voice · local ctrl+r", color: "dim" });
  assert.deepEqual(indicatorCompactFrame("recording", 0, strings, "ctrl+r", "default"), { label: "● recording", color: "error" });
  assert.deepEqual(indicatorCompactFrame("recording", 1, strings, "ctrl+r", "default"), { label: "○ recording", color: "error" });
  assert.deepEqual(indicatorCompactFrame("processing", 0, strings, "ctrl+r", "default"), { label: "• transcribing", color: "warning" });
  assert.deepEqual(indicatorCompactFrame("polishing", 0, strings, "ctrl+r", "default"), { label: "· polishing", color: "accent" });
});

test("indicatorColorFrom falls back through theme tokens", () => {
  const theme = {
    text: { base: "#base", muted: "#muted", feedback: { error: { base: "#err" }, info: { base: "#info" } } },
  };
  assert.equal(indicatorColorFrom(theme, "error"), "#err");
  // No warning token in the theme: falls back to the info token.
  assert.equal(indicatorColorFrom(theme, "warning"), "#info");
  assert.equal(indicatorColorFrom(theme, "accent"), "#info");
  assert.equal(indicatorColorFrom(theme, "dim"), "#muted");
  assert.equal(indicatorColorFrom({ text: { base: "#b" } }, "error"), "#b");
  assert.equal(indicatorColorFrom(undefined, "error"), undefined);
});
