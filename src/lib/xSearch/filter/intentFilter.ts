import type { NormalizedXPost } from "../types";
import { isCashtagNoisyTicker } from "../utils";

/** Bare homonym in text without cashtag (e.g. crypto "sats" for ticker SATS). */
export function isCashtagHomonymFalsePositive(text: string, ticker: string): boolean {
  const tk = ticker.trim().toUpperCase();
  if (!isCashtagNoisyTicker(tk)) return false;
  if (new RegExp(`\\$${tk}\\b`, "i").test(text)) return false;
  const homonym = tk.toLowerCase();
  return new RegExp(`\\b${homonym}\\b`, "i").test(text);
}

export function postMatchesSearchIntent(
  post: NormalizedXPost,
  ctx: { ticker: string; companyName?: string; aliases?: string[] }
): boolean {
  const tk = ctx.ticker.trim().toUpperCase();
  if (!tk) return false;

  if (isCashtagHomonymFalsePositive(post.text, tk)) return false;

  if (post.cashtags.some((c) => c.toUpperCase() === tk)) return true;

  const cashtagRe = new RegExp(`\\$${tk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (cashtagRe.test(post.text)) return true;

  const blob = post.text.toLowerCase();
  const name = ctx.companyName?.trim();
  if (name && name.length >= 3 && blob.includes(name.toLowerCase())) return true;

  for (const alias of ctx.aliases ?? []) {
    const a = alias.trim();
    if (a.length >= 3 && blob.includes(a.toLowerCase())) return true;
  }

  return false;
}

export function filterBySearchIntent(
  posts: NormalizedXPost[],
  ctx: { ticker: string; companyName?: string; aliases?: string[] }
): { kept: NormalizedXPost[]; filteredCount: number } {
  const kept = posts.filter((p) => postMatchesSearchIntent(p, ctx));
  return { kept, filteredCount: posts.length - kept.length };
}
