import type { DailyNewsSourceType } from "./types";

/** Classify outlet from article URL / RSS source field. */
export function classifyOutletFromUrl(url: string): { source: string; sourceType: DailyNewsSourceType } {
  const u = url.toLowerCase();
  if (u.includes("sec.gov") || u.includes("edgar")) return { source: "SEC", sourceType: "SEC" };
  if (u.includes("wsj.com") || u.includes("wsj.")) return { source: "Wall Street Journal", sourceType: "WSJ" };
  if (u.includes("bloomberg.com")) return { source: "Bloomberg", sourceType: "Bloomberg" };
  if (u.includes("ft.com") || u.includes("financialtimes")) return { source: "Financial Times", sourceType: "FT" };
  if (u.includes("businesswire.com")) return { source: "Business Wire", sourceType: "press" };
  if (u.includes("prnewswire.com")) return { source: "PR Newswire", sourceType: "press" };
  if (u.includes("globenewswire.com")) return { source: "GlobeNewswire", sourceType: "press" };
  if (u.includes("accesswire.com")) return { source: "ACCESSWIRE", sourceType: "press" };
  if (u.includes("newsfilecorp.com")) return { source: "Newsfile", sourceType: "press" };
  if (u.includes("news.google.com")) return { source: "Google News", sourceType: "other" };
  return { source: "Web", sourceType: "trade" };
}
