import type { OutputConfig } from "../config/types";

export const formatTranscriptForPrompt = (text: string, output: OutputConfig): string => {
  const normalized = text.trim();
  if (!normalized) return "";
  return output.appendTrailingSpace ? `${normalized} ` : normalized;
};
