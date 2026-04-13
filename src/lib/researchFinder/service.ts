import type { ResearchFinderSearchRequest, ResearchFinderSearchResponse, ResearchProviderId, ResearchResult, ResearchSearch } from "./types";
import { loadResearchFinderConfigFromEnv } from "./config";
import { buildProfile } from "./profile";
import { PROVIDERS, getProviderById } from "./providers";
import { buildProviderQueries } from "./queryBuilder";
import { getResearchFinderSearchProviderFromEnv } from "./searchProvider/fromEnv";
import { extractPublicMetadata } from "./extractor";
import { scoreMatch } from "./scoring";
import { dedupeResults } from "./dedupe";
import { hostnameOf, nowIso, normalizeUrlForMatch, stableId } from "./utils";
import { replaceResultsForSearch, upsertSearch } from "./store/fileDb";
import { type DiscoveryHit, discoveryChannels, gatherRssDiscoveryHits, mergeSearchAndDiscoveryHits } from "./rssLayer";

const DISCLAIMER =
  "Best-effort public research discovery only. Results may be incomplete and do not represent the full research library of any provider. Some sources, including WSJ Pro Bankruptcy, may be partially or largely subscription-gated.";

/** Minimum match score to show a row. A 30 cutoff dropped many plausible hits (e.g. ticker in title + paywall penalty = 29). */
const MIN_MATCH_SCORE_TO_KEEP = 22;

function defaultProviders(): ResearchProviderId[] {
  return PROVIDERS.filter((p) => p.enabledByDefault).map((p) => p.id);
}

function isJunkUrl(url: string): boolean {
  const u = url.toLowerCase();
  return /(login|signup|trial|careers|privacy|terms|about|contact)/i.test(u);
}

export async function runResearchFinderSearch(
  req: ResearchFinderSearchRequest,
  userId: string
): Promise<ResearchFinderSearchResponse> {
  const cfg = loadResearchFinderConfigFromEnv();
  const providerEnv = getResearchFinderSearchProviderFromEnv();
  if (!providerEnv.ok) {
    return {
      disclaimer: DISCLAIMER,
      profile: { ticker: "", aliases: [], terms: [] },
      queriesUsed: {} as any,
      providerStatus: {} as any,
      summary: { candidateUrls: 0, keptResults: 0, rssCandidatesTotal: 0, byProvider: {} as any, confidence: { high: 0, medium: 0, low: 0 } },
      results: [],
      searchId: "",
      error: providerEnv.message,
    };
  }

  const profile = buildProfile({ ticker: req.ticker, companyName: req.companyName, aliases: req.aliases });
  if (!profile.ticker) {
    return {
      disclaimer: DISCLAIMER,
      profile,
      queriesUsed: {} as any,
      providerStatus: {} as any,
      summary: { candidateUrls: 0, keptResults: 0, rssCandidatesTotal: 0, byProvider: {} as any, confidence: { high: 0, medium: 0, low: 0 } },
      results: [],
      searchId: "",
      error: "ticker is required",
    };
  }

  const providers: ResearchProviderId[] = (req.providers && req.providers.length > 0 ? req.providers : defaultProviders()).filter(
    (id): id is ResearchProviderId => Boolean(getProviderById(id))
  );

  const startedAt = nowIso();
  const searchId = stableId(["research_search", profile.ticker, startedAt, JSON.stringify(providers)]);
  const search: ResearchSearch = {
    id: searchId,
    ticker: profile.ticker,
    company_name: profile.companyName ?? null,
    aliases_json: profile.aliases,
    providers_json: providers,
    status: "running",
    started_at: startedAt,
    completed_at: null,
    error_message: null,
    created_at: startedAt,
    updated_at: startedAt,
  };
  await upsertSearch(userId, search);

  const queriesUsed = {} as Record<ResearchProviderId, string[]>;
  const providerStatus = {} as Record<
    ResearchProviderId,
    { ok: boolean; error?: string; candidateUrls: number; kept: number; rssCandidates?: number }
  >;

  const allResults: ResearchResult[] = [];
  let totalCandidates = 0;

  for (const pid of providers) {
    const def = getProviderById(pid)!;
    const queries = buildProviderQueries(pid, profile, cfg.maxQueriesPerProvider);
    queriesUsed[pid] = queries;
    const searchHits: Array<{ title: string; url: string; snippet: string; query: string; publishedDate?: string | null }> = [];

    const settled = await Promise.allSettled(queries.map((q) => providerEnv.provider.search(q, { num: 10 })));
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i]!;
      if (s.status === "rejected") continue;
      searchHits.push(...s.value);
    }

    let rssHits: DiscoveryHit[] = [];
    try {
      rssHits = await gatherRssDiscoveryHits(pid, profile, cfg);
    } catch {
      rssHits = [];
    }

    const mergedHits = mergeSearchAndDiscoveryHits(searchHits, rssHits);

    const allow = new Set(def.domains.map((d) => d.toLowerCase()));
    const candidateUrls = mergedHits
      .map((h) => h.url)
      .map((u) => normalizeUrlForMatch(u) ?? u)
      .filter((u) => {
        const host = hostnameOf(u);
        const okDomain = Array.from(allow).some((d) => host === d || host.endsWith(`.${d}`));
        return okDomain && !isJunkUrl(u);
      });

    const unique = Array.from(new Set(candidateUrls)).slice(0, cfg.maxCandidatesPerProvider);
    totalCandidates += unique.length;

    const toExtract = unique.slice(0, cfg.maxExtractedPagesPerProvider);
    const extracted = await Promise.allSettled(toExtract.map((u) => extractPublicMetadata({ provider: pid, url: u, timeoutMs: cfg.timeoutMs })));

    let kept = 0;
    for (let i = 0; i < extracted.length; i++) {
      const s = extracted[i]!;
      const url = toExtract[i]!;
      const hitMeta = mergedHits.find((h) => (normalizeUrlForMatch(h.url) ?? h.url) === url);
      if (s.status === "rejected") continue;
      const ex = s.value;

      const importantPathBoost =
        pid === "wsj_bankruptcy" && /\/pro\/bankruptcy|\/news\/types\/pro-bankruptcy-bankruptcy/i.test(ex.finalUrl);

      const score = scoreMatch({
        provider: pid,
        profile,
        title: ex.title ?? hitMeta?.title ?? "",
        snippet: hitMeta?.snippet ?? ex.metaDescription ?? "",
        url: ex.finalUrl,
        excerpt: ex.excerpt ?? "",
        importantPathBoost,
        accessLevel: ex.accessLevel,
        pageType: ex.pageType,
      });

      // Precision-first cutoff: keep meaningful matches (see MIN_MATCH_SCORE_TO_KEEP)
      if (score.score < MIN_MATCH_SCORE_TO_KEEP) continue;
      kept += 1;

      const now = nowIso();
      const providerDomain = hostnameOf(ex.finalUrl);
      const channels = hitMeta ? discoveryChannels(hitMeta) : ["search"];
      const searchProviderLabel =
        channels.includes("search") && channels.includes("rss")
          ? `${providerEnv.provider.id}+google-news-rss`
          : channels.includes("rss")
            ? "google-news-rss"
            : providerEnv.provider.id;
      allResults.push({
        id: stableId(["research_result", searchId, pid, ex.normalizedUrl]),
        search_id: searchId,
        provider: pid,
        provider_domain: providerDomain,
        ticker: profile.ticker,
        company_name: profile.companyName ?? null,
        matched_alias: score.matchedAlias,
        url: ex.finalUrl,
        normalized_url: ex.normalizedUrl,
        canonical_url: ex.canonicalUrl,
        title: ex.title ?? hitMeta?.title ?? null,
        page_type: ex.pageType,
        publication_date: ex.publishedAt ?? (hitMeta?.publishedDate ? new Date(hitMeta.publishedDate).toISOString() : null),
        snippet: hitMeta?.snippet ?? ex.metaDescription ?? null,
        excerpt: ex.excerpt,
        query_used: hitMeta?.query ?? queries[0] ?? "",
        search_provider_used: searchProviderLabel,
        match_score: score.score,
        confidence_bucket: score.bucket,
        match_reasons: score.reasons,
        access_level: ex.accessLevel,
        byline: ex.byline,
        section_label: ex.sectionLabel,
        is_publicly_accessible: ex.isPubliclyAccessible,
        metadata_json: { notes: ex.notes, discoveryChannels: channels },
        created_at: now,
        updated_at: now,
      });
    }

    providerStatus[pid] = {
      ok: true,
      candidateUrls: unique.length,
      kept,
      rssCandidates: rssHits.length,
    };
  }

  const deduped = dedupeResults(allResults).sort((a, b) => b.match_score - a.match_score);
  const maxOut = Math.min(300, Math.max(20, Math.floor(req.maxResults ?? 120)));
  const results = deduped.slice(0, maxOut);

  const rssCandidatesTotal = Object.values(providerStatus).reduce((acc, s) => acc + (s.rssCandidates ?? 0), 0);

  const byProvider = { octus: 0, creditsights: 0, "9fin": 0, debtwire: 0, wsj_bankruptcy: 0 } as Record<ResearchProviderId, number>;
  const confidence = { high: 0, medium: 0, low: 0 };
  for (const r of results) {
    byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
    confidence[r.confidence_bucket] += 1;
  }

  await replaceResultsForSearch(userId, searchId, results);
  const doneAt = nowIso();
  await upsertSearch(userId, { ...search, status: "completed", completed_at: doneAt, updated_at: doneAt });

  return {
    disclaimer: DISCLAIMER,
    profile,
    queriesUsed,
    providerStatus,
    summary: {
      candidateUrls: totalCandidates,
      keptResults: results.length,
      rssCandidatesTotal,
      byProvider,
      confidence,
    },
    results,
    searchId,
  };
}

