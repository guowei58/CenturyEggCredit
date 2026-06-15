"use client";

import { Card } from "@/components/ui";
import { BrokerActivitiesFeed } from "@/components/brokerActivities/BrokerActivitiesFeed";

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
      <Card title="Broker Activities">
        <p className="py-4 text-sm" style={{ color: "var(--muted2)" }}>
          Select a company to view public sell-side broker activity metadata.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Broker Activities — ${safeTicker}`}>
      <BrokerActivitiesFeed ticker={safeTicker} companyName={displayName || undefined} />
    </Card>
  );
}
