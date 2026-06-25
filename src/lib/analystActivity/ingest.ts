import { filterDisplayEvents } from "./confidence";
import { dedupeEvents } from "./dedupe";
import { isPrivateWorkspaceKey, workspaceSearchCompanyName } from "@/lib/company-workspace-key";
import { getAnalystActivitySearchProvider } from "./searchProvider";
import { buildBrokerActivitySummary } from "./summary";
import { createAlphaVantageAdapter, createFinnhubAdapter, createFmpAdapter } from "./sources/apiStubs";
import { createCompanyIrAdapter } from "./sources/companyIr";
import { createSearchDiscoveryAdapter } from "./sources/searchDiscovery";
import type {
  AnalystActivityEvent,
  AnalystActivityRequest,
  AnalystActivityResponse,
  AnalystActivitySourceAdapter,
  AnalystCoverageRecord,
  SourceAdapterContext,
  SourceAttemptLog,
} from "./types";

function dedupeCoverage(records: AnalystCoverageRecord[]): AnalystCoverageRecord[] {
  const byKey = new Map<string, AnalystCoverageRecord>();
  for (const r of records) {
    const key = `${r.broker.toLowerCase()}|${(r.analystName ?? "").toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || r.confidenceScore > existing.confidenceScore) {
      byKey.set(key, r);
    }
  }
  return [...byKey.values()].sort((a, b) => a.broker.localeCompare(b.broker));
}

function allAdapters(): AnalystActivitySourceAdapter[] {
  return [
    createSearchDiscoveryAdapter(),
    createCompanyIrAdapter(),
    createFinnhubAdapter(),
    createFmpAdapter(),
    createAlphaVantageAdapter(),
  ];
}

export async function ingestAnalystActivity(
  req: AnalystActivityRequest
): Promise<AnalystActivityResponse> {
  const ticker = req.ticker.trim().toUpperCase();
  const resolvedCompanyName = isPrivateWorkspaceKey(ticker)
    ? workspaceSearchCompanyName(ticker, req.companyName)
    : req.companyName?.trim();
  const retrievedAt = new Date().toISOString();
  const providerResult = getAnalystActivitySearchProvider();

  const ctx: SourceAdapterContext = {
    ticker,
    companyName: resolvedCompanyName,
    aliases: req.aliases,
    search: providerResult.ok ? providerResult.provider : undefined,
    retrievedAt,
  };

  const adapters = allAdapters();
  const sourceLogs: SourceAttemptLog[] = [];
  let allEvents: AnalystActivityEvent[] = [];
  let allCoverage: AnalystCoverageRecord[] = [];

  for (const adapter of adapters) {
    const result = await adapter.fetch(ctx);
    sourceLogs.push(result.log);
    allEvents = allEvents.concat(result.events);
    allCoverage = allCoverage.concat(result.coverage);
  }

  const rawCount = allEvents.length;
  const deduped = dedupeEvents(allEvents);
  const events = filterDisplayEvents(deduped);
  const coverage = dedupeCoverage(allCoverage);
  const uniqueBrokers = new Set(coverage.map((c) => c.broker.toLowerCase()));

  const summary = buildBrokerActivitySummary(events, uniqueBrokers.size);

  const response: AnalystActivityResponse = {
    ticker,
    companyName: req.companyName,
    events,
    coverage,
    summary,
    sourceLogs,
    retrievedAt,
  };

  if (!providerResult.ok && events.length === 0 && coverage.length === 0) {
    response.error = providerResult.error.message;
  }

  console.info("[analyst-activity]", {
    ticker,
    sourcesAttempted: sourceLogs.length,
    rawEvents: rawCount,
    dedupedEvents: deduped.length,
    displayEvents: events.length,
    coverage: coverage.length,
  });

  return response;
}

export async function refreshAnalystActivity(ticker: string, companyName?: string) {
  return ingestAnalystActivity({ ticker, companyName });
}

export function getAnalystActivityFromResponse(
  data: AnalystActivityResponse,
  startDate?: string,
  endDate?: string
) {
  let events = data.events;
  if (startDate) events = events.filter((e) => (e.eventDate ?? "") >= startDate);
  if (endDate) events = events.filter((e) => (e.eventDate ?? "") <= endDate);
  return events;
}

export function getAnalystCoverageFromResponse(data: AnalystActivityResponse) {
  return data.coverage;
}

export function getBrokerActivitySummaryFromResponse(data: AnalystActivityResponse) {
  return data.summary;
}
