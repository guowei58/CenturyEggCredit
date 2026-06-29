import { fetchGoogleNewsRssSearch } from "@/lib/daily-news/rss";
import { resolveIndustryPublicationsForDigest } from "@/lib/daily-news/custom-publications";
import { getCompanyProfile } from "@/lib/sec-edgar";
import {
  calendarDateKeyFromTimestamp,
  isCalendarDateKeyInChangeLogPeriod,
  isPublishedAtInChangeLogPeriod,
  parseStrictTimestamp,
  toIsoDateKey,
  type ChangeLogPeriodBounds,
} from "./period";
import { fetchChangeLogSecFilings, type FetchChangeLogSecResult } from "./sec-filings";
import type { ChangeLogSourceCandidate } from "./types";
import { changeLogDedupeKey } from "./dedupe";
import { createHash } from "node:crypto";
import { loadChangeLogCompetitorTickers, type ChangeLogCompetitorRef } from "./competitors";

export { changeLogDedupeKey } from "./dedupe";

function hashFallback(title: string, date: string): string {
  return createHash("sha256").update(`${date}|${title}`).digest("hex").slice(0, 24);
}

function companySearchFragment(ticker: string, companyName: string): string {
  const tk = ticker.trim().toUpperCase();
  const cn = companyName.trim();
  if (cn && cn.toUpperCase() !== tk) return `"${cn.replace(/"/g, "")}" OR ${tk}`;
  return tk;
}

function googleNewsDateQuery(bounds: ChangeLogPeriodBounds): { after: string; before: string } {
  const after = toIsoDateKey(bounds.periodStart);
  const beforeEnd = new Date(bounds.periodEnd);
  beforeEnd.setDate(beforeEnd.getDate() + 1);
  return { after, before: toIsoDateKey(beforeEnd) };
}

function newsArticleToCandidate(
  article: {
    title: string;
    url: string;
    publishedAt: string | null;
    summary: string | null;
    sourceName: string;
  },
  sourceType: "news" | "industry",
  bounds: ChangeLogPeriodBounds,
  competitorTicker?: string
): ChangeLogSourceCandidate | null {
  const ts = parseStrictTimestamp(article.publishedAt);
  if (ts == null) return null;
  if (!isPublishedAtInChangeLogPeriod(article.publishedAt, bounds)) return null;

  const date = calendarDateKeyFromTimestamp(ts);
  return {
    dedupeKey: changeLogDedupeKey(article.url) || hashFallback(article.title, date),
    date,
    title: article.title,
    summary: article.summary,
    url: article.url,
    sourceName: article.sourceName,
    sourceType,
    publishedAtIso: new Date(ts).toISOString(),
    competitorTicker,
  };
}

function isCandidateWithinPeriod(c: ChangeLogSourceCandidate, bounds: ChangeLogPeriodBounds): boolean {
  if (c.sourceType === "sec") {
    return isCalendarDateKeyInChangeLogPeriod(c.date, bounds);
  }
  if (c.publishedAtIso) {
    return isPublishedAtInChangeLogPeriod(c.publishedAtIso, bounds);
  }
  return isCalendarDateKeyInChangeLogPeriod(c.date, bounds);
}

export type GatherChangeLogSourcesResult = {
  candidates: ChangeLogSourceCandidate[];
  companyName: string;
  fetchErrors: string[];
  sec: FetchChangeLogSecResult;
  competitors: {
    tickers: ChangeLogCompetitorRef[];
    candidateCount: number;
  };
};

async function gatherCompetitorSources(params: {
  competitors: ChangeLogCompetitorRef[];
  bounds: ChangeLogPeriodBounds;
  excludeDedupeKeys: Set<string>;
  push: (c: ChangeLogSourceCandidate | null) => void;
  fetchErrors: string[];
}): Promise<void> {
  const { after, before } = googleNewsDateQuery(params.bounds);

  for (const comp of params.competitors) {
    let compName = comp.ticker;
    try {
      const profile = await getCompanyProfile(comp.ticker);
      if (profile?.name) compName = profile.name;
    } catch {
      /* optional */
    }

    const sec = await fetchChangeLogSecFilings(comp.ticker, params.bounds, params.excludeDedupeKeys);
    if (sec.error) {
      params.fetchErrors.push(`SEC EDGAR (${comp.ticker}): ${sec.error}`);
    }
    for (const c of sec.candidates) {
      params.push({ ...c, competitorTicker: comp.ticker });
    }

    const corpQ = companySearchFragment(comp.ticker, compName);
    const googleQueries = [
      `${corpQ} after:${after} before:${before}`,
      `${corpQ} (earnings OR filing OR "credit agreement" OR acquisition) after:${after} before:${before}`,
    ];

    for (const q of googleQueries) {
      try {
        const arts = await fetchGoogleNewsRssSearch(q, 8, "", true);
        for (const a of arts) {
          params.push(
            newsArticleToCandidate(
              {
                title: a.title,
                url: a.link,
                publishedAt: a.pubDate,
                summary: a.description ?? null,
                sourceName: a.sourceName || "Google News",
              },
              "news",
              params.bounds,
              comp.ticker
            )
          );
        }
      } catch (e) {
        params.fetchErrors.push(
          `Google News (${comp.ticker}): ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }
}

export async function gatherChangeLogSources(params: {
  ticker: string;
  periodStart: Date;
  periodEnd: Date;
  excludeDedupeKeys: Set<string>;
  userId?: string;
}): Promise<GatherChangeLogSourcesResult> {
  const ticker = params.ticker.trim().toUpperCase();
  const bounds: ChangeLogPeriodBounds = {
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
  };
  const fetchErrors: string[] = [];
  const candidates: ChangeLogSourceCandidate[] = [];
  const seen = new Set<string>();

  const push = (c: ChangeLogSourceCandidate | null) => {
    if (!c) return;
    if (!isCandidateWithinPeriod(c, bounds)) return;
    if (params.excludeDedupeKeys.has(c.dedupeKey) || seen.has(c.dedupeKey)) return;
    seen.add(c.dedupeKey);
    candidates.push(c);
  };

  let companyName = ticker;
  let sic = "";
  let sicDescription = "";
  let formerNames: string[] = [];
  try {
    const profile = await getCompanyProfile(ticker);
    if (profile) {
      companyName = profile.name;
      sic = profile.sic;
      sicDescription = profile.sicDescription;
      formerNames = profile.formerNames;
    }
  } catch (e) {
    fetchErrors.push(e instanceof Error ? e.message : String(e));
  }

  const sec = await fetchChangeLogSecFilings(ticker, bounds, params.excludeDedupeKeys);
  if (sec.error) fetchErrors.push(`SEC EDGAR: ${sec.error}`);
  if (sec.companyName) companyName = sec.companyName;
  for (const c of sec.candidates) push(c);

  const { after, before } = googleNewsDateQuery(bounds);
  const corpQ = companySearchFragment(ticker, companyName);

  const googleQueries = [
    `${corpQ} after:${after} before:${before}`,
    `${corpQ} (earnings OR "earnings call" OR transcript) after:${after} before:${before}`,
    `${corpQ} (refinanc OR "credit agreement" OR "term loan" OR "debt offering") after:${after} before:${before}`,
  ];

  for (const q of googleQueries) {
    try {
      const arts = await fetchGoogleNewsRssSearch(q, 12, "", true);
      for (const a of arts) {
        push(
          newsArticleToCandidate(
            {
              title: a.title,
              url: a.link,
              publishedAt: a.pubDate,
              summary: a.description ?? null,
              sourceName: a.sourceName || "Google News",
            },
            "news",
            bounds
          )
        );
      }
    } catch (e) {
      fetchErrors.push(`Google News: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const industryResolution = await resolveIndustryPublicationsForDigest({
      userId: params.userId,
      ticker,
      companyName,
      sicRaw: sic,
      sicDescription,
      formerNames,
    });
    const trades = industryResolution.publications;
    for (const tr of trades.slice(0, 4)) {
      const q = `site:${tr.siteDomain} (${ticker} OR "${companyName.split(" ")[0] ?? ""}") after:${after} before:${before}`;
      const arts = await fetchGoogleNewsRssSearch(q, 8, "", true);
      for (const a of arts) {
        push(
          newsArticleToCandidate(
            {
              title: a.title,
              url: a.link,
              publishedAt: a.pubDate,
              summary: a.description ?? null,
              sourceName: tr.name,
            },
            "industry",
            bounds
          )
        );
      }
    }
  } catch (e) {
    fetchErrors.push(`Industry publications: ${e instanceof Error ? e.message : String(e)}`);
  }

  const competitorRefs =
    params.userId != null
      ? await loadChangeLogCompetitorTickers(ticker, params.userId)
      : [];
  const competitorCountBefore = candidates.length;
  if (competitorRefs.length > 0) {
    await gatherCompetitorSources({
      competitors: competitorRefs,
      bounds,
      excludeDedupeKeys: params.excludeDedupeKeys,
      push,
      fetchErrors,
    });
  }
  const competitorCandidateCount = candidates.length - competitorCountBefore;

  candidates.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  return {
    candidates,
    companyName,
    fetchErrors,
    sec,
    competitors: {
      tickers: competitorRefs,
      candidateCount: competitorCandidateCount,
    },
  };
}
