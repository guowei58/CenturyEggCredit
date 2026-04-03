import { XMLParser } from "fast-xml-parser";

export type RssItem = {
  title: string;
  link: string;
  pubDate?: string;
  author?: string;
  guid?: string;
  description?: string;
  contentEncoded?: string;
};

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

export function parseRss(xml: string): { title?: string; link?: string; items: RssItem[] } {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
  });

  const data = parser.parse(xml) as unknown;
  const d = data as Record<string, any>;
  const channel = d?.rss?.channel ?? d?.feed ?? null;
  const itemsRaw = toArray(channel?.item ?? channel?.entry);

  const items: RssItem[] = [];
  for (const it of itemsRaw) {
    const title = (it?.title?.["#text"] ?? it?.title ?? "").toString().trim();
    const link =
      (it?.link?.["@_href"] ??
        it?.link?.href ??
        it?.link ??
        it?.id ??
        "").toString().trim();
    if (!title || !link) continue;

    items.push({
      title,
      link,
      pubDate: (it?.pubDate ?? it?.published ?? it?.updated ?? "").toString().trim() || undefined,
      author:
        (it?.author?.name ?? it?.author ?? it?.creator ?? "").toString().trim() || undefined,
      guid: (it?.guid ?? it?.id ?? "").toString().trim() || undefined,
      description: (it?.description ?? it?.summary ?? "").toString().trim() || undefined,
      contentEncoded: (it?.encoded ?? it?.content ?? "").toString().trim() || undefined,
    });
  }

  const title = (channel?.title?.["#text"] ?? channel?.title ?? "").toString().trim() || undefined;
  const link = (channel?.link?.["@_href"] ?? channel?.link ?? "").toString().trim() || undefined;
  return { title, link, items };
}

