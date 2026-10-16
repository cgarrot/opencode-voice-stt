import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@opencode/plugin/tui/context";
import { createSessionCleanup } from "../src/cleanup/session-generate";
import { defaultCleanupConfig } from "../src/config/defaults";

test("session cleanup is only enabled with enabled + useSession", () => {
  const context = {} as Context;
  assert.equal(createSessionCleanup(context, { ...defaultCleanupConfig }, () => "ses_1"), null);
  assert.equal(createSessionCleanup(context, { ...defaultCleanupConfig, enabled: true }, () => "ses_1"), null);
});

test("session cleanup asks the current session's model with the cleanup prompt", async () => {
  const prompts: Array<{ sessionID: string; prompt: string }> = [];
  const context = {
    client: {
      session: {
        generate: async (input: { sessionID: string; prompt: string }) => {
          prompts.push(input);
          return { text: "  Cleaned text.  " };
        },
      },
    },
  } as unknown as Context;

  const cleanup = createSessionCleanup(
    context,
    { ...defaultCleanupConfig, enabled: true, useSession: true, projectTerms: ["Supabase"] },
    () => "ses_1",
  );
  assert.ok(cleanup);
  const result = await cleanup.clean({ text: "super base", signal: new AbortController().signal });
  assert.equal(result, "Cleaned text.");
  assert.equal(prompts[0]?.sessionID, "ses_1");
  assert.ok(prompts[0]?.prompt.includes("Supabase"));
  assert.ok(prompts[0]?.prompt.includes("super base"));
});

test("session cleanup fails cleanly without an active session", async () => {
  const context = {
    client: { session: { generate: async () => ({ text: "x" }) } },
  } as unknown as Context;
  const cleanup = createSessionCleanup(context, { ...defaultCleanupConfig, enabled: true, useSession: true }, () => undefined);
  assert.ok(cleanup);
  await assert.rejects(cleanup.clean({ text: "x", signal: new AbortController().signal }), /No active session/);
});
