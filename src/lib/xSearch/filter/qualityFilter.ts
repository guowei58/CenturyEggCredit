import type { NormalizedXPost } from "../types";
import { engagementScore } from "../ranking/rank";

const SPAM_PATTERNS: RegExp[] = [
  /\b(dm\s+me|message\s+me|inbox\s+me)\b/i,
  /\b(telegram|whatsapp|signal\s+group|discord\.gg)\b/i,
  /\b(100x|1000x|guaranteed\s+(returns?|profit)|get\s+rich\s+quick)\b/i,
  /\b(pump\s+and\s+dump|penny\s+stock\s+alert|stock\s+signals?)\b/i,
  /\b(free\s+(stock\s+)?tips?|buy\s+now\s+before|don't\s+miss\s+out)\b/i,
  /\b(crypto\s+airdrop|nft\s+drop|link\s+in\s+bio)\b/i,
  /\b(follow\s+for\s+(more|signals?|alerts?))\b/i,
];

function countCashtags(text: string): number {
  return (text.match(/\$[A-Za-z]{1,5}\b/g) ?? []).length;
}

function isCashtagShill(text: string): boolean {
  const t = text.trim();
  if (t.length > 48) return false;
  const withoutTags = t.replace(/\$[A-Za-z]{1,5}\b/g, "").trim();
  if (withoutTags.length > 12) return false;
  return /\$[A-Za-z]{1,5}\b/.test(t) && /[\u{1F300}-\u{1FAFF}🚀📈💰🔥]/u.test(t);
}

export function isSpamOrLowQualityPost(post: NormalizedXPost, minEngagement: number): boolean {
  const text = post.text.trim();
  if (!text) return true;

  if (SPAM_PATTERNS.some((re) => re.test(text))) return true;
  if (countCashtags(text) >= 3) return true;
  if (isCashtagShill(text)) return true;

  const eng = engagementScore(post);
  if (eng < minEngagement) return true;

  if (post.isReply && eng < Math.max(minEngagement, 2)) return true;

  return false;
}

export function filterLowQualityPosts(
  posts: NormalizedXPost[],
  opts?: { minEngagement?: number }
): { kept: NormalizedXPost[]; filteredCount: number } {
  const minEngagement = Math.max(0, opts?.minEngagement ?? 1);
  const kept = posts.filter((p) => !isSpamOrLowQualityPost(p, minEngagement));
  return { kept, filteredCount: posts.length - kept.length };
}
