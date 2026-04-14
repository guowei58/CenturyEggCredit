/**
 * Claude web (claude.ai) — we do not put the prompt in the URL. Open a blank new chat and rely on clipboard.
 */

import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";

export const CLAUDE_NEW_CHAT_URL = "https://claude.ai/new";

export function openClaudeNewChatWindow(): void {
  window.open(CLAUDE_NEW_CHAT_URL, "_blank", "noopener,noreferrer");
}

export function claudeOpenStatusMessage(copyFailed: boolean): string {
  if (copyFailed) {
    return "Claude opened. Prompt could not be copied — use the prompt below and paste into the chat, then press Enter.";
  }
  return "Claude opened. Prompt copied — paste into the chat and press Enter.";
}

export type ClaudeWebChatStatusFn = (copyFailed: boolean) => string;

/**
 * Copies the full prompt first, then opens Claude so the clipboard is ready before you switch tabs.
 */
export async function openClaudeWithClipboard(
  prompt: string,
  setStatusMessage: (s: string | null) => void,
  setClipboardFailed: (b: boolean) => void,
  buildStatus: ClaudeWebChatStatusFn = claudeOpenStatusMessage
): Promise<void> {
  if (!prompt.trim()) return;
  setStatusMessage(null);
  setClipboardFailed(false);
  try {
    await navigator.clipboard.writeText(withPromptBenchmarkNotice(prompt));
  } catch {
    setClipboardFailed(true);
    openClaudeNewChatWindow();
    setStatusMessage(buildStatus(true));
    return;
  }
  setClipboardFailed(false);
  openClaudeNewChatWindow();
  setStatusMessage(buildStatus(false));
}
