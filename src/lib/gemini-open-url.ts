/**
 * Google Gemini web app (gemini.google.com) �?open with optional `?q=` prefill (undocumented; may not
 * always populate the composer). Same URL-length strategy as ChatGPT / DeepSeek; full prompt is always
 * copied to the clipboard when using Open in Gemini.
 */

import {
  CHATGPT_LONG_URL_NOTICE,
  EXTERNAL_AI_URL_BEHAVIOR_NOTE,
  EXTERNAL_AI_URL_TRUNCATION_NOTE,
} from "@/lib/chatgpt-open-url";

/** Border/text for “Open in Gemini�?/ “Update all via Gemini�?(yellow �?distinct from ChatGPT red / DeepSeek blue). */
export const GEMINI_UI_BUTTON_COLOR = "#EAB308";

export const GEMINI_NEW_CHAT_ORIGIN = "https://gemini.google.com/app";

const GEMINI_Q_PREFIX = `${GEMINI_NEW_CHAT_ORIGIN}?q=`;

const MAX_HREF_LENGTH = 5600;

function hrefLengthForQuery(query: string): number {
  return GEMINI_Q_PREFIX.length + encodeURIComponent(query).length;
}

export const GEMINI_LONG_URL_NOTICE = CHATGPT_LONG_URL_NOTICE;

/** After intros that already say the prompt is copied (e.g. “Open in AI; copy attaches…�?. */
export const CHATGPT_DEEPSEEK_GEMINI_LONG_URL_NOTICES = EXTERNAL_AI_URL_TRUNCATION_NOTE;

/** Single line for tabs that previously duplicated intro + three notices. */
export const OPEN_IN_EXTERNAL_AI_FULL_LINE = `Open in Claude, ChatGPT, Gemini, or DeepSeek. ${EXTERNAL_AI_URL_BEHAVIOR_NOTE}`;

export function geminiOpenStatusMessage(wasShortened: boolean, copyFailed: boolean): string {
  if (copyFailed) {
    return wasShortened
      ? "Gemini opened. Copy failed �?select the prompt in OREO and paste; the tab may only show a shortened version."
      : "Gemini opened in a new tab. Prompt could not be copied �?use the prompt below and paste.";
  }
  if (wasShortened) {
    return "Gemini opened. The link used a shortened prompt so it fits; the FULL prompt was copied �?paste into Gemini for complete instructions.";
  }
  return "Gemini opened in a new tab. Prompt copied to clipboard �?paste if it didn't prefill.";
}

function extractOutlineBlock(md: string, maxChars: number): string {
  const lines = md.split(/\r?\n/);
  const heads = lines.map((l) => l.trim()).filter((l) => /^#{1,6}\s+\S/.test(l));
  let block = heads.join("\n");
  if (block.length === 0) {
    block = lines.slice(0, 28).join("\n").trim();
  }
  if (block.length > maxChars) {
    block = `${block.slice(0, maxChars - 30).trim()}\n…`;
  }
  return block || "(See full prompt in OREO �?Copy prompt.)";
}

function buildShortenedTail(outline: string): string {
  return `\n\n---\nOREO �?Gemini URL length limit: text above is abbreviated. The FULL prompt was copied to your clipboard when you clicked Open �?paste it into the same chat. Deliver the same work: follow every section below with full depth.\n\nOutline / section headers from the full prompt:\n${outline}`;
}

export function buildGeminiNewChatUrl(fullPrompt: string): { href: string; wasShortened: boolean } {
  if (hrefLengthForQuery(fullPrompt) <= MAX_HREF_LENGTH) {
    return { href: GEMINI_Q_PREFIX + encodeURIComponent(fullPrompt), wasShortened: false };
  }

  let outlineMax = 1200;
  let outline = extractOutlineBlock(fullPrompt, outlineMax);
  let tail = buildShortenedTail(outline);

  while (hrefLengthForQuery(tail) > MAX_HREF_LENGTH - 500 && outlineMax > 200) {
    outlineMax = Math.floor(outlineMax * 0.75);
    outline = extractOutlineBlock(fullPrompt, outlineMax);
    tail = buildShortenedTail(outline);
  }

  let headLen = fullPrompt.length;
  while (headLen > 280) {
    let head = fullPrompt.slice(0, headLen);
    const lp = head.lastIndexOf("\n\n");
    if (lp >= 260) head = head.slice(0, lp);
    const query = head + tail;
    if (hrefLengthForQuery(query) <= MAX_HREF_LENGTH) {
      return { href: GEMINI_Q_PREFIX + encodeURIComponent(query), wasShortened: true };
    }
    headLen = Math.floor(headLen * 0.88);
  }

  const minimal =
    fullPrompt.slice(0, 240).trimEnd() +
    "\n\n---\nOREO: Prompt too long for Gemini URL. Use Copy prompt in OREO and paste the full text.\n" +
    extractOutlineBlock(fullPrompt, 800);
  return { href: GEMINI_Q_PREFIX + encodeURIComponent(minimal), wasShortened: true };
}

export function openGeminiNewChatWindow(fullPrompt: string): { wasShortened: boolean } {
  const { href, wasShortened } = buildGeminiNewChatUrl(fullPrompt);
  window.open(href, "_blank", "noopener,noreferrer");
  return { wasShortened };
}

/** Open Gemini tab + copy full prompt (same pattern as DeepSeek web chat). */
export function openGeminiWithClipboard(
  prompt: string,
  setStatusMessage: (s: string | null) => void,
  setClipboardFailed: (b: boolean) => void
): void {
  if (!prompt.trim()) return;
  setStatusMessage(null);
  setClipboardFailed(false);
  const { wasShortened } = openGeminiNewChatWindow(prompt);
  try {
    navigator.clipboard.writeText(prompt).then(
      () => {
        setClipboardFailed(false);
        setStatusMessage(geminiOpenStatusMessage(wasShortened, false));
      },
      () => {
        setClipboardFailed(true);
        setStatusMessage(geminiOpenStatusMessage(wasShortened, true));
      }
    );
  } catch {
    setClipboardFailed(true);
    setStatusMessage(geminiOpenStatusMessage(wasShortened, true));
  }
}
