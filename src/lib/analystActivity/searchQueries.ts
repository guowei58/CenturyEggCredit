export function buildAnalystActivityQueries(ticker: string, companyName?: string): string[] {
  const t = ticker.toUpperCase();
  const name = companyName?.trim();
  const entity = name ? `"${t}" "${name}"` : `"${t}"`;

  return [
    `${entity} "initiated coverage" "price target"`,
    `${entity} "downgraded" "price target"`,
    `${entity} "upgraded" "price target"`,
    `${entity} "maintains" "price target"`,
    `${entity} "reiterates" "price target"`,
    `${entity} "analyst" "raises price target"`,
    `${entity} "analyst" "cuts price target"`,
    `${entity} "resumes coverage"`,
    `${entity} "coverage dropped"`,
    ...(name
      ? [
          `"${name}" "analyst coverage" "investor relations"`,
          `"${name}" "research coverage" "investor relations"`,
        ]
      : []),
    `site:marketbeat.com ${t} analyst rating`,
    `site:marketwatch.com ${entity} upgraded OR downgraded`,
    `site:finance.yahoo.com ${t} analyst`,
    `site:investing.com ${t} analyst ratings`,
  ];
}

export const ANALYST_ACTION_DOMAINS: Record<string, { sourceName: string; sourceType: import("./types").SourceType }> = {
  "marketbeat.com": { sourceName: "MarketBeat", sourceType: "marketbeat" },
  "marketwatch.com": { sourceName: "MarketWatch", sourceType: "marketwatch" },
  "finance.yahoo.com": { sourceName: "Yahoo Finance", sourceType: "yahoo_public" },
  "investing.com": { sourceName: "Investing.com", sourceType: "investing" },
  "briefing.com": { sourceName: "Briefing.com", sourceType: "briefing" },
  "thefly.com": { sourceName: "The Fly", sourceType: "search_discovery" },
  "streetinsider.com": { sourceName: "StreetInsider", sourceType: "search_discovery" },
  "benzinga.com": { sourceName: "Benzinga", sourceType: "search_discovery" },
  "seekingalpha.com": { sourceName: "Seeking Alpha", sourceType: "search_discovery" },
  "reuters.com": { sourceName: "Reuters", sourceType: "search_discovery" },
  "cnbc.com": { sourceName: "CNBC", sourceType: "search_discovery" },
  "bloomberg.com": { sourceName: "Bloomberg", sourceType: "search_discovery" },
};

export function resolveSourceFromUrl(url: string): { sourceName: string; sourceType: import("./types").SourceType } {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const [domain, meta] of Object.entries(ANALYST_ACTION_DOMAINS)) {
      if (host === domain || host.endsWith(`.${domain}`)) return meta;
    }
  } catch {
    /* invalid url */
  }
  return { sourceName: "Web", sourceType: "search_discovery" };
}
