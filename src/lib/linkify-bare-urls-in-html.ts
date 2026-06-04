/**
 * Turn plain-text http(s) URLs inside sanitized HTML into <a> elements so SavedRichText
 * can attach Save / Analyze controls (Claude often copies styled HTML without anchor tags).
 */

import { normalizeHttpUrl } from "@/lib/extract-links-from-saved-content";

const BARE_URL_RE = /https?:\/\/[^\s\]<>"'`)}\]]+/gi;

const SKIP_ANCESTOR = "a, script, style, pre, code, textarea";

function splitTextWithUrls(text: string): Array<{ kind: "text" | "url"; value: string }> {
  const parts: Array<{ kind: "text" | "url"; value: string }> = [];
  let last = 0;
  BARE_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_URL_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: "text", value: text.slice(last, m.index) });
    parts.push({ kind: "url", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

/** Walk text nodes under `root` and wrap bare URLs that are not already inside links. */
export function linkifyBareUrlsInElement(root: HTMLElement): void {
  if (typeof document === "undefined") return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    const parent = t.parentElement;
    if (!parent?.closest(SKIP_ANCESTOR)) {
      if (BARE_URL_RE.test(t.nodeValue ?? "")) textNodes.push(t);
    }
    BARE_URL_RE.lastIndex = 0;
  }

  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest(SKIP_ANCESTOR)) continue;

    const parts = splitTextWithUrls(textNode.nodeValue ?? "");
    if (!parts.some((p) => p.kind === "url")) continue;

    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (p.kind === "text") {
        frag.appendChild(document.createTextNode(p.value));
        continue;
      }
      const href = normalizeHttpUrl(p.value);
      if (!href) {
        frag.appendChild(document.createTextNode(p.value));
        continue;
      }
      const a = document.createElement("a");
      a.href = href;
      a.textContent = p.value;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "break-all";
      frag.appendChild(a);
    }
    parent.replaceChild(frag, textNode);
  }
}
