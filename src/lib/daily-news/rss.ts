import { XMLParser } from "fast-xml-parser";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";

export type RssArticle = {
  title: string;
  link: string;
  pubDate: string;
  /** Item description / summary when present in the feed */
  description?: string;
  /** Google News RSS `<source url="...">` publisher homepage (outlet identity, not story URL). */
  sourceUrl?: string;
  /** Google News RSS `<source>` label, e.g. Reuters. */
  sourceName?: string;
};

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function pickText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v && typeof (v as { "#text": string })["#text"] === "string") {
    return (v as { "#text": string })["#text"];
  }
  return "";
}

/** Google News `<source url="...">` is often the outlet homepage, not the story. Prefer item `<link>`. */
function sourceMetaFromItem(row: Record<string, unknown>): { sourceUrl?: string; sourceName?: string } {
  const s = row.source;
  if (s == null) return {};
  if (typeof s === "string") {
    const sourceName = s.trim();
    return sourceName ? { sourceName } : {};
  }
  if (typeof s !== "object") return {};
  const o = s as Record<string, unknown>;
  const rawUrl = o["@_url"] ?? o.url;
  const sourceUrl = typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl) ? rawUrl.trim() : "";
  const sourceName = pickText(o).trim();
  return {
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceName ? { sourceName } : {}),
  };
}

function sourceHrefFromItem(row: Record<string, unknown>): string {
  return sourceMetaFromItem(row).sourceUrl ?? "";
}

function normalizeItems(channel: unknown): RssArticle[] {
  const ch = channel as Record<string, unknown> | undefined;
  const raw = ch?.item;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: RssArticle[] = [];
  for (const it of arr) {
    const row = it as Record<string, unknown>;
    const title = pickText(row.title);
    const fromSource = sourceHrefFromItem(row);
    const rawLink = pickText(row.link).trim();
    /** Per-article URL lives on `<link>` (often news.google.com → publisher). Do not use `<source url>` for href — it is regularly the site root. */
    const link = rawLink || fromSource;
    const pubDate = pickText(row.pubDate) || pickText(row["dc:date"]) || new Date().toISOString();
    const description =
      pickText(row.description) ||
      pickText(row["content:encoded"]) ||
      pickText(row.summary) ||
      undefined;
    const { sourceUrl, sourceName } = sourceMetaFromItem(row);
    if (title && link) {
      out.push({
        title,
        link,
        pubDate,
        description,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(sourceName ? { sourceName } : {}),
      });
    }
  }
  return out;
}

export async function fetchRssFeed(url: string, max = 25): Promise<RssArticle[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": getSecEdgarUserAgent() },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const text = await res.text();
  const doc = parser.parse(text) as Record<string, unknown>;
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel ?? doc.feed;
  const items = normalizeItems(channel);
  return items.slice(0, max);
}

/** Google News RSS search (public; rate-limit friendly). `when` e.g. `1d`, `7d`, `90d`. */
export async function fetchGoogleNewsRssSearch(
  query: string,
  max = 15,
  when: string = "1d",
  /** When true, follow Google News redirect URLs to the publisher story (daily digest links). */
  resolveArticleUrls = false
): Promise<RssArticle[]> {
  const q =
    query.includes("when:") || /\bafter:\d{4}-\d{2}-\d{2}\b/.test(query)
      ? query
      : `${query} when:${when}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const items = await fetchRssFeed(url, max);
  if (!resolveArticleUrls) return items;
  return Promise.all(
    items.map(async (a) => ({
      ...a,
      link: await resolvePublisherUrlFromGoogleNewsRss(a.link),
    }))
  );
}

export function isGoogleNewsUrl(url: string): boolean {
  return /news\.google\./i.test(url) || /google\.com\/url\?/i.test(url);
}

/**
 * Best-effort resolve Google News redirect URLs to a publisher URL (HTTP redirect chain).
 */
export async function resolvePublisherUrlFromGoogleNewsRss(link: string, timeoutMs = 10_000): Promise<string> {
  if (!isGoogleNewsUrl(link)) return link;
  try {
    const res = await fetch(link, {
      redirect: "follow",
      headers: { "User-Agent": getSecEdgarUserAgent() },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const u = res.url;
    if (u && !/^https?:\/\/(www\.)?news\.google\./i.test(u) && !/\/news\/google\//i.test(u)) return u;
  } catch {
    /* ignore */
  }
  return link;
}

/** Daily news batch: same RSS as `fetchGoogleNewsRssSearch`, plus resolve story URLs out of Google News redirects. */
export async function fetchGoogleNewsSearch(query: string, max = 15): Promise<RssArticle[]> {
  return fetchGoogleNewsRssSearch(query, max, "1d", true);
}
