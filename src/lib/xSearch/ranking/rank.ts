import type { NormalizedXPost } from "../types";
import { isAmbiguousTicker } from "../utils";

export type XSortMode = "relevance" | "recent" | "engagement";

function engagementScore(p: NormalizedXPost): number {
  const m = p.metrics;
  if (!m) return 0;
  return (
    (m.likeCount ?? 0) * 1 +
    (m.repostCount ?? 0) * 2 +
    (m.replyCount ?? 0) * 1.5 +
    (m.quoteCount ?? 0) * 2.5 +
    (m.impressionCount ?? 0) * 0.0005
  );
}

export function scorePost(p: NormalizedXPost, ctx: { ticker: string; companyName?: string }): number {
  let s = 0;
  const tk = ctx.ticker.trim().toUpperCase();
  const blob = p.text.toLowerCase();

  if (p.cashtags.map((c) => c.toUpperCase()).includes(tk)) s += 55;
  if (blob.includes(`$${tk}`.toLowerCase())) s += 35;
  if (blob.includes(tk.toLowerCase())) s += 10;

  const name = ctx.companyName?.trim();
  if (name && name.length >= 3 && blob.includes(name.toLowerCase())) s += 22;

  // Finance context boost.
  if (/(earnings|guidance|debt|bond|credit|downgrade|upgrade|refinanc|maturity|default|bankrupt|ebitda)/i.test(p.text)) {
    s += 10;
  }

  // Recency
  if (p.createdAt) {
    const ageHours = (Date.now() - Date.parse(p.createdAt)) / (3600 * 1000);
    if (ageHours < 6) s += 14;
    else if (ageHours < 24) s += 10;
    else if (ageHours < 72) s += 6;
  }

  // Demotions
  if (p.isReply) s -= 6;
  if (p.isRetweet) s -= 12;

  if (isAmbiguousTicker(tk) && !blob.includes(`$${tk}`.toLowerCase()) && !(name && blob.includes(name.toLowerCase()))) {
    s -= 18;
  }

  s += Math.min(18, engagementScore(p) * 0.15);
  return s;
}

export function rankPosts(
  posts: NormalizedXPost[],
  ctx: { ticker: string; companyName?: string },
  mode: XSortMode
): NormalizedXPost[] {
  const scored = posts.map((p) => ({
    p,
    s: mode === "relevance" ? scorePost(p, ctx) : 0,
    e: engagementScore(p),
    t: p.createdAt ? Date.parse(p.createdAt) : 0,
  }));

  return scored
    .sort((a, b) => {
      if (mode === "recent") {
        if (a.t !== b.t) return b.t - a.t;
      } else if (mode === "engagement") {
        if (a.e !== b.e) return b.e - a.e;
      } else {
        if (a.s !== b.s) return b.s - a.s;
      }
      return b.t - a.t;
    })
    .map((x) => x.p);
}

