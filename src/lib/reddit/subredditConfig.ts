import { loadRedditConfigFromEnv } from "./config";

export function getDefaultSubredditList(): string[] {
  return [...loadRedditConfigFromEnv().defaultSubreddits];
}

const HIGH_SIGNAL = new Set(["securityanalysis", "valueinvesting", "investing", "stocks", "finance"]);

export function subredditRelevanceBoost(sub: string): number {
  return HIGH_SIGNAL.has(sub.toLowerCase()) ? 12 : 0;
}
