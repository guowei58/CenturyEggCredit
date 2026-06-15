"use client";

import { FeedLinkRow } from "@/components/company/FeedLinkRow";
import type { BrokerResearchResult } from "@/lib/brokerResearch/types";

export function BrokerResearchCard({ item }: { item: BrokerResearchResult }) {
  return (
    <FeedLinkRow
      title={item.title}
      url={item.url}
      ticker={item.ticker?.trim() || ""}
      source={item.brokerName}
      publishedAt={item.publishedAt}
    />
  );
}
