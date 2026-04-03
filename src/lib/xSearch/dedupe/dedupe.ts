import type { NormalizedXPost } from "../types";
import { normalizeUrlForMatch } from "../utils";

export function dedupePosts(posts: NormalizedXPost[]): NormalizedXPost[] {
  const seen = new Set<string>();
  const out: NormalizedXPost[] = [];
  for (const p of posts) {
    const key = p.id || normalizeUrlForMatch(p.url) || p.url;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

