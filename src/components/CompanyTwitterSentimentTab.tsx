"use client";

import { Card } from "@/components/ui";
import { workspaceSearchCompanyName, workspaceSearchLabel } from "@/lib/company-workspace-key";
import { XSearchFeed } from "@/components/xSearch/XSearchFeed";

export function CompanyTwitterSentimentTab({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const safeTicker = ticker?.trim().toUpperCase() ?? "";
  const searchLabel = workspaceSearchLabel(safeTicker, companyName);
  const resolvedCompanyName = workspaceSearchCompanyName(safeTicker, companyName);

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
    <Card title={`Twitter Sentiment — ${searchLabel}`}>
      <XSearchFeed ticker={safeTicker} companyName={resolvedCompanyName} searchLabel={searchLabel} />
    </Card>
  );
}
