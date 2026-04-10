/**
 * ChatGPT "new chat" prefill uses a URL query param; long prompts exceed practical limits
 * and the chat box stays empty. We only shorten when the encoded URL would be too long.
 */

export const CHATGPT_NEW_CHAT_ORIGIN = "https://chat.openai.com/";

const CHATGPT_Q_PREFIX = `${CHATGPT_NEW_CHAT_ORIGIN}?q=`;

/** Conservative cap for the full href (encoded query expands; ChatGPT/browser may truncate). */
const MAX_HREF_LENGTH = 5600;

function hrefLengthForQuery(query: string): number {
  return CHATGPT_Q_PREFIX.length + encodeURIComponent(query).length;
}

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
      ? "ChatGPT opened. Copy failed — select the prompt in OREO and paste; the tab may only show a shortened version."
      : "ChatGPT opened in a new tab. Prompt could not be copied — use the prompt below and paste.";
  }
  if (wasShortened) {
    return "ChatGPT opened. The link used a shortened prompt so it fits; the FULL prompt was copied — paste into ChatGPT for complete instructions.";
  }
  return "ChatGPT opened in a new tab. Prompt copied to clipboard — paste if it didn't prefill.";
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
  return `\n\n---\nOREO — ChatGPT URL length limit: text above is abbreviated. The FULL prompt was copied to your clipboard when you clicked Open — paste it into the same chat. Deliver the same work: follow every section below with full depth.\n\nOutline / section headers from the full prompt:\n${outline}`;
}

export function buildChatGptNewChatUrl(fullPrompt: string): { href: string; wasShortened: boolean } {
  if (hrefLengthForQuery(fullPrompt) <= MAX_HREF_LENGTH) {
    return { href: CHATGPT_Q_PREFIX + encodeURIComponent(fullPrompt), wasShortened: false };
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
      return { href: CHATGPT_Q_PREFIX + encodeURIComponent(query), wasShortened: true };
    }
    headLen = Math.floor(headLen * 0.88);
  }

  const minimal =
    fullPrompt.slice(0, 240).trimEnd() +
    "\n\n---\nOREO: Prompt too long for ChatGPT URL. Use Copy prompt in OREO and paste the full text.\n" +
    extractOutlineBlock(fullPrompt, 800);
  return { href: CHATGPT_Q_PREFIX + encodeURIComponent(minimal), wasShortened: true };
}

export function openChatGptNewChatWindow(fullPrompt: string): { wasShortened: boolean } {
  const { href, wasShortened } = buildChatGptNewChatUrl(fullPrompt);
  window.open(href, "_blank", "noopener,noreferrer");
  return { wasShortened };
}
