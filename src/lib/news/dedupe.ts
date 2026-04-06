import type { NormalizedNewsArticle } from "./types";
import { normalizeTitleForMatch, normalizeUrlForMatch, titleSimilarity } from "./utils";

const TITLE_DUP_THRESHOLD = 0.82;
const TIME_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const SOURCE_TITLE_THRESHOLD = 0.88;

function publishedMs(a: NormalizedNewsArticle): number | null {
  if (!a.publishedAt) return null;
  const t = Date.parse(a.publishedAt);
  return Number.isFinite(t) ? t : null;
}

function closeInTime(a: NormalizedNewsArticle, b: NormalizedNewsArticle): boolean {
  const ta = publishedMs(a);
  const tb = publishedMs(b);
  if (ta == null || tb == null) return false;
  return Math.abs(ta - tb) <= TIME_WINDOW_MS;
}

function sameSourceNorm(a: string, b: string): boolean {
  return normalizeTitleForMatch(a) === normalizeTitleForMatch(b);
}

/**
 * Whether `cand` duplicates `rep` (representative of cluster).
 */
export function articlesAreDuplicates(rep: NormalizedNewsArticle, cand: NormalizedNewsArticle): boolean {
  const u1 = rep.normalizedUrl ?? normalizeUrlForMatch(rep.url);
  const u2 = cand.normalizedUrl ?? normalizeUrlForMatch(cand.url);
  if (u1 && u2 && u1 === u2) return true;

  const rawClose = rep.url.trim().toLowerCase() === cand.url.trim().toLowerCase();
  if (rawClose) return true;

  const sim = titleSimilarity(rep.title, cand.title);
  if (sim >= TITLE_DUP_THRESHOLD && closeInTime(rep, cand)) return true;

  if (
    sameSourceNorm(rep.sourceName, cand.sourceName) &&
    sim >= SOURCE_TITLE_THRESHOLD &&
    closeInTime(rep, cand)
  ) {
    return true;
  }

  return false;
}

function scoreUrlQuality(url: string): number {
  let s = 0;
  if (url.startsWith("https://")) s += 2;
  try {
    const u = new URL(url);
    if (u.pathname.length > 5 && u.pathname.length < 120) s += 1;
    if (u.search.length > 60) s -= 1;
  } catch {
    /* ignore */
  }
  return s;
}

function mergeTwo(a: NormalizedNewsArticle, b: NormalizedNewsArticle): NormalizedNewsArticle {
  const url =
    scoreUrlQuality(a.url) >= scoreUrlQuality(b.url) ? a.url : b.url;
  const sumA = a.summary?.length ?? 0;
  const sumB = b.summary?.length ?? 0;
  const summary = sumA >= sumB ? a.summary : b.summary;
  const imageUrl = a.imageUrl ?? b.imageUrl;
  const tickers = Array.from(
    new Set([...(a.tickers ?? []), ...(b.tickers ?? [])].map((t) => t.toUpperCase()))
  );
  const companies = Array.from(
    new Set([...(a.companies ?? []), ...(b.companies ?? [])].filter(Boolean))
  );
  const providers = Array.from(new Set([...(a.providers ?? []), ...(b.providers ?? [])]));
  const providerIds = { ...a.providerIds, ...b.providerIds };
  const sentimentScore =
    a.sentimentScore != null && b.sentimentScore != null
      ? (a.sentimentScore + b.sentimentScore) / 2
      : (a.sentimentScore ?? b.sentimentScore ?? null);
  const sentimentLabel = a.sentimentLabel ?? b.sentimentLabel;
  let publishedAt = a.publishedAt;
  const ta = publishedMs(a);
  const tb = publishedMs(b);
  if (ta != null && tb != null) {
    publishedAt = ta >= tb ? a.publishedAt : b.publishedAt;
  } else {
    publishedAt = a.publishedAt ?? b.publishedAt;
  }
  const sourceName = a.sourceName || b.sourceName;
  const language = a.language ?? b.language;
  const rawCategories = Array.from(
    new Set([...(a.rawCategories ?? []), ...(b.rawCategories ?? [])].filter(Boolean))
  );
  const sourceDomain = (a.sourceDomain || b.sourceDomain)?.trim() || undefined;
  const matchedQuery = a.matchedQuery?.trim() || b.matchedQuery?.trim() || undefined;
  const prio = Math.min(a._bestProviderPriority ?? 999, b._bestProviderPriority ?? 999);

  return {
    id: a.id,
    title: a.title.length >= b.title.length ? a.title : b.title,
    url,
    normalizedUrl: normalizeUrlForMatch(url) ?? undefined,
    sourceName,
    sourceDomain,
    publishedAt,
    summary,
    imageUrl,
    tickers,
    companies,
    sentimentScore,
    sentimentLabel,
    providers,
    providerIds,
    rawCategories: rawCategories.length ? rawCategories : undefined,
    language,
    matchedQuery,
    _bestProviderPriority: prio,
  };
}

export function mergeDuplicateCluster(cluster: NormalizedNewsArticle[]): NormalizedNewsArticle {
  if (cluster.length === 1) return cluster[0]!;
  return cluster.reduce((acc, cur) => mergeTwo(acc, cur));
}

/**
 * Greedy clustering: representatives chosen in input order (caller should sort by quality first).
 */
export function dedupeAndMergeArticles(articles: NormalizedNewsArticle[]): {
  merged: NormalizedNewsArticle[];
  totalBefore: number;
  totalAfter: number;
} {
  const sorted = [...articles].sort((a, b) => {
    const pa = a._bestProviderPriority ?? 99;
    const pb = b._bestProviderPriority ?? 99;
    if (pa !== pb) return pa - pb;
    const ta = publishedMs(a) ?? 0;
    const tb = publishedMs(b) ?? 0;
    return tb - ta;
  });

  const clusters: NormalizedNewsArticle[][] = [];
  for (const art of sorted) {
    let placed = false;
    for (const c of clusters) {
      const rep = c[0]!;
      if (articlesAreDuplicates(rep, art)) {
        c.push(art);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([art]);
  }

  const merged = clusters.map((c) => mergeDuplicateCluster(c));
  return {
    merged,
    totalBefore: articles.length,
    totalAfter: merged.length,
  };
}
