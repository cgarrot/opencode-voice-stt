import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@opencode/plugin/tui/context";
import { clipboardCommandsFor, createPromptBridge, findPromptEditor } from "../src/tui/bridge";

const leaf = (id: string, insertText: (text: string) => void, focused = false) => ({
  id,
  focused,
  insertText,
  focus: () => {},
});

const box = (id: string, children: unknown[]) => ({ id, getChildren: () => children });

const makeContext = (root: unknown = box("root", [])) => {
  const dispatched: string[] = [];
  const sent: Array<Record<string, unknown>> = [];
  const context = {
    renderer: { root, requestRender: () => {} },
    keymap: { dispatch: (id: string) => { dispatched.push(id); } },
    client: {
      session: {
        prompt: async (input: Record<string, unknown>) => {
          sent.push(input);
        },
      },
    },
  } as unknown as Context;
  return { context, dispatched, sent };
};

test("findPromptEditor prefers the prompt editor over other inputs", () => {
  const inserted: string[] = [];
  const root = box("root", [
    box("sidebar", [leaf("search-input", (text) => inserted.push(`search:${text}`))]),
    box("main", [leaf("prompt", (text) => inserted.push(text), true)]),
  ]);
  const editor = findPromptEditor(root);
  assert.ok(editor);
  assert.equal(editor.id, "prompt");
  editor.insertText("hello");
  assert.deepEqual(inserted, ["hello"]);
});

test("findPromptEditor prefers a focused editor when no id matches", () => {
  const root = box("root", [leaf("input-a", () => {}, false), leaf("input-b", () => {}, true)]);
  assert.equal(findPromptEditor(root)?.id, "input-b");
});

test("findPromptEditor returns undefined without editable nodes", () => {
  assert.equal(findPromptEditor(box("root", [box("x", [])])), undefined);
  assert.equal(findPromptEditor(undefined), undefined);
});

test("clipboard commands are platform specific", () => {
  assert.deepEqual(clipboardCommandsFor("darwin").read, [{ command: "pbpaste", args: [] }]);
  assert.deepEqual(clipboardCommandsFor("darwin").write, [{ command: "pbcopy", args: [] }]);
  assert.equal(clipboardCommandsFor("linux").write[0]?.command, "wl-copy");
  assert.equal(clipboardCommandsFor("win32").write[0]?.command, "powershell");
});

test("the renderer strategy inserts through the prompt editor", async () => {
  const inserted: string[] = [];
  const { context } = makeContext(box("root", [box("composer", [leaf("prompt", (text) => inserted.push(text), true)])]));
  const bridge = createPromptBridge(context, { restoreClipboard: false });
  const strategy = await bridge.insert("hello world");
  assert.equal(strategy, "renderer");
  assert.deepEqual(inserted, ["hello world"]);
});

test("the auto strategy falls back to the clipboard when no editor is found", async () => {
  const { context, dispatched } = makeContext();
  const writes: string[] = [];
  const bridge = createPromptBridge(context, {
    clipboard: {
      read: async () => undefined,
      write: async (text) => {
        writes.push(text);
      },
    },
  });
  const strategy = await bridge.insert("fallback text");
  assert.equal(strategy, "clipboard");
  assert.ok(writes.includes("fallback text"));
  assert.deepEqual(dispatched, ["prompt.paste"]);
});

test("the clipboard strategy restores the previous clipboard content", async () => {
  const { context } = makeContext();
  const writes: string[] = [];
  const bridge = createPromptBridge(context, {
    clipboard: {
      read: async () => "previous content",
      write: async (text) => {
        writes.push(text);
      },
    },
  });
  const strategy = await bridge.insert("clipboard text", "clipboard");
  assert.equal(strategy, "clipboard");
  assert.deepEqual(writes, ["clipboard text"]);
  // The restore happens after a short delay.
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(writes, ["clipboard text", "previous content"]);
});

test("the send strategy posts directly to the current session", async () => {
  const { context, sent } = makeContext();
  const bridge = createPromptBridge(context, { sessionID: () => "ses_123" });
  const strategy = await bridge.insert("post me", "send");
  assert.equal(strategy, "send");
  assert.deepEqual(sent, [{ sessionID: "ses_123", text: "post me" }]);
});

test("send without an active session fails with a clear error", async () => {
  const { context } = makeContext();
  const bridge = createPromptBridge(context, { sessionID: () => undefined });
  await assert.rejects(bridge.insert("x", "send"), /No active session/);
});

test("insertion fails cleanly when no editor and no clipboard are available", async () => {
  const { context } = makeContext();
  const bridge = createPromptBridge(context, {
    clipboard: {
      read: async () => undefined,
      write: async () => {
        throw new Error("no clipboard available");
      },
    },
  });
  await assert.rejects(bridge.insert("hello"), /Could not insert the transcript/);
});

test("the renderer-only method fails without an editor", async () => {
  const { context } = makeContext();
  const bridge = createPromptBridge(context, { restoreClipboard: false });
  await assert.rejects(bridge.insert("hello", "renderer"), /Could not find the OpenCode prompt editor/);
});

test("submit dispatches input.submit and falls back to prompt.submit", async () => {
  const first = makeContext();
  await createPromptBridge(first.context).submit();
  assert.deepEqual(first.dispatched, ["input.submit"]);

  const dispatched: string[] = [];
  const context = {
    renderer: { root: box("root", []), requestRender: () => {} },
    keymap: {
      dispatch: (id: string) => {
        if (id === "input.submit") throw new Error("unreachable");
        dispatched.push(id);
      },
    },
    client: { session: { prompt: async () => {} } },
  } as unknown as Context;
  await createPromptBridge(context).submit();
  assert.deepEqual(dispatched, ["prompt.submit"]);
});
