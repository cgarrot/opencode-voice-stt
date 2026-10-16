import { spawn } from "node:child_process";
import type { Context } from "@opencode/plugin/tui/context";
import type { InsertMethod } from "../config/types";
import { formatError } from "../utils/text";

/**
 * Prompt bridge — how a transcript reaches the OpenCode prompt.
 *
 * OpenCode V2 has no public API to set the prompt composer text (V1 had
 * `api.client.tui.appendPrompt`). This module hides that gap behind ordered,
 * feature-detected strategies:
 *
 * 1. "renderer": walk the OpenTUI renderable tree and `insertText()` into the
 *    prompt editor (the same buffer the user types into).
 * 2. "clipboard": write the transcript to the clipboard and dispatch the
 *    built-in `prompt.paste` command, then restore the previous clipboard.
 * 3. "send": post the transcript straight to the session (explicit opt-in via
 *    `output.insertMethod: "send"`).
 *
 * "auto" tries renderer, then clipboard, and fails with an actionable error
 * instead of silently posting the transcript to the model.
 */

export type InsertStrategy = "renderer" | "clipboard" | "send";
export type DebugLogger = (message: string) => void;

type RenderableLike = {
  id?: unknown;
  focused?: unknown;
  getChildren?: () => unknown;
  insertText?: (text: string) => unknown;
  focus?: () => unknown;
};

export type PromptEditor = {
  id: string;
  focused: boolean;
  insertText(text: string): void;
  focus(): void;
};

const isFunction = (value: unknown): value is (...args: never[]) => unknown => typeof value === "function";

const collectPrompEditorCandidates = (root: unknown, log?: DebugLogger): PromptEditor[] => {
  const candidates: Array<PromptEditor & { score: number }> = [];
  const seen = new Set<unknown>();
  let visited = 0;

  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || seen.has(node) || visited > 5000) return;
    seen.add(node);
    visited += 1;
    const renderable = node as RenderableLike;
    const id = typeof renderable.id === "string" ? renderable.id : "";
    if (isFunction(renderable.insertText)) {
      const focused = renderable.focused === true;
      const lowerId = id.toLowerCase();
      const score =
        (id === "prompt" ? 100 : lowerId.includes("prompt") ? 60 : lowerId.startsWith("textarea") ? 40 : 0) +
        (focused ? 30 : 0) +
        Math.min(depth, 9);
      candidates.push({
        id,
        focused,
        score,
        insertText: (text: string) => void (renderable.insertText as (value: string) => unknown)(text),
        focus: isFunction(renderable.focus) ? () => void (renderable.focus as () => unknown)() : () => {},
      });
      log?.(`prompt-bridge: editor candidate id="${id}" focused=${focused} score=${score}`);
    }
    if (isFunction(renderable.getChildren)) {
      let children: unknown;
      try {
        children = (renderable.getChildren as () => unknown)();
      } catch {
        return;
      }
      if (Array.isArray(children)) {
        for (const child of children) visit(child, depth + 1);
      }
    }
  };

  visit(root, 0);
  return candidates.sort((left, right) => left.score - right.score || 0);
};

/** Best guess for the prompt editor inside a renderable tree; undefined when none exists. */
export const findPromptEditor = (root: unknown, log?: DebugLogger): PromptEditor | undefined => {
  const candidates = collectPrompEditorCandidates(root, log);
  return candidates[candidates.length - 1];
};

export type ClipboardCommand = { command: string; args: string[] };

/** Clipboard read/write commands per platform, tried in order. Pure for tests. */
export const clipboardCommandsFor = (platform: NodeJS.Platform): { read: ClipboardCommand[]; write: ClipboardCommand[] } => {
  if (platform === "darwin") {
    return { read: [{ command: "pbpaste", args: [] }], write: [{ command: "pbcopy", args: [] }] };
  }
  if (platform === "win32") {
    return {
      read: [{ command: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard"] }],
      write: [{ command: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", "$input | Set-Clipboard"] }],
    };
  }
  return {
    read: [
      { command: "wl-paste", args: ["--no-newline"] },
      { command: "xclip", args: ["-selection", "clipboard", "-o"] },
      { command: "xsel", args: ["--clipboard", "--output"] },
    ],
    write: [
      { command: "wl-copy", args: [] },
      { command: "xclip", args: ["-selection", "clipboard", "-i"] },
      { command: "xsel", args: ["--clipboard", "--input"] },
    ],
  };
};

const runClipboardCommand = (spec: ClipboardCommand, input?: string): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.on("error", fail);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout);
      else reject(new Error(`${spec.command} exited with code ${code ?? "unknown"}`));
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
  });

const tryClipboardCommands = async (commands: ClipboardCommand[], input?: string): Promise<string> => {
  let lastError: unknown;
  for (const spec of commands) {
    try {
      return await runClipboardCommand(spec, input);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No clipboard command available.");
};

export const readClipboard = (platform: NodeJS.Platform = process.platform): Promise<string> =>
  tryClipboardCommands(clipboardCommandsFor(platform).read);

export const writeClipboard = async (text: string, platform: NodeJS.Platform = process.platform): Promise<void> => {
  await tryClipboardCommands(clipboardCommandsFor(platform).write, text);
};

export type PromptBridgeOptions = {
  debug?: DebugLogger | undefined;
  /** Current session id, used by the "send" strategy. */
  sessionID?: () => string | undefined;
  /** Test override for the platform used by the clipboard helpers. */
  platform?: NodeJS.Platform;
  /** Test override for clipboard access (defaults to the platform commands). */
  clipboard?: {
    read(): Promise<string | undefined>;
    write(text: string): Promise<void>;
  };
  /** Restore the previous clipboard after a paste (default true). */
  restoreClipboard?: boolean;
};

export const createPromptBridge = (context: Context, options: PromptBridgeOptions = {}) => {
  const log = options.debug;
  const platform = options.platform ?? process.platform;
  const restoreClipboard = options.restoreClipboard !== false;
  const clipboard = options.clipboard ?? {
    read: () => readClipboard(platform).catch(() => undefined),
    write: (text: string) => writeClipboard(text, platform),
  };

  const insertViaRenderer = (text: string): boolean => {
    try {
      const editor = findPromptEditor(context.renderer.root, log);
      if (!editor) {
        log?.("prompt-bridge: no editable renderable found in the renderer tree");
        return false;
      }
      try {
        editor.focus();
      } catch {
        // Focus is best-effort; the insert below still targets the buffer.
      }
      editor.insertText(text);
      log?.(`prompt-bridge: inserted ${text.length} character(s) via renderer (id "${editor.id || "unidentified"}")`);
      return true;
    } catch (error) {
      log?.(`prompt-bridge: renderer insert failed: ${formatError(error)}`);
      return false;
    }
  };

  const insertViaClipboard = async (text: string): Promise<boolean> => {
    try {
      const previous = restoreClipboard ? await clipboard.read().catch(() => undefined) : undefined;
      await clipboard.write(text);
      context.keymap.dispatch("prompt.paste");
      if (previous !== undefined && previous !== text) {
        setTimeout(() => {
          void clipboard.write(previous).catch(() => {});
        }, 250);
      }
      log?.("prompt-bridge: inserted via clipboard + prompt.paste");
      return true;
    } catch (error) {
      log?.(`prompt-bridge: clipboard insert failed: ${formatError(error)}`);
      return false;
    }
  };

  const sendDirect = async (text: string): Promise<void> => {
    const sessionID = options.sessionID?.();
    if (!sessionID) throw new Error("No active session to send the transcript to.");
    await context.client.session.prompt({ sessionID, text });
    log?.(`prompt-bridge: sent transcript directly to session ${sessionID}`);
  };

  return {
    findEditor: () => findPromptEditor(context.renderer.root, log),
    async insert(text: string, method: InsertMethod = "auto"): Promise<InsertStrategy> {
      if (!text) return "renderer";

      if (method === "send") {
        await sendDirect(text);
        return "send";
      }

      if (method === "renderer") {
        if (insertViaRenderer(text)) return "renderer";
        throw new Error("Could not find the OpenCode prompt editor. Set output.insertMethod to \"clipboard\" or \"send\" to change the delivery strategy.");
      }

      if (method === "clipboard") {
        if (await insertViaClipboard(text)) return "clipboard";
        throw new Error("Could not insert the transcript through the clipboard. Set output.insertMethod to \"send\" to post transcripts directly.");
      }

      if (insertViaRenderer(text)) return "renderer";
      if (await insertViaClipboard(text)) return "clipboard";
      throw new Error("Could not insert the transcript into the prompt. Set output.insertMethod to \"send\" in the STT config to post transcripts directly to chat.");
    },
    async submit(): Promise<void> {
      let lastError: unknown;
      for (const id of ["input.submit", "prompt.submit"]) {
        try {
          context.keymap.dispatch(id);
          log?.(`prompt-bridge: dispatched ${id}`);
          return;
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(`Could not submit the prompt: ${formatError(lastError)}`);
    },
    sendDirect,
  };
};

export type PromptBridge = ReturnType<typeof createPromptBridge>;
