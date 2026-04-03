"use client";

import { Card } from "@/components/ui";
import { RedditFeed } from "@/components/reddit/RedditFeed";

export function CompanyRedditTab({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const safeTicker = (ticker ?? "").trim().toUpperCase();
  const displayName = (companyName?.trim() || "") || "";

  if (!safeTicker && !displayName) {
    return (
      <Card title="Reddit Research">
        <p className="py-4 text-sm" style={{ color: "var(--muted2)" }}>
          Select a company (or enter a ticker / name below) to search Reddit for discussions.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Reddit Research — ${safeTicker || displayName || "?"}`}>
      <RedditFeed initialTicker={safeTicker} initialCompanyName={displayName || undefined} />
    </Card>
  );
}
