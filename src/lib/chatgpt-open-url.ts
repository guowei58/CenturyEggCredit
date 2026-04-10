/**
 * ChatGPT web — clear the clipboard, then open a clean tab. ChatGPT’s site reads the system
 * clipboard when a new chat loads and can paste it into the composer; the prompt often stays on the
 * clipboard after “Copy prompt” or “Open in Claude / Gemini / DeepSeek” (those paths copy the text).
 * Other web chats leave the composer empty. Overwriting the clipboard right before `window.open`
 * avoids that hoover (do not use an empty string — Chromium often ignores it and leaves the old text).
 * Use “Copy prompt” in this app, then paste in ChatGPT.
 */

export const CHATGPT_NEW_CHAT_ORIGIN = "https://chatgpt.com/";

/** Legacy alias: same as opening the web app root (no query string). */
export const CHATGPT_NEW_CHAT_HREF = CHATGPT_NEW_CHAT_ORIGIN;

/** @deprecated No longer used for UI copy; kept for any import compatibility. */
export const CHATGPT_LONG_URL_NOTICE =
  "The prompt is copied to your clipboard—paste into the chat and press Enter (not loaded from the URL).";

/** @deprecated URL prefill removed. */
export const EXTERNAL_AI_URL_TRUNCATION_NOTE =
  "Web chat links do not include the prompt in the URL; the full text is on your clipboard.";

export const EXTERNAL_AI_URL_BEHAVIOR_NOTE =
  "For ChatGPT: we clear the clipboard before opening so the site won’t auto-paste; use Copy prompt here, then paste. Claude / Gemini / DeepSeek still copy when you open them.";

export function chatGptOpenStatusMessage(clearClipboardFailed: boolean): string {
  if (clearClipboardFailed) {
    return "ChatGPT opened. Clipboard could not be cleared — if the chat prefilled, erase it. Use Copy prompt here, then paste.";
  }
  return "ChatGPT opened. Clipboard cleared so it won’t auto-paste. Use Copy prompt here, paste into ChatGPT, then press Enter.";
}

/** Second arg: clipboard clear failed (ChatGPT may still prefill from an old clipboard). */
export type ExternalWebChatStatusFn = (wasShortened: boolean, clearClipboardFailed: boolean) => string;

export function openChatGptNewChatWindow(): void {
  window.open(CHATGPT_NEW_CHAT_HREF, "_blank", "noopener,noreferrer");
}

/**
 * Browsers often treat `clipboard.writeText("")` as a no-op, leaving the previous text on the
 * clipboard — ChatGPT then pastes that full prompt into the composer. Overwrite with a single
 * zero-width space so the clipboard changes without meaningful visible text if something pastes it.
 */
const CLIPBOARD_NEUTRAL_TEXT = "\u200b";

async function clearSystemClipboardBestEffort(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(CLIPBOARD_NEUTRAL_TEXT);
    return true;
  } catch {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([CLIPBOARD_NEUTRAL_TEXT], { type: "text/plain" }),
        }),
      ]);
      return true;
    } catch {
      try {
        await navigator.clipboard.writeText(" ");
        return true;
      } catch {
        return false;
      }
    }
  }
}

/**
 * Clears the clipboard, then opens ChatGPT. See file header — avoids ChatGPT reading a leftover prompt.
 */
export async function openChatGptWithClipboard(
  prompt: string,
  setStatusMessage: (s: string | null) => void,
  setClipboardFailed: (b: boolean) => void,
  buildStatus: ExternalWebChatStatusFn = (_wasShortened, clearFailed) => chatGptOpenStatusMessage(clearFailed)
): Promise<void> {
  if (!prompt.trim()) return;
  setStatusMessage(null);
  const cleared = await clearSystemClipboardBestEffort();
  setClipboardFailed(!cleared);
  openChatGptNewChatWindow();
  setStatusMessage(buildStatus(false, !cleared));
}
