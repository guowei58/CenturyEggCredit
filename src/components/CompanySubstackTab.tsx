"use client";

import { Card } from "@/components/ui";
import { workspaceSearchCompanyName, workspaceSearchLabel } from "@/lib/company-workspace-key";
import { SubstackFeed } from "@/components/substack/SubstackFeed";

export function CompanySubstackTab({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const safeTicker = (ticker ?? "").trim().toUpperCase();
  const searchLabel = workspaceSearchLabel(safeTicker, companyName);
  const resolvedCompanyName = workspaceSearchCompanyName(safeTicker, companyName);

  if (!safeTicker) {
    return (
      <Card title="Substack Search">
        <p className="py-4 text-sm" style={{ color: "var(--muted2)" }}>
          Select a company to discover and index relevant public Substack posts.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Substack Search — ${searchLabel}`}>
      <SubstackFeed ticker={safeTicker} companyName={resolvedCompanyName} />
    </Card>
  );
}
