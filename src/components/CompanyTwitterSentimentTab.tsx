"use client";

import { Card } from "@/components/ui";
import { XSearchFeed } from "@/components/xSearch/XSearchFeed";

export function CompanyTwitterSentimentTab({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const safeTicker = ticker?.trim() ?? "";
  const displayName = (companyName?.trim() || safeTicker) || "";

  if (!safeTicker) {
    return (
      <Card title="Twitter Sentiment">
        <p className="py-4 text-sm" style={{ color: "var(--muted2)" }}>
          Select a company to search X/Twitter posts via the official API.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Twitter Sentiment — ${safeTicker}`}>
      <XSearchFeed ticker={safeTicker} companyName={displayName || undefined} />
    </Card>
  );
}

