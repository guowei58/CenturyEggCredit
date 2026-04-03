import type { SubstackSearchResult } from "../types";

export function dedupeResults(results: SubstackSearchResult[]): SubstackSearchResult[] {
  const seen = new Set<string>();
  const out: SubstackSearchResult[] = [];
  for (const r of results) {
    const k = r.post.normalizedUrl.toLowerCase();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

