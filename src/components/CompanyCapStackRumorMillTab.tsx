"use client";

import { Card } from "@/components/ui";
import { ResearchFinderFeed } from "@/components/researchFinder/ResearchFinderFeed";

export function CompanyCapStackRumorMillTab({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const safeTicker = (ticker ?? "").trim().toUpperCase();

  if (!safeTicker) {
    return (
      <Card title="The Cap Stack Rumor Mill">
        <p className="py-4 text-sm" style={{ color: "var(--muted2)" }}>
          Select a company to run best-effort public research discovery across Octus, CreditSights, 9fin, Debtwire, and WSJ Pro Bankruptcy.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`The Cap Stack Rumor Mill — ${safeTicker}`}>
      <ResearchFinderFeed ticker={safeTicker} companyName={companyName} />
    </Card>
  );
}

