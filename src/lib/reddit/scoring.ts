import type { RedditConfidence, RedditSearchProfile } from "./types";
import { subredditRelevanceBoost } from "./subredditConfig";

const FINANCE = /(debt|bond|bankrupt|chapter\s*11|restruct|distress|covenant|default|maturity|refinanc|credit|high\s*yield|leveraged|short\s+thesis|long\s+thesis|earnings|equity)/i;

function blob(title: string, selftext: string): string {
  return `${title}\n${selftext}`.toLowerCase();
}

export function scoreRedditPost(params: {
  profile: RedditSearchProfile;
  title: string;
  selftext: string;
  subreddit: string;
  score: number | null;
  numComments: number | null;
  matchedQueries: string[];
  queryCount: number;
}): { matchScore: number; confidence: RedditConfidence; reasons: string[] } {
  const { profile } = params;
  const tk = profile.ticker.trim().toUpperCase();
  const name = profile.companyName.trim();
  const aliases = profile.aliases;
  const tLower = params.title.toLowerCase();
  const b = blob(params.title, params.selftext);

  let s = 0;
  const reasons: string[] = [];

  if (tk && tLower.includes(tk.toLowerCase())) {
    s += 38;
    reasons.push("ticker_in_title");
  } else if (tk && b.includes(tk.toLowerCase())) {
    s += 16;
    reasons.push("ticker_in_body");
  }

  if (name && name.length >= 3 && tLower.includes(name.toLowerCase())) {
    s += 34;
    reasons.push("company_in_title");
  } else if (name && name.length >= 3 && b.includes(name.toLowerCase())) {
    s += 20;
    reasons.push("company_in_body");
  }

  for (const a of aliases) {
    if (a.length < 3) continue;
    if (tLower.includes(a.toLowerCase())) {
      s += 14;
      reasons.push(`alias_in_title:${a}`);
      break;
    }
  }

  if (FINANCE.test(b)) {
    s += 12;
    reasons.push("finance_keywords");
  }

  s += subredditRelevanceBoost(params.subreddit);
  if (subredditRelevanceBoost(params.subreddit) > 0) reasons.push("high_signal_subreddit");

  const sc = params.score ?? 0;
  const nc = params.numComments ?? 0;
  s += Math.min(22, Math.log1p(Math.max(0, sc)) * 4);
  s += Math.min(18, Math.log1p(Math.max(0, nc)) * 3);
  if (sc > 50 || nc > 30) reasons.push("strong_engagement");

  if (params.queryCount >= 2) {
    s += 10;
    reasons.push("multiple_queries_matched");
  }

  if (profile.ambiguousTicker && !reasons.includes("company_in_title") && !reasons.includes("company_in_body")) {
    s -= 20;
    reasons.push("ambiguous_ticker_penalty");
  }

  if (/(\bmeme\b|🚀|to the moon|diamond hands)/i.test(params.title)) {
    s -= 8;
    reasons.push("meme_penalty");
  }

  const ageDays = 0; // could use created_utc - skip for simplicity in bucket

  let confidence: RedditConfidence = "low";
  if (s >= 72) confidence = "high";
  else if (s >= 48) confidence = "medium";

  return { matchScore: Math.round(s * 10) / 10, confidence, reasons };
}
