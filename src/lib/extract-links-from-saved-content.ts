/**
 * Collect http(s) URLs from saved-response markdown/HTML/plain text and from rendered anchor elements.
 */

function normalizeHttpUrl(raw: string): string | null {
  let u = raw.trim().replace(/^<+|>+$/g, "").replace(/[),.;]+$/g, "");
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return u;
  }
}

/** Extract unique normalized http(s) URLs from raw saved content (markdown, HTML snippets, or plain text). */
export function extractHttpUrlsFromSavedContent(text: string): string[] {
  if (!text?.trim()) return [];
  const found = new Set<string>();
  const add = (raw: string) => {
    const n = normalizeHttpUrl(raw);
    if (n) found.add(n);
  };

  const mdLink = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = mdLink.exec(text)) !== null) add(m[2]);

  const angle = /<(https?:\/\/[^>\s]+)>/gi;
  while ((m = angle.exec(text)) !== null) add(m[1]);

  const htmlHref = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  while ((m = htmlHref.exec(text)) !== null) add(m[1]);

  const bare = /https?:\/\/[^\s\]<>"'`)}\]]+/gi;
  while ((m = bare.exec(text)) !== null) add(m[0]);

  return Array.from(found);
}

/** Merge URLs from source text and from any `<a href>` inside `root` (e.g. SavedRichText output). */
export function collectHttpUrlsForSavedResponse(
  root: HTMLElement | null,
  linkSourceText: string | null | undefined
): string[] {
  const found = new Set<string>(extractHttpUrlsFromSavedContent(linkSourceText ?? ""));
  if (root) {
    root.querySelectorAll("a[href]").forEach((el) => {
      const resolved = (el as HTMLAnchorElement).href;
      const n = normalizeHttpUrl(resolved);
      if (n) found.add(n);
    });
  }
  return Array.from(found);
}
