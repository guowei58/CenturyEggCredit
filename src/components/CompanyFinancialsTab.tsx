"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { HistoricalFinancialsAiWorkflow } from "@/components/HistoricalFinancialsAiWorkflow";
import { HistoricalFinancialsTemplatesPanel } from "@/components/HistoricalFinancialsTemplatesPanel";
import { SecXbrlBulkFilingsAiPanel } from "@/components/SecXbrlBulkFilingsAiPanel";
import { CompanyXbrlCompilerTab } from "@/components/CompanyXbrlCompilerTab";

export function CompanyFinancialsTab({
  ticker,
  companyName,
  scrollToBadSection,
}: {
  ticker: string;
  companyName?: string | null;
  /** When true (e.g. legacy tab id), scroll to The Bad / deterministic compiler. */
  scrollToBadSection?: boolean;
}) {
  const safeTicker = ticker?.trim() ?? "";
  /** Bumps after SEC XBRL bulk save so the deterministic compiler reloads Saved Documents without a full page refresh. */
  const [savedDocumentsRev, setSavedDocumentsRev] = useState(0);

  useEffect(() => {
    setSavedDocumentsRev(0);
  }, [safeTicker]);

  useEffect(() => {
    if (!scrollToBadSection) return;
    document.getElementById("the-bad")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToBadSection]);

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#22c55e" }}>
          The Good
        </h2>
        <div className="max-w-3xl space-y-3 text-base leading-relaxed" style={{ color: "var(--text)" }}>
          <p>
            The good is when we spread the financial statements by hand ourselves. I promise that you will see the soul of the management team
            by doing this. Clint Eastwood once said &quot;In this world, there&apos;s two kinds of people, my friend: those with a hand-spread
            financial model and those who have no idea what they&apos;re talking about.&quot; Don&apos;t waste your MD&apos;s time with
            just numbers.  You need to provide context and understanding.
          </p>
        </div>
        <Card title="Financial model templates">
          <HistoricalFinancialsTemplatesPanel />
        </Card>
      </section>

      <section id="the-bad" className="space-y-4 border-t border-[var(--border2)] pt-10">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#eab308" }}>
          The Bad
        </h2>
        <div className="max-w-3xl space-y-3 text-base leading-relaxed" style={{ color: "var(--text)" }}>
          <p>
            The bad is when we use Python to combine the XBRL files into a usable spreadsheet. This deterministic method gets us 95% of the
            way there. But the 5% plays hide and seek in your financial model. It&apos;s not the end of the world, but it might require you to
            make sure everything ties out. Remember - Adam &amp; Eve trusted a python and paid the ultimate price. And because of that, you and I
            have to work for a living. SMH very hard right now.
          </p>
          <p>
            Save the filing workbooks as <span className="font-mono">.xlsx</span> with bulk save below before you run the deterministic
            compiler—the compiler uses those saved files.
          </p>
        </div>
        <SecXbrlBulkFilingsAiPanel
          ticker={safeTicker}
          showAiConsolidation={false}
          onAfterBulkSave={() => setSavedDocumentsRev((n) => n + 1)}
        />
        <CompanyXbrlCompilerTab ticker={safeTicker} savedDocumentsRev={savedDocumentsRev} />
      </section>

      <section className="space-y-4 border-t border-[var(--border2)] pt-10">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#f97316" }}>
          The Ugly
        </h2>
        <div className="max-w-3xl space-y-3 text-base leading-relaxed" style={{ color: "var(--text)" }}>
          <p>
            The ugly is when we ask AI (instead of Python) to consolidate XBRL data into a consolidated financials report. It turns out that AI
            is less trustworthy than the snake. The results are very inconsistent. Quality varies a lot by model and how they feel at the time
            of the request. AI-generated model is like a box of chocolate - you never know what you gonna get. Well, do you feel lucky punk?!
          </p>
        </div>
        <SecXbrlBulkFilingsAiPanel ticker={safeTicker} showBulkSave={false} showProviderPublicLimits={false} />
      </section>

      <section className="space-y-4 border-t border-[var(--border2)] pt-10">
        <h2
          className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl"
          style={{ color: "#dc2626" }}
        >
          <span>The Dumpster Fire</span>
          <img
            src="/images/dumpster-fire.png"
            alt=""
            className="h-10 w-auto object-contain sm:h-11 md:h-12"
            width={140}
            height={140}
            aria-hidden
          />
        </h2>
        <div className="max-w-3xl space-y-3 text-base leading-relaxed" style={{ color: "var(--text)" }}>
          <p>
            The dumpster fire is when we ask AI to give us a historical consolidated financial report without any prior ingestion of the data.
            Claude does a much better job at this now than six months ago. But it&apos;s still a dumpster fire.
          </p>
        </div>
        <HistoricalFinancialsAiWorkflow ticker={safeTicker} companyName={companyName} noOuterCard />
      </section>
    </div>
  );
}
