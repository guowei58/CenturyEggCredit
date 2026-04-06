/**
 * Meta AI (meta.ai) new-chat prefill via `?q=` — same URL-length constraints as ChatGPT.
 * Undocumented; if prefill fails, the full prompt is still copied to the clipboard.
 */

import { CHATGPT_LONG_URL_NOTICE } from "@/lib/chatgpt-open-url";
import {
  META_AND_OLLAMA_UI_PLACEHOLDER_ACTIVE,
  showMetaOllamaPlaceholder,
} from "@/lib/meta-ollama-ui-placeholder";

export const META_AI_NEW_CHAT_ORIGIN = "https://www.meta.ai/";

const META_AI_Q_PREFIX = `${META_AI_NEW_CHAT_ORIGIN}?q=`;

const MAX_HREF_LENGTH = 5600;

function hrefLengthForQuery(query: string): number {
  return META_AI_Q_PREFIX.length + encodeURIComponent(query).length;
}

export const META_AI_LONG_URL_NOTICE = CHATGPT_LONG_URL_NOTICE;

export const CHATGPT_AND_META_LONG_URL_NOTICES = CHATGPT_LONG_URL_NOTICE;

export function metaAiOpenStatusMessage(wasShortened: boolean, copyFailed: boolean): string {
  if (copyFailed) {
    return wasShortened
      ? "Meta AI opened. Copy failed — select the prompt in OREO and paste; the tab may only show a shortened version."
      : "Meta AI opened in a new tab. Prompt could not be copied — use the prompt below and paste.";
  }
  if (wasShortened) {
    return "Meta AI opened. The link used a shortened prompt so it fits; the FULL prompt was copied — paste into Meta AI for complete instructions.";
  }
  return "Meta AI opened in a new tab. Prompt copied to clipboard — paste if it didn't prefill.";
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
  return block || "(See full prompt in OREO — Copy prompt.)";
}

function buildShortenedTail(outline: string): string {
  return `\n\n---\nOREO — Meta AI URL length limit: text above is abbreviated. The FULL prompt was copied to your clipboard when you clicked Open — paste it into the same chat. Deliver the same work: follow every section below with full depth.\n\nOutline / section headers from the full prompt:\n${outline}`;
}

export function buildMetaAiNewChatUrl(fullPrompt: string): { href: string; wasShortened: boolean } {
  if (hrefLengthForQuery(fullPrompt) <= MAX_HREF_LENGTH) {
    return { href: META_AI_Q_PREFIX + encodeURIComponent(fullPrompt), wasShortened: false };
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
      return { href: META_AI_Q_PREFIX + encodeURIComponent(query), wasShortened: true };
    }
    headLen = Math.floor(headLen * 0.88);
  }

  const minimal =
    fullPrompt.slice(0, 240).trimEnd() +
    "\n\n---\nOREO: Prompt too long for Meta AI URL. Use Copy prompt in OREO and paste the full text.\n" +
    extractOutlineBlock(fullPrompt, 800);
  return { href: META_AI_Q_PREFIX + encodeURIComponent(minimal), wasShortened: true };
}

export function openMetaAiNewChatWindow(fullPrompt: string): { wasShortened: boolean } {
  if (META_AND_OLLAMA_UI_PLACEHOLDER_ACTIVE) {
    showMetaOllamaPlaceholder();
    return { wasShortened: false };
  }
  const { href, wasShortened } = buildMetaAiNewChatUrl(fullPrompt);
  window.open(href, "_blank", "noopener,noreferrer");
  return { wasShortened };
}

/** Same pattern as Open in ChatGPT: open tab + copy full prompt; updates status / clipboard-failed flags. */
export function openMetaAiWithClipboard(
  prompt: string,
  setStatusMessage: (s: string | null) => void,
  setClipboardFailed: (b: boolean) => void
): void {
  if (!prompt.trim()) return;
  if (META_AND_OLLAMA_UI_PLACEHOLDER_ACTIVE) {
    showMetaOllamaPlaceholder();
    return;
  }
  setStatusMessage(null);
  setClipboardFailed(false);
  const { wasShortened } = openMetaAiNewChatWindow(prompt);
  try {
    navigator.clipboard.writeText(prompt).then(
      () => {
        setClipboardFailed(false);
        setStatusMessage(metaAiOpenStatusMessage(wasShortened, false));
      },
      () => {
        setClipboardFailed(true);
        setStatusMessage(metaAiOpenStatusMessage(wasShortened, true));
      }
    );
  } catch {
    setClipboardFailed(true);
    setStatusMessage(metaAiOpenStatusMessage(wasShortened, true));
  }
}
