"use client";

import { FeedLinkRow } from "@/components/company/FeedLinkRow";
import type { NormalizedRatingsLink } from "@/lib/ratings-link-search/types";

export function RatingsResearchLinkCard({ item, ticker }: { item: NormalizedRatingsLink; ticker: string }) {
  return (
    <FeedLinkRow
      title={item.title}
      url={item.url}
      ticker={ticker}
      source={item.agency}
      publishedAt={item.publishedDate}
    />
  );
}
