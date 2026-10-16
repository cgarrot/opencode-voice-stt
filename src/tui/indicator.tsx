/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js";
import type { Context } from "@opencode/plugin/tui/context";
import { DEFAULT_PROFILE } from "../config/profiles";
import type { DictationMode } from "../core/dictation-controller";
import type { Strings } from "../i18n/strings";
import { indicatorColorFrom, indicatorCompactFrame } from "./indicator-frame";

/**
 * Voice state indicator, overlaid at the right end of the composer status line
 * (the row showing `agent · model · variant`) through the `prompt.footer` slot.
 *
 * The footer slot boundary is a laid-out row; absolute children positioned
 * with `top: -2` render on the status line two rows above it (verified
 * empirically — absolute coordinates are parent-relative). A full-width box
 * with `justifyContent: "flex-end"` pins the chip to the right edge.
 */

export type VoiceIndicatorOptions = {
  strings: Strings;
  keybind: string;
};

export const createVoiceIndicator = (context: Context, options: VoiceIndicatorOptions) => {
  const [mode, setModeSignal] = createSignal<DictationMode>("idle");
  const [profile, setProfileSignal] = createSignal(DEFAULT_PROFILE);
  const [tick, setTick] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopAnimation = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  };

  const startAnimation = () => {
    if (timer) return;
    timer = setInterval(() => {
      setTick((value) => value + 1);
      context.renderer.requestRender();
    }, 120);
  };

  const syncAnimation = () => {
    if (mode() === "idle") stopAnimation();
    else startAnimation();
  };

  return {
    setMode(nextMode: DictationMode) {
      setModeSignal(nextMode);
      setTick((value) => value + 1);
      syncAnimation();
      context.renderer.requestRender();
    },
    setProfile(nextProfile: string) {
      setProfileSignal(nextProfile);
      context.renderer.requestRender();
    },
    dispose() {
      stopAnimation();
      setModeSignal("idle");
      setProfileSignal(DEFAULT_PROFILE);
    },
    /**
     * Rendered inside the `prompt.footer` slot: an absolute, full-width box
     * two rows above (the composer status line), with its content pinned to
     * the right edge.
     */
    render() {
      const frame = indicatorCompactFrame(mode(), tick(), options.strings, options.keybind, profile());
      const fg = indicatorColorFrom(context.theme, frame.color);
      return (
        <box
          position="absolute"
          top={-2}
          left={0}
          width="100%"
          height={1}
          flexDirection="row"
          justifyContent="flex-end"
          paddingRight={1}
          zIndex={999}
          flexShrink={0}
        >
          <text fg={fg} wrapMode="none" selectable={false}>
            {frame.label}
          </text>
        </box>
      );
    },
  };
};

export type VoiceIndicator = ReturnType<typeof createVoiceIndicator>;
