/**
 * Reliable clipboard writes for "Open in Claude / ChatGPT / …" flows.
 * Falls back to execCommand when navigator.clipboard is blocked (focus, permissions, etc.).
 */

import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";

function copyTextViaExecCommand(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function writeTextToClipboardBestEffort(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through */
  }
  return copyTextViaExecCommand(text);
}

/** Copy prompt for “Copy prompt” buttons and manual export. */
export async function copyExternalAiPrompt(prompt: string): Promise<boolean> {
  if (!prompt.trim()) return false;
  return writeTextToClipboardBestEffort(withPromptBenchmarkNotice(prompt));
}
