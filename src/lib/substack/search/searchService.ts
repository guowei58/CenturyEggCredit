import { loadSubstackConfigFromEnv } from "../config";
import type {
  SubstackPublication,
  SubstackPost,
  SubstackSearchRequest,
  SubstackSearchResponse,
  SubstackSearchResult,
} from "../types";
import { createSerpApiDiscoveryProvider } from "../discovery/serpApi";
import { detectPublicationFromHit } from "../discovery/publicationDetector";
import { matchText } from "../matching/matcher";
import { inferFeedUrl } from "../rss/feedInference";
import { ingestPublicationRss } from "../rss/rssIngestService";
import { loadSubstackDb, upsertPosts, upsertPublications, updatePublicationIngested } from "../registry/fileDb";
import { clampInt, normalizeUrlForMatch, nowIso, parseDateIsoOrNull, stableId } from "../utils";
import { dedupeResults } from "./dedupe";
import { rankResults, type SortMode } from "./rank";

function toPostFromDiscovery(args: {
  publication: SubstackPublication | null;
  url: string;
  title: string;
  snippet: string;
  publishedDate?: string | null;
  ticker: string;
  companyName?: string;
  aliases: string[];
}): SubstackPost | null {
  const norm = normalizeUrlForMatch(args.url);
  if (!norm) return null;
  const now = nowIso();
  const match = matchText({
    ticker: args.ticker,
    companyName: args.companyName,
    aliases: args.aliases,
    text: `${args.title}\n${args.snippet}`,
  });

  if (match.matchType === "none") return null;

  const pubId = args.publication?.id ?? stableId(["substack_pub_unknown", new URL(norm).host]);
  return {
    id: stableId(["substack_post", pubId, norm.toLowerCase()]),
    publicationId: pubId,
    publicationName: args.publication?.name ?? null,
    title: args.title.trim() || norm,
    url: args.url,
    normalizedUrl: norm,
    publishedAt: parseDateIsoOrNull(args.publishedDate ?? null),
    author: null,
    summary: args.snippet?.trim() || null,
    contentSnippet: args.snippet?.trim() ? args.snippet.trim().slice(0, 280) : null,
    tickers: match.tickers,
    companyMentions: match.companies,
    matchedTerms: match.matchedTerms,
    matchType: match.matchType === "mixed" ? "mixed" : match.matchType === "company" ? "company" : match.matchType === "alias" ? "alias" : "ticker",
    confidenceScore: match.confidence,
    source: "serpapi",
    discoveredAt: now,
  };
}

function isHighConfidence(r: SubstackSearchResult): boolean {
  return r.post.confidenceScore >= 0.72 || (r.publication?.confidenceScore ?? 0) >= 0.75;
}

export async function runSubstackSearch(req: SubstackSearchRequest, userId: string): Promise<SubstackSearchResponse> {
  const cfg = loadSubstackConfigFromEnv();
  const ticker = (req.ticker ?? "").trim().toUpperCase();
  if (!ticker) {
    return {
      ticker: "",
      aliases: [],
      stats: {
        registryPublications: 0,
        publicationsSearched: 0,
        indexedMatches: 0,
        liveDiscoveryMatches: 0,
        newPublicationsFound: 0,
        rssIngestedPublications: 0,
      },
      results: [],
      error: "ticker is required",
    };
  }

  const aliases = (req.aliases ?? []).map((a) => a.trim()).filter(Boolean);
  const companyName = req.companyName?.trim() || undefined;
  const wantDiscovery = req.liveDiscovery !== false;
  const maxResults = clampInt(req.maxResults ?? 80, 10, 200);
  const sortMode: SortMode = req.sortMode === "recent" || req.sortMode === "publication" ? req.sortMode : "relevance";
  const filterMode = req.filterMode ?? "all";

  const db = await loadSubstackDb(userId);
  const registryPublications = db.publications.length;

  // 1) DB-first matches
  const indexedMatches: SubstackSearchResult[] = [];
  for (const p of db.posts) {
    const blob = `${p.title} ${p.summary ?? ""} ${p.contentSnippet ?? ""}`.toLowerCase();
    const m = matchText({ ticker, companyName, aliases, text: blob });
    if (m.matchType === "none") continue;
    indexedMatches.push({
      post: { ...p, tickers: m.tickers, companyMentions: m.companies, matchedTerms: m.matchedTerms, confidenceScore: Math.max(p.confidenceScore, m.confidence) },
      publication: db.publications.find((x) => x.id === p.publicationId) ?? null,
      relevanceScore: 0,
      discoverySource: "db",
    });
  }

  // 2) Live discovery (SerpApi) in parallel
  let live: SubstackSearchResult[] = [];
  let newPubs = 0;
  let rssIngested = 0;

  if (wantDiscovery && cfg.discoveryEnabled) {
    if (!cfg.serpApiKey) {
      // keep DB results but annotate error
      live = [];
    } else {
      const provider = createSerpApiDiscoveryProvider(cfg.serpApiKey, cfg.requestTimeoutMs);
      const discovered = await provider.discover({
        ticker,
        companyName,
        aliases,
        maxResults: cfg.maxDiscoveryResults,
      });

      const pubs: SubstackPublication[] = [];
      const posts: SubstackPost[] = [];

      for (const d of discovered) {
        const hit = d.hit;
        const det = detectPublicationFromHit({ url: hit.url, title: hit.title, snippet: hit.snippet });
        const pub = det?.publication ?? null;
        if (pub) {
          // infer feed url immediately; can be overridden later
          const feed = inferFeedUrl(pub.baseUrl);
          pubs.push({ ...pub, feedUrl: pub.feedUrl ?? feed, confidenceScore: Math.max(pub.confidenceScore, det?.confidence ?? 0) });
        }

        const p = toPostFromDiscovery({
          publication: pub,
          url: hit.url,
          title: hit.title,
          snippet: hit.snippet,
          publishedDate: hit.publishedDate,
          ticker,
          companyName,
          aliases,
        });
        if (p) posts.push(p);
      }

      // upsert registry + posts
      const beforeSet = new Set(db.publications.map((p) => p.id));
      await upsertPublications(userId, pubs);
      newPubs = pubs.filter((p) => !beforeSet.has(p.id)).length;
      await upsertPosts(userId, posts);

      // RSS ingest for a bounded set of publications (coverage-first loop)
      if (cfg.rssIngestEnabled) {
        const uniquePubs = Array.from(
          new Map(pubs.map((p) => [p.id, p] as const)).values()
        )
          .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
          .slice(0, cfg.maxPublicationsPerRun);

        const settled = await Promise.allSettled(
          uniquePubs.map(async (p) => {
            const ing = await ingestPublicationRss({
              publication: p,
              timeoutMs: cfg.requestTimeoutMs,
              maxPosts: cfg.maxPostsPerFeed,
              matchContext: { ticker, companyName, aliases },
            });
            if (!ing.ok) return { pub: p, posts: [] as SubstackPost[], feedUrl: null as string | null };
            return { pub: p, posts: ing.posts, feedUrl: ing.feedUrl };
          })
        );

        const rssPosts: SubstackPost[] = [];
        for (const s of settled) {
          if (s.status === "rejected") continue;
          if (s.value.posts.length > 0) {
            rssIngested += 1;
            rssPosts.push(...s.value.posts);
            await updatePublicationIngested(userId, s.value.pub.id);
          }
        }
        if (rssPosts.length > 0) await upsertPosts(userId, rssPosts);
      }

      // Build live results from discovery posts.
      live = posts.map((p) => ({
        post: p,
        publication: pubs.find((x) => x.id === p.publicationId) ?? null,
        relevanceScore: 0,
        discoverySource: "serpapi_live",
      }));
    }
  }

  // 3) Merge + dedupe + rank
  const mergedMap = new Map<string, SubstackSearchResult>();
  const add = (r: SubstackSearchResult) => {
    const k = r.post.normalizedUrl.toLowerCase();
    const prev = mergedMap.get(k);
    if (!prev) {
      mergedMap.set(k, r);
      return;
    }
    const best = prev;
    const next: SubstackSearchResult = {
      post: {
        ...best.post,
        ...r.post,
        source: best.post.source === r.post.source ? best.post.source : "rss",
        matchedTerms: Array.from(new Set([...(best.post.matchedTerms ?? []), ...(r.post.matchedTerms ?? [])])),
        tickers: Array.from(new Set([...(best.post.tickers ?? []), ...(r.post.tickers ?? [])])),
        companyMentions: Array.from(new Set([...(best.post.companyMentions ?? []), ...(r.post.companyMentions ?? [])])),
        confidenceScore: Math.max(best.post.confidenceScore, r.post.confidenceScore),
      },
      publication: best.publication ?? r.publication,
      relevanceScore: Math.max(best.relevanceScore, r.relevanceScore),
      discoverySource: prev.discoverySource === r.discoverySource ? prev.discoverySource : "merged",
    };
    mergedMap.set(k, next);
  };

  for (const r of indexedMatches) add(r);
  for (const r of live) add(r);

  let results = Array.from(mergedMap.values());
  if (filterMode === "indexed_only") results = results.filter((r) => r.discoverySource === "db");
  if (filterMode === "live_only") results = results.filter((r) => r.discoverySource === "serpapi_live");
  if (filterMode === "high_confidence") results = results.filter(isHighConfidence);

  results = dedupeResults(results);
  results = rankResults(results, sortMode).slice(0, maxResults);

  return {
    ticker,
    companyName,
    aliases,
    stats: {
      registryPublications,
      publicationsSearched: rssIngested,
      indexedMatches: indexedMatches.length,
      liveDiscoveryMatches: live.length,
      newPublicationsFound: newPubs,
      rssIngestedPublications: rssIngested,
    },
    results,
  };
}

