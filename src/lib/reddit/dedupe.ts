import type { RedditPostProvenance, RedditPostResult } from "./types";

export type RawMerged = {
  base: Omit<
    RedditPostResult,
    "id" | "search_id" | "matched_queries_json" | "match_reasons_json" | "provenance_json" | "match_score" | "confidence_bucket" | "created_at" | "updated_at"
  >;
  matchedQueries: Set<string>;
  matchReasons: Set<string>;
  provenance: RedditPostProvenance[];
  matchScore: number;
  confidence: RedditPostResult["confidence_bucket"];
};

export function createRawMap(): Map<string, RawMerged> {
  return new Map();
}

export function mergeRedditHit(
  map: Map<string, RawMerged>,
  redditId: string,
  base: RawMerged["base"],
  query: string,
  prov: RedditPostProvenance,
  score: number,
  confidence: RedditPostResult["confidence_bucket"],
  reasons: string[]
): void {
  const cur = map.get(redditId);
  if (!cur) {
    map.set(redditId, {
      base,
      matchedQueries: new Set([query]),
      matchReasons: new Set(reasons),
      provenance: [prov],
      matchScore: score,
      confidence,
    });
    return;
  }

  cur.matchedQueries.add(query);
  for (const r of reasons) cur.matchReasons.add(r);
  cur.provenance.push(prov);

  if (score > cur.matchScore) {
    cur.matchScore = score;
    cur.confidence = confidence;
    cur.base = { ...cur.base, ...base };
  }
}

export function rawMapToResults(
  map: Map<string, RawMerged>,
  searchId: string,
  idFn: (parts: string[]) => string,
  now: string
): RedditPostResult[] {
  const out: RedditPostResult[] = [];
  for (const [rid, m] of Array.from(map.entries())) {
    out.push({
      ...m.base,
      id: idFn(["reddit_res", searchId, rid]),
      search_id: searchId,
      reddit_post_id: rid,
      match_score: m.matchScore,
      confidence_bucket: m.confidence,
      matched_queries_json: Array.from(m.matchedQueries),
      match_reasons_json: Array.from(m.matchReasons),
      provenance_json: m.provenance,
      created_at: now,
      updated_at: now,
    });
  }
  return out;
}
