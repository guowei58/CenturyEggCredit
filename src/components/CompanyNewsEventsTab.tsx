"use client";

import { Card } from "@/components/ui";
import { NewsFeed } from "@/components/news/NewsFeed";

export function CompanyNewsEventsTab({
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
      <Card title="News & Events">
        <p className="py-4 text-sm" style={{ color: "var(--muted2)" }}>
          Select a company to load aggregated news from your configured providers.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`News & Events — ${safeTicker}`}>
      <NewsFeed ticker={safeTicker} companyName={displayName || undefined} />
    </Card>
  );
}
