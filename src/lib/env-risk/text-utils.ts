import { createHash } from "crypto";

export function stripHtmlToPlainText(html: string): string {
  const noScripts = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ");
  const noStyle = noScripts.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
  const blockEnds = noStyle.replace(/<\/(p|div|tr|br|li|h\d)\b[^>]*>/gi, "\n");
  const stripped = blockEnds.replace(/<[^>]+>/g, " ");
  return stripped
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

export function hashText(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sørensen–Dice coefficient on bigrams, 0–1 */
export function diceCoefficient(a: string, b: string): number {
  const x = normalizeForMatch(a);
  const y = normalizeForMatch(b);
  if (x.length < 2 || y.length < 2) {
    if (x === y) return 1;
    return x.includes(y) || y.includes(x) ? 0.35 : 0;
  }
  const bigrams = (t: string) => {
    const g: string[] = [];
    for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2));
    return g;
  };
  const bgx = bigrams(x);
  const bgy = bigrams(y);
  const map = new Map<string, number>();
  for (const g of bgx) map.set(g, (map.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of bgy) {
    const c = map.get(g);
    if (c && c > 0) {
      inter++;
      map.set(g, c - 1);
    }
  }
  return (2 * inter) / (bgx.length + bgy.length);
}

export function tokenOverlapScore(a: string, b: string): number {
  const ta = new Set(normalizeForMatch(a).split(" ").filter((t) => t.length > 2));
  const tb = new Set(normalizeForMatch(b).split(" ").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of Array.from(ta)) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}
