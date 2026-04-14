/**
 * Google Gemini web (gemini.google.com) — no prompt in the URL; open the app and paste from clipboard.
 */

import {
  CHATGPT_LONG_URL_NOTICE,
  EXTERNAL_AI_URL_BEHAVIOR_NOTE,
  EXTERNAL_AI_URL_TRUNCATION_NOTE,
} from "@/lib/chatgpt-open-url";
import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";

/** Border/text for “Open in Gemini” / “Update all via Gemini” (yellow — distinct from ChatGPT red / DeepSeek blue). */
export const GEMINI_UI_BUTTON_COLOR = "#EAB308";

export const GEMINI_NEW_CHAT_ORIGIN = "https://gemini.google.com/app";

export const GEMINI_LONG_URL_NOTICE = CHATGPT_LONG_URL_NOTICE;

/** After intros that already say the prompt is copied. */
export const CHATGPT_DEEPSEEK_GEMINI_LONG_URL_NOTICES = EXTERNAL_AI_URL_TRUNCATION_NOTE;

/** Single line for tabs. */
export const OPEN_IN_EXTERNAL_AI_FULL_LINE = `Open in Claude, ChatGPT, Gemini, or DeepSeek. ${EXTERNAL_AI_URL_BEHAVIOR_NOTE}`;

export type GeminiOpenStatusFn = (wasShortened: boolean, copyFailed: boolean) => string;

export function geminiOpenStatusMessage(_wasShortened: boolean, copyFailed: boolean): string {
  if (copyFailed) {
    return "Gemini opened. Prompt could not be copied — use the prompt below and paste into the chat, then press Enter.";
  }
  return "Gemini opened. Prompt copied — paste into the chat and press Enter.";
}

export function openGeminiNewChatWindow(): void {
  window.open(GEMINI_NEW_CHAT_ORIGIN, "_blank", "noopener,noreferrer");
}

/** Copy full prompt, then open Gemini. */
export async function openGeminiWithClipboard(
  prompt: string,
  setStatusMessage: (s: string | null) => void,
  setClipboardFailed: (b: boolean) => void,
  buildStatus: GeminiOpenStatusFn = geminiOpenStatusMessage
): Promise<void> {
  if (!prompt.trim()) return;
  setStatusMessage(null);
  setClipboardFailed(false);
  try {
    await navigator.clipboard.writeText(withPromptBenchmarkNotice(prompt));
  } catch {
    setClipboardFailed(true);
    openGeminiNewChatWindow();
    setStatusMessage(buildStatus(false, true));
    return;
  }
  setClipboardFailed(false);
  openGeminiNewChatWindow();
  setStatusMessage(buildStatus(false, false));
}
