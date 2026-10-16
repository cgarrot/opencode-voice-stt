import { DEFAULT_PROFILE } from "../config/profiles";
import type { DictationMode } from "../core/dictation-controller";
import type { Strings } from "../i18n/strings";

/**
 * Pure presentation logic for the prompt-footer voice indicator. Kept in a
 * plain module (no JSX) so it can be unit-tested without a TUI.
 */

export const PROCESSING_FRAMES = ["•  ", " • ", "  •", " • "] as const;

export type IndicatorColor = "dim" | "accent" | "error" | "warning";

export type IndicatorFrame = {
  label: string;
  color: IndicatorColor;
};

/** Build the indicator label/color for a mode and animation tick. */
export const indicatorFrame = (
  mode: DictationMode,
  tick: number,
  strings: Strings,
  keybind: string,
  profile: string,
): IndicatorFrame => {
  if (mode === "recording") {
    const dot = tick % 2 === 0 ? "●" : "○";
    return { label: `${dot} ${strings.indicator.recording} ${strings.indicator.recordingHint}`, color: "error" };
  }

  if (mode === "processing") {
    const frame = PROCESSING_FRAMES[tick % PROCESSING_FRAMES.length] ?? "…";
    return { label: `${frame} ${strings.indicator.transcribing} ${strings.indicator.transcribingHint}`, color: "warning" };
  }

  if (mode === "polishing") {
    const frame = PROCESSING_FRAMES[tick % PROCESSING_FRAMES.length] ?? "…";
    return { label: `${frame} ${strings.indicator.polishing} ${strings.indicator.polishingHint}`, color: "accent" };
  }

  const label = profile && profile !== DEFAULT_PROFILE ? `${strings.indicator.idle} · ${profile}` : strings.indicator.idle;
  return { label: `${label} ${keybind}`, color: "dim" };
};

/**
 * Compact variant for the composer status line (right-aligned next to the
 * model): no keyboard hints, shorter state labels.
 */
export const indicatorCompactFrame = (
  mode: DictationMode,
  tick: number,
  strings: Strings,
  keybind: string,
  profile: string,
): IndicatorFrame => {
  if (mode === "recording") {
    const dot = tick % 2 === 0 ? "●" : "○";
    return { label: `${dot} ${strings.indicator.recording}`, color: "error" };
  }

  if (mode === "processing") {
    const dot = tick % 2 === 0 ? "•" : "·";
    return { label: `${dot} ${strings.indicator.transcribing}`, color: "warning" };
  }

  if (mode === "polishing") {
    return { label: `· ${strings.indicator.polishing}`, color: "accent" };
  }

  const label = profile && profile !== DEFAULT_PROFILE ? `${strings.indicator.idle} · ${profile}` : strings.indicator.idle;
  return { label: `${label} ${keybind}`, color: "dim" };
};

type ThemeRecord = {
  text?: {
    base?: string;
    muted?: string;
    feedback?: Record<string, { base?: string } | undefined>;
  };
  hue?: {
    interactive?: Array<string | undefined>;
  };
};

/** Map semantic indicator colors onto OpenCode theme tokens, with fallbacks. */
export const indicatorColorFrom = (theme: unknown, color: IndicatorColor): string | undefined => {
  const record = theme as ThemeRecord | undefined;
  const feedback = record?.text?.feedback;
  switch (color) {
    case "error":
      return feedback?.error?.base ?? record?.text?.base;
    case "warning":
      return feedback?.warning?.base ?? feedback?.info?.base ?? record?.text?.base;
    case "accent":
      return feedback?.info?.base ?? record?.hue?.interactive?.[200] ?? record?.text?.base;
    default:
      return record?.text?.muted ?? record?.text?.base;
  }
};
