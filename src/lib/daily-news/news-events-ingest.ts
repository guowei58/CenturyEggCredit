import { runNewsAggregation } from "@/lib/news/service";
import { isLikelyTickerInstrumentPage } from "@/lib/news/stockPageFilter";
import type { NormalizedNewsArticle } from "@/lib/news/types";
import { classifyOutletFromUrl } from "./classify-source";
import { dedupeHashFor } from "./dedupe";
import { formatNyDateKey, publishedOnNyDateKey } from "./dates";
import type { DailyNewsItem } from "./types";

export type NewsEventsIngestResult = {
  items: DailyNewsItem[];
  sourcesUsed: string[];
  fetchErrors: Array<{ source: string; message: string }>;
};

function articleToDailyNewsItem(ticker: string, article: NormalizedNewsArticle, dateKey: string): DailyNewsItem {
  const headline = article.title.trim();
  const url = article.url.trim();
  const { source, sourceType } = classifyOutletFromUrl(url);
  const displaySource = article.sourceName?.trim() || source;
  const publishedAt = article.publishedAt?.trim()
    ? article.publishedAt.slice(0, 10)
    : dateKey;

  return {
    dedupeHash: dedupeHashFor(headline, url),
    ticker: ticker.toUpperCase(),
    source: displaySource,
    sourceType,
    headline: headline.replace(/ - .*$/, "").slice(0, 300),
    url,
    publishedAt,
    summary: (article.summary ?? headline).slice(0, 400),
    whyItMatters: "From News & Events — verify materiality vs. your catalyst list and model.",
  };
}

/**
 * Pull the same aggregated sources as the company News & Events tab, keeping only
 * articles published on the request day (America/New_York calendar date).
 */
export async function fetchNewsEventsTabItemsForDay(
  ticker: string,
  companyName: string,
  windowEnd: Date
): Promise<NewsEventsIngestResult> {
  const dateKey = formatNyDateKey(windowEnd);
  const fetchErrors: Array<{ source: string; message: string }> = [];
  const sourcesUsed = new Set<string>();

  try {
    const agg = await runNewsAggregation(
      {
        ticker,
        companyName,
        from: dateKey,
        to: dateKey,
        limit: 100,
      },
      { sortMode: "recent" }
    );

    for (const [providerId, stat] of Object.entries(agg.providerStats)) {
      if (stat.success && stat.count > 0) {
        sourcesUsed.add(`News & Events (${providerId})`);
      } else if (!stat.success && stat.error) {
        fetchErrors.push({
          source: `news-events:${ticker}:${providerId}`,
          message: stat.error,
        });
      }
    }

    const items: DailyNewsItem[] = [];
    for (const article of agg.articles) {
      if (!publishedOnNyDateKey(article.publishedAt, dateKey)) continue;
      if (
        isLikelyTickerInstrumentPage({
          title: article.title,
          url: article.url,
          sourceDomain: article.sourceDomain ?? undefined,
        })
      ) {
        continue;
      }
      items.push(articleToDailyNewsItem(ticker, article, dateKey));
    }

    return { items, sourcesUsed: Array.from(sourcesUsed), fetchErrors };
  } catch (e) {
    fetchErrors.push({
      source: `news-events:${ticker}`,
      message: e instanceof Error ? e.message : String(e),
    });
    return { items: [], sourcesUsed: [], fetchErrors };
  }
}
