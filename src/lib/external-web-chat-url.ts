/**
 * Web UIs (ChatGPT, Gemini, DeepSeek) prefill via ?q= in the URL. Browsers and hosts cap URL length,
 * so long prompts cannot be embedded losslessly. Full text must live on the clipboard.
 * When shortened, we put a paste-first banner + complete list of markdown headings (and key list lines)
 * so the composer is not filled with misleading half-prompts.
 */

/** Conservative cap for the full href (encoded query expands; hosts may truncate). */
export const WEB_CHAT_MAX_HREF_LENGTH = 12_000;

export function hrefLengthForEncodedQuery(urlPrefix: string, query: string): number {
  return urlPrefix.length + encodeURIComponent(query).length;
}

/**
 * Every markdown heading line, plus lines that look like checklist / enumerated requirements.
 * Does not drop wording from the source — only selects lines; full prompt must still be pasted for prose.
 */
export function buildOutlineDigestForWebChat(fullPrompt: string, maxChars: number): string {
  const lines = fullPrompt.split(/\r?\n/);
  const picked: string[] = [];
  for (const line of lines) {
    const t = line.trimEnd();
    if (!t) continue;
    if (/^#{1,6}\s+\S/.test(t)) {
      picked.push(t);
      continue;
    }
    if (/^\s*[-*+]\s+\S/.test(line) || /^\s*\d+[.)]\s+\S/.test(line)) {
      picked.push(t.length > 220 ? `${t.slice(0, 217)}…` : t);
    }
  }
  let digest = picked.join("\n");
  if (digest.length === 0) {
    digest = lines
      .slice(0, 80)
      .map((l) => l.trimEnd())
      .filter(Boolean)
      .join("\n");
  }
  if (digest.length > maxChars) {
    digest = `${digest.slice(0, Math.max(0, maxChars - 40)).trimEnd()}\n\n[…digest truncated — full prompt is on your clipboard]`;
  }
  return digest;
}

export function buildPasteFirstUrlBody(fullPrompt: string, maxContentChars: number): string {
  const n = fullPrompt.length;
  const banner = `OREO — The COMPLETE prompt (${n.toLocaleString()} characters) is on your clipboard. Paste it here first (Ctrl+V / Cmd+V). The text below is NOT the full instructions—only a structured outline so nothing is “missing” from your checklist once you paste.\n\n---\nOutline (headings & bullets copied from the full prompt):\n`;
  const room = Math.max(400, maxContentChars - banner.length);
  const digest = buildOutlineDigestForWebChat(fullPrompt, room);
  return `${banner}${digest}`;
}

export type WebChatUrlBuildResult = { href: string; wasShortened: boolean };

/**
 * @param urlPrefix e.g. https://chat.openai.com/?q=
 */
export function buildWebChatUrlWithQueryBudget(
  fullPrompt: string,
  urlPrefix: string,
  maxHrefLength: number = WEB_CHAT_MAX_HREF_LENGTH
): WebChatUrlBuildResult {
  const full = fullPrompt;
  if (hrefLengthForEncodedQuery(urlPrefix, full) <= maxHrefLength) {
    return { href: urlPrefix + encodeURIComponent(full), wasShortened: false };
  }

  let contentMax = Math.min(8000, maxHrefLength - urlPrefix.length - 400);
  let body = buildPasteFirstUrlBody(full, contentMax);
  for (let i = 0; i < 24; i++) {
    if (hrefLengthForEncodedQuery(urlPrefix, body) <= maxHrefLength) break;
    contentMax = Math.max(400, Math.floor(contentMax * 0.82));
    body = buildPasteFirstUrlBody(full, contentMax);
  }

  if (hrefLengthForEncodedQuery(urlPrefix, body) <= maxHrefLength) {
    return { href: urlPrefix + encodeURIComponent(body), wasShortened: true };
  }

  const tiny = buildPasteFirstUrlBody(full, 400);
  return { href: urlPrefix + encodeURIComponent(tiny), wasShortened: true };
}
