import type { BrokerResearchResult } from "./types";
import { normalizeUrlForMatch, parsePublishedDate, titleSimilarity } from "./utils";

const TITLE_THRESH = 0.82;
const TIME_WINDOW_MS = 48 * 60 * 60 * 1000;

function publishedMs(r: BrokerResearchResult): number | null {
  if (!r.publishedAt) return null;
  const t = Date.parse(r.publishedAt);
  return Number.isFinite(t) ? t : null;
}

function closeInTime(a: BrokerResearchResult, b: BrokerResearchResult): boolean {
  const ta = publishedMs(a);
  const tb = publishedMs(b);
  if (ta == null || tb == null) return false;
  return Math.abs(ta - tb) <= TIME_WINDOW_MS;
}

export function resultsAreDuplicates(rep: BrokerResearchResult, cand: BrokerResearchResult): boolean {
  if (rep.brokerId !== cand.brokerId) return false;

  const u1 = rep.normalizedUrl ?? normalizeUrlForMatch(rep.url);
  const u2 = cand.normalizedUrl ?? normalizeUrlForMatch(cand.url);
  if (u1 && u2 && u1 === u2) return true;

  if (rep.url.trim().toLowerCase() === cand.url.trim().toLowerCase()) return true;

  const sim = titleSimilarity(rep.title, cand.title);
  if (sim >= TITLE_THRESH && closeInTime(rep, cand)) return true;

  return false;
}

function pickBetterTitle(a: string, b: string): string {
  return a.length >= b.length ? a : b;
}

function pickBetterSnippet(a: string | null, b: string | null): string | null {
  const la = a?.length ?? 0;
  const lb = b?.length ?? 0;
  return la >= lb ? a : b;
}

function mergeTwo(a: BrokerResearchResult, b: BrokerResearchResult): BrokerResearchResult {
  const title = pickBetterTitle(a.title, b.title);
  const snippet = pickBetterSnippet(a.snippet, b.snippet);
  const url = (a.snippet?.length ?? 0) >= (b.snippet?.length ?? 0) ? a.url : b.url;
  const normalizedUrl = normalizeUrlForMatch(url) ?? undefined;

  const ta = publishedMs(a);
  const tb = publishedMs(b);
  let publishedAt = a.publishedAt;
  if (ta != null && tb != null) {
    publishedAt = ta >= tb ? a.publishedAt : b.publishedAt;
  } else {
    publishedAt = a.publishedAt ?? b.publishedAt;
  }
  publishedAt = parsePublishedDate(publishedAt) ?? publishedAt;

  const signals = Array.from(new Set([...a.supportingSignals, ...b.supportingSignals]));
  const matchedTickers = Array.from(new Set([...a.matchedTickers, ...b.matchedTickers]));
  const matchedCompanies = Array.from(new Set([...a.matchedCompanies, ...b.matchedCompanies].filter(Boolean)));

  const confidenceScore = Math.max(a.confidenceScore, b.confidenceScore);
  const relevanceScore = Math.max(a.relevanceScore, b.relevanceScore);

  const reportType =
    a.reportType !== "unknown" ? a.reportType : b.reportType !== "unknown" ? b.reportType : "unknown";
  const accessLevel =
    a.accessLevel !== "unknown" ? a.accessLevel : b.accessLevel !== "unknown" ? b.accessLevel : "unknown";

  return {
    ...a,
    id: a.id,
    title,
    url,
    normalizedUrl,
    snippet,
    publishedAt,
    matchedTickers,
    matchedCompanies,
    reportType,
    accessLevel,
    relevanceScore,
    confidenceScore,
    supportingSignals: signals,
    searchQuery: a.searchQuery,
  };
}

export function mergeCluster(cluster: BrokerResearchResult[]): BrokerResearchResult {
  if (cluster.length === 1) return cluster[0]!;
  return cluster.reduce((acc, cur) => mergeTwo(acc, cur));
}

export function dedupeBrokerResults(results: BrokerResearchResult[]): {
  merged: BrokerResearchResult[];
  before: number;
  after: number;
} {
  const sorted = [...results].sort((a, b) => b.confidenceScore - a.confidenceScore);
  const clusters: BrokerResearchResult[][] = [];

  for (const r of sorted) {
    let placed = false;
    for (const c of clusters) {
      const rep = c[0]!;
      if (resultsAreDuplicates(rep, r)) {
        c.push(r);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([r]);
  }

  const merged = clusters.map((c) => mergeCluster(c));
  return { merged, before: results.length, after: merged.length };
}
