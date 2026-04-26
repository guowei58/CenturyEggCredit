/**
 * ChatGPT web (chatgpt.com) — no prompt in the URL. Copy the prompt, then open a new chat; paste from the clipboard.
 */

import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";

export const CHATGPT_NEW_CHAT_ORIGIN = "https://chatgpt.com/";

/** Legacy alias: same as opening the web app root (no query string). */
export const CHATGPT_NEW_CHAT_HREF = CHATGPT_NEW_CHAT_ORIGIN;

/** @deprecated Kept for import compatibility; same idea as {@link EXTERNAL_AI_URL_TRUNCATION_NOTE}. */
export const CHATGPT_LONG_URL_NOTICE =
  "When you open a chat page, the prompt is already on your clipboard—paste it into the context window and press Enter (not loaded from the URL).";

/** @deprecated URL prefill removed. */
export const EXTERNAL_AI_URL_TRUNCATION_NOTE =
  "Web chat links do not include the prompt in the URL; the full text is on your clipboard when you open the chat.";

/** Shown after “Open in Claude, ChatGPT, Gemini, or DeepSeek.” on tabs that use external web chat + paste-back. */
export const EXTERNAL_AI_URL_BEHAVIOR_NOTE = `When you open a chat page, the prompt is already on your clipboard—paste it into the context window and press Enter. Once you get the answer, you can copy (by pressing the copy button in your chat result) and paste the results back into OREO. This will paste the results, along with all the formatting specs into OREO. Once you press "Save", the results will be formatted in the right way.`;

export function chatGptOpenStatusMessage(copyFailed: boolean): string {
  if (copyFailed) {
    return "ChatGPT opened. Prompt could not be copied — use the prompt below and paste into the chat, then press Enter.";
  }
  return "ChatGPT opened. Prompt copied — paste into the chat and press Enter.";
}

/** Second arg: clipboard copy failed. */
export type ExternalWebChatStatusFn = (wasShortened: boolean, copyFailed: boolean) => string;

export function openChatGptNewChatWindow(): void {
  window.open(CHATGPT_NEW_CHAT_HREF, "_blank", "noopener,noreferrer");
}

/**
 * Copies the full prompt first, then opens ChatGPT (same pattern as Claude / Gemini / DeepSeek web opens).
 */
export async function openChatGptWithClipboard(
  prompt: string,
  setStatusMessage: (s: string | null) => void,
  setClipboardFailed: (b: boolean) => void,
  buildStatus: ExternalWebChatStatusFn = (_wasShortened, copyFailed) => chatGptOpenStatusMessage(copyFailed)
): Promise<void> {
  if (!prompt.trim()) return;
  setStatusMessage(null);
  setClipboardFailed(false);
  try {
    await navigator.clipboard.writeText(withPromptBenchmarkNotice(prompt));
  } catch {
    setClipboardFailed(true);
    openChatGptNewChatWindow();
    setStatusMessage(buildStatus(false, true));
    return;
  }
  setClipboardFailed(false);
  openChatGptNewChatWindow();
  setStatusMessage(buildStatus(false, false));
}
