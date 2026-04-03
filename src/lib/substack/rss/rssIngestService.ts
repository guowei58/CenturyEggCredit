import type { SubstackPost, SubstackPublication } from "../types";
import { matchText } from "../matching/matcher";
import { normalizeUrlForMatch, nowIso, parseDateIsoOrNull, stableId } from "../utils";
import { fetchRssXml } from "./rssFetcher";
import { inferFeedUrl } from "./feedInference";
import { parseRss } from "./rssParser";

function toPostMatchType(m: ReturnType<typeof matchText> | null): SubstackPost["matchType"] {
  if (!m || m.matchType === "none") return "ticker";
  return m.matchType === "mixed" ? "mixed" : m.matchType === "company" ? "company" : m.matchType === "alias" ? "alias" : "ticker";
}

export async function ingestPublicationRss(params: {
  publication: SubstackPublication;
  timeoutMs: number;
  maxPosts: number;
  matchContext?: { ticker: string; companyName?: string; aliases: string[] };
}): Promise<{ ok: true; posts: SubstackPost[]; feedUrl: string } | { ok: false; error: string }> {
  const pub = params.publication;
  const feedUrl = pub.feedUrl ?? inferFeedUrl(pub.baseUrl);
  if (!feedUrl) return { ok: false, error: "Could not infer feed URL" };
  try {
    const xml = await fetchRssXml(feedUrl, params.timeoutMs);
    const parsed = parseRss(xml);
    const now = nowIso();

    const posts: SubstackPost[] = [];
    for (const it of parsed.items.slice(0, params.maxPosts)) {
      const url = it.link.trim();
      const norm = normalizeUrlForMatch(url);
      if (!norm) continue;
      const title = it.title.trim();

      const combined = `${title}\n${it.description ?? ""}\n${it.contentEncoded ?? ""}`.trim();
      const match = params.matchContext
        ? matchText({
            ticker: params.matchContext.ticker,
            companyName: params.matchContext.companyName,
            aliases: params.matchContext.aliases,
            text: combined,
          })
        : null;

      posts.push({
        id: stableId(["substack_post", pub.id, norm.toLowerCase()]),
        publicationId: pub.id,
        publicationName: pub.name ?? parsed.title ?? null,
        title,
        url,
        normalizedUrl: norm,
        publishedAt: parseDateIsoOrNull(it.pubDate ?? null),
        author: it.author ?? null,
        summary: it.description ?? null,
        contentSnippet: it.description ? it.description.slice(0, 280) : null,
        tickers: match?.tickers ?? [],
        companyMentions: match?.companies ?? [],
        matchedTerms: match?.matchedTerms ?? [],
        matchType: toPostMatchType(match),
        confidenceScore: match?.confidence ?? 0.4,
        source: "rss",
        discoveredAt: now,
      });
    }

    return { ok: true, posts, feedUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "RSS ingest failed" };
  }
}

