/** Append a source URL when SEC text could not be inlined (fallback for browsing models). */
export function buildDistressedPromptForUrl(basePrompt: string, url: string): string {
  const u = url.trim();
  const b = basePrompt.trim();
  if (!u) return b;
  return `${b}\n\n---\nSOURCE DOCUMENT LINK (open this URL and read the full credit agreement / indenture / amendment before answering — do not rely on summaries):\n${u}\n`;
}
