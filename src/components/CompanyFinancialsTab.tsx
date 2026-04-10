"use client";

import { Card } from "@/components/ui";
import { HistoricalFinancialsAiWorkflow } from "@/components/HistoricalFinancialsAiWorkflow";
import { HistoricalFinancialsTemplatesPanel } from "@/components/HistoricalFinancialsTemplatesPanel";
import { SecXbrlBulkFilingsAiPanel } from "@/components/SecXbrlBulkFilingsAiPanel";

export function CompanyFinancialsTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string | null;
}) {
  const safeTicker = ticker?.trim() ?? "";

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#22c55e" }}>
          The Good
        </h2>
        <div className="max-w-3xl space-y-3 text-base leading-relaxed sm:text-lg" style={{ color: "var(--text)" }}>
          <p>
            The good is when we spread the financial statements by hand ourselves. I promise that you will see the soul of the management team
            by doing this. Clint Eastwood once said &quot;In this world, there&apos;s two kinds of people, my friend: those with a hand-spread
            financial model and those who have no idea what they&apos;re talking about.&quot;
          </p>
        </div>
        <Card title="Financial model templates">
          <HistoricalFinancialsTemplatesPanel />
        </Card>
      </section>

      <section className="space-y-4 border-t border-[var(--border2)] pt-10">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#eab308" }}>
          The Bad
        </h2>
        <div className="max-w-3xl space-y-3 text-base leading-relaxed" style={{ color: "var(--text)" }}>
          <p>
            The bad is when we ask AI to consolidate XBRL files into a consolidated financials report. Do you feel lucky punk?! Honestly the
            results are not bad, and gets us 90% of the way there, but the 10% is really bad. We just don&apos;t know where this 10% is in our
            financial model.
          </p>
          <p>
            This is a two-step process. First you press the &quot;Save .XLSX&quot; button to save all the XBRL financial files into your
            folder. Then you use your favorite AI to create a consolidated financial statement. The file will be prepared in 1–2 minutes and
            available for download.
          </p>
        </div>
        <SecXbrlBulkFilingsAiPanel ticker={safeTicker} />
      </section>

      <section className="space-y-4 border-t border-[var(--border2)] pt-10">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#dc2626" }}>
          The Ugly
        </h2>
        <div className="max-w-3xl space-y-3 text-base leading-relaxed" style={{ color: "var(--text)" }}>
          <p>
            The ugly is when we ask AI to give us a historical consolidated financial report <span className="font-medium">without any prior
            ingestion of the data</span>. Claude does a much better job at this now than six months ago. It&apos;s my hope that AI will continue to
            improve on this.
          </p>
        </div>
        <HistoricalFinancialsAiWorkflow ticker={safeTicker} companyName={companyName} noOuterCard />
      </section>
    </div>
  );
}
