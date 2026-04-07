"use client";

import { Card } from "@/components/ui";
import { HistoricalFinancialsAiWorkflow } from "@/components/HistoricalFinancialsAiWorkflow";
import { HistoricalFinancialsTemplatesPanel } from "@/components/HistoricalFinancialsTemplatesPanel";

export function CompanyFinancialsTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string | null;
}) {
  const safeTicker = ticker?.trim() ?? "";

  return (
    <div className="space-y-8">
      <Card title={safeTicker ? `Historical financial statements — ${safeTicker}` : "Historical financial statements"}>
        <HistoricalFinancialsTemplatesPanel />
        <div className="mt-10 space-y-4 border-t border-[var(--border2)] pt-8">
          <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
            The second option is to query LLMs in the hope that it will generate something you can use as a starting point. Here are the
            prompts you can use.
          </p>
          <HistoricalFinancialsAiWorkflow ticker={safeTicker} companyName={companyName} noOuterCard />
        </div>
      </Card>
    </div>
  );
}
