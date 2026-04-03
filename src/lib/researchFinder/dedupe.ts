import type { ResearchResult } from "./types";
import { normalizeUrlForMatch } from "./utils";

export function dedupeResults(results: ResearchResult[]): ResearchResult[] {
  const seen = new Set<string>();
  const out: ResearchResult[] = [];
  for (const r of results) {
    const k =
      (r.canonical_url && normalizeUrlForMatch(r.canonical_url)) ||
      normalizeUrlForMatch(r.normalized_url) ||
      r.normalized_url;
    const key = (k ?? "").toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

