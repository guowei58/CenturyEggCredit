/**
 * ChatGPT "new chat" prefill uses `?q=` in the URL. Browsers and hosts cap URL length, so long prompts
 * cannot be embedded losslessly. Full text is copied to the clipboard; when shortened, the URL carries
 * a paste-first banner plus a structured outline (see `external-web-chat-url.ts`).
 */

import { buildWebChatUrlWithQueryBudget, WEB_CHAT_MAX_HREF_LENGTH } from "@/lib/external-web-chat-url";

export const CHATGPT_NEW_CHAT_ORIGIN = "https://chat.openai.com/";

const CHATGPT_Q_PREFIX = `${CHATGPT_NEW_CHAT_ORIGIN}?q=`;

/**
 * Shown next to a single provider (e.g. bulk “Update all via ChatGPT” tooltip).
 */
export const CHATGPT_LONG_URL_NOTICE =
  "Long prompts may be shortened to fit the link; the full text is copied—use Copy prompt if needed.";

/** URL-length / prefill caveat (use after text that already says the prompt was copied). */
export const EXTERNAL_AI_URL_TRUNCATION_NOTE =
  "ChatGPT, DeepSeek, and Gemini may shorten very long URLs—use Copy prompt for the full text; paste if prefill fails.";

/**
 * Standalone sentence for tabs that don’t already mention the clipboard.
 */
export const EXTERNAL_AI_URL_BEHAVIOR_NOTE = `Prompt is copied. ${EXTERNAL_AI_URL_TRUNCATION_NOTE}`;

export function chatGptOpenStatusMessage(wasShortened: boolean, copyFailed: boolean): string {
  if (copyFailed) {
    return wasShortened
      ? "ChatGPT opened. Copy failed — select the prompt in OREO and paste; the tab may only show an outline, not the full text."
      : "ChatGPT opened in a new tab. Prompt could not be copied — use the prompt below and paste.";
  }
  if (wasShortened) {
    return "ChatGPT opened. The link fits the URL limit using a paste-first banner + outline; the FULL prompt was copied — paste into ChatGPT for complete instructions.";
  }
  return "ChatGPT opened in a new tab. Prompt copied to clipboard — paste if it didn't prefill.";
}

export type ExternalWebChatStatusFn = (wasShortened: boolean, copyFailed: boolean) => string;

export function buildChatGptNewChatUrl(fullPrompt: string): { href: string; wasShortened: boolean } {
  return buildWebChatUrlWithQueryBudget(fullPrompt, CHATGPT_Q_PREFIX, WEB_CHAT_MAX_HREF_LENGTH);
}

export function openChatGptNewChatWindow(fullPrompt: string): { wasShortened: boolean } {
  const { href, wasShortened } = buildChatGptNewChatUrl(fullPrompt);
  window.open(href, "_blank", "noopener,noreferrer");
  return { wasShortened };
}

/**
 * Copies the full prompt first, then opens ChatGPT so paste wins any race when switching tabs.
 */
export async function openChatGptWithClipboard(
  prompt: string,
  setStatusMessage: (s: string | null) => void,
  setClipboardFailed: (b: boolean) => void,
  buildStatus: ExternalWebChatStatusFn = chatGptOpenStatusMessage
): Promise<void> {
  if (!prompt.trim()) return;
  setStatusMessage(null);
  setClipboardFailed(false);
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    setClipboardFailed(true);
    const { wasShortened } = openChatGptNewChatWindow(prompt);
    setStatusMessage(buildStatus(wasShortened, true));
    return;
  }
  setClipboardFailed(false);
  const { wasShortened } = openChatGptNewChatWindow(prompt);
  setStatusMessage(buildStatus(wasShortened, false));
}
