/**
 * DeepSeek Chat (chat.deepseek.com) — open new chat with optional `?q=` prefill (undocumented; may not populate).
 * Full prompt is copied before opening the tab when using Open in DeepSeek.
 */

import { CHATGPT_LONG_URL_NOTICE } from "@/lib/chatgpt-open-url";
import { buildWebChatUrlWithQueryBudget, WEB_CHAT_MAX_HREF_LENGTH } from "@/lib/external-web-chat-url";

export const DEEPSEEK_CHAT_ORIGIN = "https://chat.deepseek.com/";

const DEEPSEEK_Q_PREFIX = `${DEEPSEEK_CHAT_ORIGIN}?q=`;

export const DEEPSEEK_LONG_URL_NOTICE = CHATGPT_LONG_URL_NOTICE;

export type DeepSeekOpenStatusFn = (wasShortened: boolean, copyFailed: boolean) => string;

export function deepSeekOpenStatusMessage(wasShortened: boolean, copyFailed: boolean): string {
  if (copyFailed) {
    return wasShortened
      ? "DeepSeek opened. Copy failed — select the prompt in OREO and paste; the tab may only show an outline, not the full text."
      : "DeepSeek opened in a new tab. Prompt could not be copied — use the prompt below and paste.";
  }
  if (wasShortened) {
    return "DeepSeek opened. The link fits the URL limit using a paste-first banner + outline; the FULL prompt was copied — paste into DeepSeek for complete instructions.";
  }
  return "DeepSeek opened in a new tab. Prompt copied to clipboard — paste if it didn't prefill.";
}

export function buildDeepSeekNewChatUrl(fullPrompt: string): { href: string; wasShortened: boolean } {
  return buildWebChatUrlWithQueryBudget(fullPrompt, DEEPSEEK_Q_PREFIX, WEB_CHAT_MAX_HREF_LENGTH);
}

export function openDeepSeekNewChatWindow(fullPrompt: string): { wasShortened: boolean } {
  const { href, wasShortened } = buildDeepSeekNewChatUrl(fullPrompt);
  window.open(href, "_blank", "noopener,noreferrer");
  return { wasShortened };
}

/** Open DeepSeek tab after copying full prompt (copy runs first to avoid races with tab focus). */
export async function openDeepSeekWithClipboard(
  prompt: string,
  setStatusMessage: (s: string | null) => void,
  setClipboardFailed: (b: boolean) => void,
  buildStatus: DeepSeekOpenStatusFn = deepSeekOpenStatusMessage
): Promise<void> {
  if (!prompt.trim()) return;
  setStatusMessage(null);
  setClipboardFailed(false);
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    setClipboardFailed(true);
    const { wasShortened } = openDeepSeekNewChatWindow(prompt);
    setStatusMessage(buildStatus(wasShortened, true));
    return;
  }
  setClipboardFailed(false);
  const { wasShortened } = openDeepSeekNewChatWindow(prompt);
  setStatusMessage(buildStatus(wasShortened, false));
}
