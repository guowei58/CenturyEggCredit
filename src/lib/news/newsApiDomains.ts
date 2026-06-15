/**
 * Allowed major business/financial news publisher domains.
 * Used by major-outlet RSS (Google News site: search) and NewsAPI when enabled.
 */
export const NEWSAPI_ALLOWED_DOMAINS = [
  "wsj.com",
  "bloomberg.com",
  "reuters.com",
  "fortune.com",
  "nytimes.com",
  "economist.com",
  "apnews.com",
  "ft.com",
  "cnbc.com",
  "finance.yahoo.com",
  "marketwatch.com",
  "barrons.com",
] as const;

/** Extra hosts accepted for RSS items (e.g. generic Yahoo News paths). */
export const MAJOR_OUTLET_RSS_EXTRA_DOMAINS = ["yahoo.com"] as const;

export type NewsApiAllowedDomain = (typeof NEWSAPI_ALLOWED_DOMAINS)[number];

const ALLOWED_SET = new Set<string>([
  ...NEWSAPI_ALLOWED_DOMAINS.map((d) => d.toLowerCase()),
  ...MAJOR_OUTLET_RSS_EXTRA_DOMAINS.map((d) => d.toLowerCase()),
]);

/** Google News RSS `site:` group for all allowed publishers. */
export function buildGoogleNewsSiteGroup(): string {
  return buildGoogleNewsSiteGroupForDomains(NEWSAPI_ALLOWED_DOMAINS);
}

/** Google News RSS `site:` group for a subset (used to run parallel queries). */
export function buildGoogleNewsSiteGroupForDomains(domains: readonly string[]): string {
  const clauses = domains.map((d) => `site:${d}`);
  return `(${clauses.join(" OR ")})`;
}

/** Batched outlet groups — Google RSS returns at most ~100 items per query. */
export const GOOGLE_NEWS_SITE_BATCHES: readonly (readonly NewsApiAllowedDomain[])[] = [
  ["wsj.com", "ft.com", "bloomberg.com", "reuters.com", "apnews.com", "cnbc.com"],
  ["nytimes.com", "economist.com", "fortune.com", "barrons.com", "marketwatch.com", "finance.yahoo.com"],
];

/** Strip leading `www.` for comparison. */
export function hostnameMatchesNewsApiAllowlist(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^www\./, "");
  if (ALLOWED_SET.has(h)) return true;
  for (const d of Array.from(ALLOWED_SET)) {
    if (h === d || h.endsWith(`.${d}`)) return true;
  }
  return false;
}

export function outletLabelFromHost(host: string): string {
  const h = host.toLowerCase();
  if (h.includes("wsj.")) return "WSJ";
  if (h.includes("ft.com")) return "Financial Times";
  if (h.includes("bloomberg.")) return "Bloomberg";
  if (h.includes("finance.yahoo.") || (h.includes("yahoo.") && h.includes("finance"))) return "Yahoo Finance";
  if (h.includes("reuters.")) return "Reuters";
  if (h.includes("apnews.")) return "Associated Press";
  if (h.includes("nytimes.")) return "NYT";
  if (h.includes("economist.")) return "The Economist";
  if (h.includes("cnbc.")) return "CNBC";
  if (h.includes("marketwatch.")) return "MarketWatch";
  if (h.includes("barrons.")) return "Barron's";
  if (h.includes("fortune.")) return "Fortune";
  if (h.includes("yahoo.")) return "Yahoo";
  return host || "News";
}
