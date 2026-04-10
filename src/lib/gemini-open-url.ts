/**
 * Google Gemini web app (gemini.google.com) — open with optional `?q=` prefill (undocumented; may not
 * always populate the composer). Same URL-length strategy as ChatGPT / DeepSeek; full prompt is copied
 * before opening the tab when using Open in Gemini.
 */

import {
  CHATGPT_LONG_URL_NOTICE,
  EXTERNAL_AI_URL_BEHAVIOR_NOTE,
  EXTERNAL_AI_URL_TRUNCATION_NOTE,
} from "@/lib/chatgpt-open-url";
import { buildWebChatUrlWithQueryBudget, WEB_CHAT_MAX_HREF_LENGTH } from "@/lib/external-web-chat-url";

/** Border/text for “Open in Gemini” / “Update all via Gemini” (yellow — distinct from ChatGPT red / DeepSeek blue). */
export const GEMINI_UI_BUTTON_COLOR = "#EAB308";

export const GEMINI_NEW_CHAT_ORIGIN = "https://gemini.google.com/app";

const GEMINI_Q_PREFIX = `${GEMINI_NEW_CHAT_ORIGIN}?q=`;

export const GEMINI_LONG_URL_NOTICE = CHATGPT_LONG_URL_NOTICE;

/** After intros that already say the prompt is copied (e.g. “Open in AI; copy attaches…”). */
export const CHATGPT_DEEPSEEK_GEMINI_LONG_URL_NOTICES = EXTERNAL_AI_URL_TRUNCATION_NOTE;

/** Single line for tabs that previously duplicated intro + three notices. */
export const OPEN_IN_EXTERNAL_AI_FULL_LINE = `Open in Claude, ChatGPT, Gemini, or DeepSeek. ${EXTERNAL_AI_URL_BEHAVIOR_NOTE}`;

export type GeminiOpenStatusFn = (wasShortened: boolean, copyFailed: boolean) => string;

export function geminiOpenStatusMessage(wasShortened: boolean, copyFailed: boolean): string {
  if (copyFailed) {
    return wasShortened
      ? "Gemini opened. Copy failed — select the prompt in OREO and paste; the tab may only show an outline, not the full text."
      : "Gemini opened in a new tab. Prompt could not be copied — use the prompt below and paste.";
  }
  if (wasShortened) {
    return "Gemini opened. The link fits the URL limit using a paste-first banner + outline; the FULL prompt was copied — paste into Gemini for complete instructions.";
  }
  return "Gemini opened in a new tab. Prompt copied to clipboard — paste if it didn't prefill.";
}

export function buildGeminiNewChatUrl(fullPrompt: string): { href: string; wasShortened: boolean } {
  return buildWebChatUrlWithQueryBudget(fullPrompt, GEMINI_Q_PREFIX, WEB_CHAT_MAX_HREF_LENGTH);
}

export function openGeminiNewChatWindow(fullPrompt: string): { wasShortened: boolean } {
  const { href, wasShortened } = buildGeminiNewChatUrl(fullPrompt);
  window.open(href, "_blank", "noopener,noreferrer");
  return { wasShortened };
}

/** Open Gemini tab after copying full prompt (copy runs first to avoid races with tab focus). */
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
    await navigator.clipboard.writeText(prompt);
  } catch {
    setClipboardFailed(true);
    const { wasShortened } = openGeminiNewChatWindow(prompt);
    setStatusMessage(buildStatus(wasShortened, true));
    return;
  }
  setClipboardFailed(false);
  const { wasShortened } = openGeminiNewChatWindow(prompt);
  setStatusMessage(buildStatus(wasShortened, false));
}
