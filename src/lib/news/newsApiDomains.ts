/**
 * Domains passed to NewsAPI `everything` `domains=` (comma-separated).
 * Adjust this list to add or remove publishers; no code changes required elsewhere.
 */
export const NEWSAPI_ALLOWED_DOMAINS = [
  "wsj.com",
  "bloomberg.com",
  "reuters.com",
  "fortune.com",
  "nytimes.com",
  "apnews.com",
  "ft.com",
  "cnbc.com",
  "finance.yahoo.com",
  "marketwatch.com",
  "barrons.com",
] as const;

export type NewsApiAllowedDomain = (typeof NEWSAPI_ALLOWED_DOMAINS)[number];

const ALLOWED_SET = new Set<string>(NEWSAPI_ALLOWED_DOMAINS.map((d) => d.toLowerCase()));

/** Strip leading `www.` for comparison. */
export function hostnameMatchesNewsApiAllowlist(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^www\./, "");
  if (ALLOWED_SET.has(h)) return true;
  // Subdomains, e.g. www.reuters.com → reuters.com
  for (const d of Array.from(ALLOWED_SET)) {
    if (h === d || h.endsWith(`.${d}`)) return true;
  }
  return false;
}
