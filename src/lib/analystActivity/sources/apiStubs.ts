import { createHash } from "crypto";
import { probableReportExists, scoreEventConfidence } from "../confidence";
import { getSourceConfig } from "../config";
import { buildDedupeKey } from "../dedupe";
import { parseActionType, ratingToBucket } from "../normalize";
import type { AnalystActivityEvent, AnalystActivitySourceAdapter, SourceAdapterContext, SourceAdapterResult, SourceAttemptLog } from "../types";

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function createApiStubAdapter(
  id: "finnhub" | "fmp" | "alphavantage",
  name: string,
  sourceType: "finnhub_api" | "fmp_api" | "alphavantage_api",
  envKey: string,
  isEnabled: () => boolean
): AnalystActivitySourceAdapter {
  return {
    id,
    name,
    isEnabled,
    async fetch(ctx: SourceAdapterContext): Promise<SourceAdapterResult> {
      const log: SourceAttemptLog = {
        sourceId: id,
        sourceName: name,
        status: "skipped",
        rawCount: 0,
        normalizedCount: 0,
      };

      if (!isEnabled()) {
        log.message = `Disabled or missing ${envKey}`;
        return { events: [], coverage: [], log };
      }

      const apiKey = process.env[envKey]?.trim();
      if (!apiKey) {
        log.message = `${envKey} not set`;
        return { events: [], coverage: [], log };
      }

      try {
        const events = await fetchApiEvents(id, ctx, apiKey, sourceType);
        log.rawCount = events.length;
        log.normalizedCount = events.length;
        log.status = events.length > 0 ? "success" : "skipped";
        if (events.length === 0) log.message = "No records returned from API";
        return { events, coverage: [], log };
      } catch (e) {
        log.status = "failed";
        log.message = e instanceof Error ? e.message : `${name} adapter failed`;
        return { events: [], coverage: [], log };
      }
    },
  };
}

async function fetchApiEvents(
  id: "finnhub" | "fmp" | "alphavantage",
  ctx: SourceAdapterContext,
  apiKey: string,
  sourceType: "finnhub_api" | "fmp_api" | "alphavantage_api"
): Promise<AnalystActivityEvent[]> {
  const ticker = ctx.ticker.toUpperCase();
  if (id === "finnhub") {
    const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`Finnhub ${res.status}`);
    const rows = (await res.json()) as { period?: string; buy?: number; hold?: number; sell?: number; strongBuy?: number; strongSell?: number }[];
    return (rows ?? []).slice(0, 12).map((row) => {
      const actionType = parseActionType("recommendation trend");
      const event: AnalystActivityEvent = {
        id: stableId([ticker, "finnhub", row.period ?? ""]),
        ticker,
        companyName: ctx.companyName ?? null,
        eventDate: row.period ?? null,
        broker: "Consensus (Finnhub)",
        analystName: null,
        actionType,
        ratingPrior: null,
        ratingCurrent: `Buy ${row.buy ?? 0} / Hold ${row.hold ?? 0} / Sell ${row.sell ?? 0}`,
        ratingBucketPrior: "unknown",
        ratingBucketCurrent: "neutral",
        priceTargetPrior: null,
        priceTargetCurrent: null,
        currency: null,
        headline: `Finnhub recommendation trend — ${row.period ?? "period unknown"}`,
        snippet: `Strong buy ${row.strongBuy ?? 0}, buy ${row.buy ?? 0}, hold ${row.hold ?? 0}, sell ${row.sell ?? 0}, strong sell ${row.strongSell ?? 0}`,
        sourceName: "Finnhub",
        sourceUrl: "https://finnhub.io/docs/api/recommendation-trends",
        sourceType,
        retrievedAt: ctx.retrievedAt,
        confidenceScore: scoreEventConfidence({
          sourceType,
          hasDate: Boolean(row.period),
          hasBroker: true,
          hasAction: true,
          hasRating: true,
          hasPriceTarget: false,
          hasHeadline: true,
        }),
        probableReportExists: false,
        dedupeKey: "",
      };
      event.dedupeKey = buildDedupeKey(event);
      return event;
    });
  }

  if (id === "fmp") {
    const url = `https://financialmodelingprep.com/api/v3/analyst-estimates/${encodeURIComponent(ticker)}?limit=5&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`FMP ${res.status}`);
    const rows = (await res.json()) as { date?: string; estimatedEpsAvg?: number }[];
    return (rows ?? []).map((row) => {
      const event: AnalystActivityEvent = {
        id: stableId([ticker, "fmp", row.date ?? ""]),
        ticker,
        companyName: ctx.companyName ?? null,
        eventDate: row.date ?? null,
        broker: "FMP estimates",
        analystName: null,
        actionType: "estimate_revision",
        ratingPrior: null,
        ratingCurrent: null,
        ratingBucketPrior: "unknown",
        ratingBucketCurrent: "unknown",
        priceTargetPrior: null,
        priceTargetCurrent: null,
        currency: null,
        headline: `Analyst EPS estimate ${row.estimatedEpsAvg ?? "n/a"}`,
        snippet: null,
        sourceName: "Financial Modeling Prep",
        sourceUrl: "https://site.financialmodelingprep.com/developer/docs",
        sourceType,
        retrievedAt: ctx.retrievedAt,
        confidenceScore: 75,
        probableReportExists: false,
        dedupeKey: "",
      };
      event.dedupeKey = buildDedupeKey(event);
      return event;
    });
  }

  // alphavantage stub — overview may include analyst target field
  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Alpha Vantage ${res.status}`);
  const row = (await res.json()) as { AnalystTargetPrice?: string; Symbol?: string };
  if (!row.AnalystTargetPrice) return [];
  const pt = parseFloat(row.AnalystTargetPrice);
  const event: AnalystActivityEvent = {
    id: stableId([ticker, "alphavantage", row.AnalystTargetPrice]),
    ticker,
    companyName: ctx.companyName ?? null,
    eventDate: null,
    broker: "Alpha Vantage consensus",
    analystName: null,
    actionType: "price_target_changed",
    ratingPrior: null,
    ratingCurrent: null,
    ratingBucketPrior: "unknown",
    ratingBucketCurrent: "unknown",
    priceTargetPrior: null,
    priceTargetCurrent: Number.isFinite(pt) ? pt : null,
    currency: "USD",
    headline: `Consensus analyst target price ${row.AnalystTargetPrice}`,
    snippet: null,
    sourceName: "Alpha Vantage",
    sourceUrl: "https://www.alphavantage.co/documentation/",
    sourceType,
    retrievedAt: ctx.retrievedAt,
    confidenceScore: 72,
    probableReportExists: false,
    dedupeKey: "",
  };
  event.dedupeKey = buildDedupeKey(event);
  return [event];
}

export function createFinnhubAdapter(): AnalystActivitySourceAdapter {
  const cfg = getSourceConfig();
  return createApiStubAdapter("finnhub", "Finnhub recommendation trends", "finnhub_api", "FINNHUB_API_KEY", () => cfg.finnhub);
}

export function createFmpAdapter(): AnalystActivitySourceAdapter {
  const cfg = getSourceConfig();
  return createApiStubAdapter("fmp", "Financial Modeling Prep", "fmp_api", "FMP_API_KEY", () => cfg.fmp);
}

export function createAlphaVantageAdapter(): AnalystActivitySourceAdapter {
  const cfg = getSourceConfig();
  return createApiStubAdapter(
    "alphavantage",
    "Alpha Vantage",
    "alphavantage_api",
    "ALPHAVANTAGE_API_KEY",
    () => cfg.alphaVantage
  );
}
