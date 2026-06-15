"use client";

import { FeedLinkRow } from "@/components/company/FeedLinkRow";
import type { SubstackSearchResult } from "@/lib/substack/types";

export function SubstackResultCard({ item, ticker }: { item: SubstackSearchResult; ticker: string }) {
  const post = item.post;
  const pubName = item.publication?.name ?? post.publicationName ?? "Substack";

  return (
    <FeedLinkRow
      title={post.title}
      url={post.url}
      ticker={ticker}
      source={pubName}
      publishedAt={post.publishedAt}
    />
  );
}
