import { getAllBrokerDefinitions } from "./brokerRegistry";
import { buildSupportingSignals, classifyAccessLevel, classifyReportType } from "./classifier";
import { loadBrokerRuntimeFlags, resolveActiveBrokers } from "./config";
import { dedupeBrokerResults } from "./dedupe";
import type { QueryContext } from "./queryBuilder";
import { buildQueriesForBroker } from "./queryBuilder";
import { rankBrokerResults, scoreForRanking, type SortMode } from "./rank";
import { getBrokerResearchSearchProviderFromEnv } from "./searchProvider/fromEnv";
import type {
  BrokerDefinition,
  BrokerResearchRequest,
  BrokerResearchResponse,
  BrokerResearchResult,
  BrokerResearchSearchProvider,
  RawSearchHit,
} from "./types";
import {
  hostnameOf,
  normalizeUrlForMatch,
  parsePublishedDate,
  stableResultId,
  urlMatchesBrokerDomains,
} from "./utils";

export type RunBrokerResearchOptions = {
  searchProvider?: BrokerResearchSearchProvider;
  brokers?: BrokerDefinition[];
  sortMode?: SortMode;
};

function normalizeHit(
  hit: RawSearchHit,
  broker: BrokerDefinition,
  ctx: QueryContext,
  searchProviderId: string
): BrokerResearchResult | null {
  if (!urlMatchesBrokerDomains(hit.url, broker.domains)) return null;

  const reportType = classifyReportType(hit.title, hit.snippet, hit.url);
  const accessLevel = classifyAccessLevel(hit.title, hit.snippet, hit.url);
  const signals = buildSupportingSignals({
    broker,
    title: hit.title,
    snippet: hit.snippet,
    url: hit.url,
    ticker: ctx.ticker,
    companyName: ctx.companyName,
  });

  const blob = `${hit.title} ${hit.snippet}`.toLowerCase();
  const tk = ctx.ticker.trim().toUpperCase();
  const matchedTickers: string[] = [];
  if (blob.includes(tk.toLowerCase())) matchedTickers.push(tk);

  const matchedCompanies: string[] = [];
  const cn = ctx.companyName?.trim();
  if (cn && blob.includes(cn.toLowerCase())) matchedCompanies.push(cn);
  for (const al of ctx.aliases) {
    const a = al.trim();
    if (a.length >= 2 && blob.includes(a.toLowerCase()) && !matchedCompanies.includes(a)) {
      matchedCompanies.push(a);
    }
  }

  let confidence = 0.22;
  confidence += Math.min(0.35, signals.length * 0.08);
  if (signals.includes("broker_domain_match")) confidence += 0.2;
  if (matchedTickers.length) confidence += 0.12;
  if (matchedCompanies.length) confidence += 0.1;
  confidence = Math.min(1, confidence);

  return {
    id: stableResultId(broker.id, hit.url, hit.title),
    brokerId: broker.id,
    brokerName: broker.name,
    title: hit.title.trim(),
    url: hit.url.trim(),
    normalizedUrl: normalizeUrlForMatch(hit.url) ?? undefined,
    snippet: hit.snippet?.trim() || null,
    publishedAt: parsePublishedDate(hit.publishedDate ?? null),
    companyName: cn ?? null,
    ticker: tk,
    matchedTickers,
    matchedCompanies,
    reportType,
    accessLevel,
    relevanceScore: 0,
    confidenceScore: Number(confidence.toFixed(3)),
    searchQuery: hit.query,
    searchProvider: searchProviderId,
    rawSourceDomain: hostnameOf(hit.url) ?? "",
    supportingSignals: signals,
  };
}

async function executeBroker(
  broker: BrokerDefinition,
  queries: string[],
  provider: BrokerResearchSearchProvider,
  hitsPerQuery: number,
  ctx: QueryContext
): Promise<{ results: BrokerResearchResult[]; errors: string[] }> {
  const settled = await Promise.allSettled(
    queries.map((q) => provider.search(q, { num: hitsPerQuery }))
  );

  const results: BrokerResearchResult[] = [];
  const errors: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]!;
    const query = queries[i]!;
    if (s.status === "rejected") {
      errors.push(s.reason instanceof Error ? s.reason.message : String(s.reason));
      continue;
    }
    for (const raw of s.value) {
      const hit: RawSearchHit = { ...raw, query };
      const n = normalizeHit(hit, broker, ctx, provider.id);
      if (n) results.push(n);
    }
  }

  return { results, errors };
}

export async function runBrokerResearch(
  req: BrokerResearchRequest,
  options?: RunBrokerResearchOptions
): Promise<BrokerResearchResponse> {
  const ticker = req.ticker?.trim().toUpperCase();
  if (!ticker) {
    return {
      ticker: "",
      aliases: [],
      activeBrokers: [],
      skippedBrokers: [],
      queryCount: 0,
      resultsBeforeDedupe: 0,
      resultsAfterDedupe: 0,
      brokerStats: {},
      reports: [],
      error: "ticker is required",
    };
  }

  const flags = loadBrokerRuntimeFlags();
  const allBrokers = options?.brokers ?? getAllBrokerDefinitions();
  const { active, skipped } = resolveActiveBrokers(allBrokers, req.enabledBrokers);

  let provider: BrokerResearchSearchProvider | null = options?.searchProvider ?? null;
  let searchConfigError: string | undefined;
  if (!provider) {
    const g = getBrokerResearchSearchProviderFromEnv();
    if (!g.ok) searchConfigError = g.message;
    else provider = g.provider;
  }

  if (!provider) {
    return {
      ticker,
      companyName: req.companyName?.trim() || undefined,
      aliases: req.aliases?.map((a) => a.trim()).filter(Boolean) ?? [],
      activeBrokers: [],
      skippedBrokers: skipped,
      queryCount: 0,
      resultsBeforeDedupe: 0,
      resultsAfterDedupe: 0,
      brokerStats: {},
      reports: [],
      error: searchConfigError ?? "Search provider unavailable",
    };
  }

  const ctx: QueryContext = {
    ticker,
    companyName: req.companyName?.trim() || undefined,
    aliases: req.aliases?.map((a) => a.trim()).filter(Boolean) ?? [],
    from: req.from,
    to: req.to,
  };

  const sortMode = options?.sortMode ?? "relevance";
  const brokerStats: BrokerResearchResponse["brokerStats"] = {};
  const collected: BrokerResearchResult[] = [];

  const workUnits = active.map((broker) => ({
    broker,
    queries: buildQueriesForBroker(broker, ctx, flags.maxQueriesPerBroker),
  }));
  const queryCount = workUnits.reduce((n, w) => n + w.queries.length, 0);

  const settledBrokers = await Promise.allSettled(
    workUnits.map(({ broker, queries }) =>
      (async () => {
        if (queries.length === 0) {
          return { broker, queries, results: [] as BrokerResearchResult[], errors: [] as string[] };
        }
        return executeBroker(broker, queries, provider, flags.hitsPerQuery, ctx).then((r) => ({
          broker,
          queries,
          ...r,
        }));
      })()
    )
  );

  for (let i = 0; i < settledBrokers.length; i++) {
    const s = settledBrokers[i]!;
    const w = workUnits[i]!;
    const broker = w.broker;
    if (s.status === "rejected") {
      const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      brokerStats[broker.id] = {
        queryCount: w.queries.length,
        resultCount: 0,
        success: false,
        error: msg,
      };
      continue;
    }
    const { results, errors } = s.value;
    collected.push(...results);
    const success = errors.length < w.queries.length || results.length > 0;
    brokerStats[broker.id] = {
      queryCount: w.queries.length,
      resultCount: results.length,
      success,
      error:
        errors.length > 0 && !success
          ? errors.slice(0, 3).join("; ")
          : errors.length > 0
            ? `Partial: ${errors[0]}`
            : undefined,
    };
  }

  const before = collected.length;
  const { merged, after } = dedupeBrokerResults(collected);

  const ranked = rankBrokerResults(merged, { ticker, companyName: ctx.companyName }, sortMode);

  const withScores = ranked.map((r) => ({
    ...r,
    relevanceScore: Number(scoreForRanking(r, { ticker, companyName: ctx.companyName }).toFixed(2)),
  }));

  const cap =
    req.maxResults != null && req.maxResults > 0
      ? Math.min(flags.globalMaxResults, Math.floor(req.maxResults))
      : flags.globalMaxResults;

  return {
    ticker,
    companyName: ctx.companyName,
    aliases: ctx.aliases,
    activeBrokers: active.map((b) => b.id),
    skippedBrokers: skipped,
    queryCount,
    resultsBeforeDedupe: before,
    resultsAfterDedupe: after,
    brokerStats,
    reports: withScores.slice(0, cap),
  };
}
