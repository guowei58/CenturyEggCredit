"use client";

import { FeedLinkRow } from "@/components/company/FeedLinkRow";
import type { NormalizedNewsArticle } from "@/lib/news/types";

export function NewsCard({ article, ticker }: { article: NormalizedNewsArticle; ticker: string }) {
  let source = article.sourceName?.trim() || "";
  if (!source && article.sourceDomain?.trim()) {
    source = article.sourceDomain.trim();
  } else if (!source) {
    try {
      source = new URL(article.url).hostname.replace(/^www\./, "");
    } catch {
      source = "";
    }
  }

  return (
    <FeedLinkRow
      title={article.title}
      url={article.url}
      ticker={ticker}
      source={source}
      publishedAt={article.publishedAt}
    />
  );
}
