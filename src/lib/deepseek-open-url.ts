/**
 * DeepSeek Chat — no prompt in the URL; open the app and paste from clipboard.
 */

import { CHATGPT_LONG_URL_NOTICE } from "@/lib/chatgpt-open-url";

export const DEEPSEEK_CHAT_ORIGIN = "https://chat.deepseek.com/";

export const DEEPSEEK_LONG_URL_NOTICE = CHATGPT_LONG_URL_NOTICE;

export type DeepSeekOpenStatusFn = (wasShortened: boolean, copyFailed: boolean) => string;

export function deepSeekOpenStatusMessage(_wasShortened: boolean, copyFailed: boolean): string {
  if (copyFailed) {
    return "DeepSeek opened. Prompt could not be copied — use the prompt below and paste into the chat, then press Enter.";
  }
  return "DeepSeek opened. Prompt copied — paste into the chat and press Enter.";
}

export function openDeepSeekNewChatWindow(): void {
  window.open(DEEPSEEK_CHAT_ORIGIN, "_blank", "noopener,noreferrer");
}

/** Copy full prompt, then open DeepSeek. */
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
    openDeepSeekNewChatWindow();
    setStatusMessage(buildStatus(false, true));
    return;
  }
  setClipboardFailed(false);
  openDeepSeekNewChatWindow();
  setStatusMessage(buildStatus(false, false));
}
