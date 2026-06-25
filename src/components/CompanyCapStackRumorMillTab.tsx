"use client";

import { Card } from "@/components/ui";
import { workspaceSearchCompanyName, workspaceSearchLabel } from "@/lib/company-workspace-key";
import { ResearchFinderFeed } from "@/components/researchFinder/ResearchFinderFeed";

export function CompanyCapStackRumorMillTab({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const safeTicker = (ticker ?? "").trim().toUpperCase();
  const searchLabel = workspaceSearchLabel(safeTicker, companyName);
  const resolvedCompanyName = workspaceSearchCompanyName(safeTicker, companyName);

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
    <Card title={`The Cap Stack Rumor Mill — ${searchLabel}`}>
      <ResearchFinderFeed ticker={safeTicker} companyName={resolvedCompanyName} />
    </Card>
  );
}
