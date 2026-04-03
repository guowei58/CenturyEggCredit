"use client";

import { Card } from "@/components/ui";
import { BrokerResearchFeed } from "@/components/brokerResearch/BrokerResearchFeed";

export function CompanyBrokerResearchTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string | null;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const displayName = (companyName?.trim() || safeTicker) || "";

  if (!safeTicker) {
    return (
      <Card title="Broker Research Reports">
        <p className="py-4 text-sm" style={{ color: "var(--muted2)" }}>
          Select a company to build a discoverable broker research index.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Broker Research Reports — ${safeTicker}`}>
      <BrokerResearchFeed ticker={safeTicker} companyName={displayName || undefined} />
    </Card>
  );
}
