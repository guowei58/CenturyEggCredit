"use client";

import { FeedLinkRow } from "@/components/company/FeedLinkRow";
import type { ResearchResult } from "@/lib/researchFinder/types";

const PROVIDER_LABELS: Record<string, string> = {
  octus: "Octus",
  creditsights: "CreditSights",
  "9fin": "9fin",
  debtwire: "Debtwire",
  wsj_bankruptcy: "WSJ Pro Bankruptcy",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
}

export function ResearchFinderResultCard({ item, ticker }: { item: ResearchResult; ticker: string }) {
  return (
    <FeedLinkRow
      title={item.title ?? item.url}
      url={item.url}
      ticker={ticker}
      source={providerLabel(item.provider)}
      publishedAt={item.publication_date}
    />
  );
}
