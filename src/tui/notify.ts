import type { Context } from "@opencode/plugin/tui/context";
import type { DictationToast } from "../core/dictation-controller";

/** Product name; treated as a brand and never localized. */
export const BRAND = "OpenCode Voice STT";

/**
 * Show a dictation toast in the OpenCode TUI. The controller already sets the
 * brand as the toast title, so the message is shown as-is with the standard
 * four variants.
 */
export const showToast = (context: Context, toast: DictationToast): void => {
  context.ui.toast.show({
    title: toast.title ?? BRAND,
    message: toast.message,
    variant: toast.variant ?? "info",
    ...(typeof toast.duration === "number" ? { duration: toast.duration } : {}),
  });
};
