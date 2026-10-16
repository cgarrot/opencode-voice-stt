import type { Context } from "@opencode/plugin/tui/context";
import type { CleanupConfig } from "../config/types";
import { buildCleanupSystemPrompt } from "./prompt";
import { gatherRepoContext } from "./repo-context";
import type { CleanupClient } from "./types";

/**
 * Cleanup pass powered by the current session's model through
 * `client.session.generate`: a transient generation that does not touch the
 * session history and needs no extra endpoint or API key.
 *
 * Only used when `cleanup.enabled` and `cleanup.useSession` are both true and
 * the caller can name an active session; otherwise the pipeline falls back to
 * the configured OpenAI-compatible endpoint.
 */
export const createSessionCleanup = (
  context: Context,
  config: CleanupConfig,
  sessionID: () => string | undefined,
): CleanupClient | null => {
  if (!config.enabled || !config.useSession) return null;

  return {
    async clean({ text, signal }) {
      const id = sessionID();
      if (!id) throw new Error("No active session for the session-powered cleanup pass.");

      const repoContext = await gatherRepoContext(config);
      const system = buildCleanupSystemPrompt(config, repoContext);
      const response = await context.client.session.generate(
        { sessionID: id, prompt: `${system}\n\nTranscript:\n${text}` },
        { signal },
      );

      const cleaned = typeof response.text === "string" ? response.text.trim() : "";
      if (!cleaned) throw new Error("Session cleanup returned no text.");
      return cleaned;
    },
  };
};
