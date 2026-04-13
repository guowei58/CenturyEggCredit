import { XMLParser } from "fast-xml-parser";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";

export type RssArticle = {
  title: string;
  link: string;
  pubDate: string;
  /** Item description / summary when present in the feed */
  description?: string;
};

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function pickText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v && typeof (v as { "#text": string })["#text"] === "string") {
    return (v as { "#text": string })["#text"];
  }
  return "";
}

/** Google News RSS often wraps the publisher URL on `<source url="...">`. */
function sourceHrefFromItem(row: Record<string, unknown>): string {
  const s = row.source;
  if (!s || typeof s !== "object") return "";
  const o = s as Record<string, unknown>;
  const u = o["@_url"] ?? o.url;
  return typeof u === "string" && /^https?:\/\//i.test(u) ? u.trim() : "";
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
    const rawLink = pickText(row.link);
    const link =
      fromSource && !/news\.google\./i.test(fromSource) && !/google\.com\/url\?/i.test(fromSource) ? fromSource : rawLink;
    const pubDate = pickText(row.pubDate) || pickText(row["dc:date"]) || new Date().toISOString();
    const description =
      pickText(row.description) ||
      pickText(row["content:encoded"]) ||
      pickText(row.summary) ||
      undefined;
    if (title && link) out.push({ title, link, pubDate, description });
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
export async function fetchGoogleNewsRssSearch(query: string, max = 15, when: string = "1d"): Promise<RssArticle[]> {
  const q = query.includes("when:") ? query : `${query} when:${when}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  return fetchRssFeed(url, max);
}

/**
 * Best-effort resolve Google News redirect URLs to a publisher URL (HTTP redirect chain).
 */
export async function resolvePublisherUrlFromGoogleNewsRss(link: string, timeoutMs = 10_000): Promise<string> {
  if (!/news\.google\./i.test(link) && !/google\.com\/url\?/i.test(link)) return link;
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

/** @deprecated Use fetchGoogleNewsRssSearch — kept for daily-news callers using last-24h window */
export async function fetchGoogleNewsSearch(query: string, max = 15): Promise<RssArticle[]> {
  return fetchGoogleNewsRssSearch(query, max, "1d");
}
