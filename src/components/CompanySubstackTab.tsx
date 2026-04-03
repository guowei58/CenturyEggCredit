"use client";

import { Card } from "@/components/ui";
import { SubstackFeed } from "@/components/substack/SubstackFeed";

export function CompanySubstackTab({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const safeTicker = (ticker ?? "").trim().toUpperCase();
  const displayName = (companyName?.trim() || safeTicker) || "";

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
    <Card title={`Substack Search — ${safeTicker}`}>
      <SubstackFeed ticker={safeTicker} companyName={displayName || undefined} />
    </Card>
  );
}

