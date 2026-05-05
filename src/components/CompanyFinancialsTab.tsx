"use client";

import { useEffect, useState } from "react";
import { SecXbrlBulkFilingsAiPanel } from "@/components/SecXbrlBulkFilingsAiPanel";
import { CompanyXbrlCompilerTab } from "@/components/CompanyXbrlCompilerTab";

const STEP_CIRCLE =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums";

export function CompanyFinancialsTab({
  ticker,
  scrollToBadSection,
}: {
  ticker: string;
  /** When true (e.g. legacy tab id), scroll to the compile (step 2) section. */
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
    document.getElementById("historical-financials-step2")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToBadSection]);

  return (
    <div className="space-y-8">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl" style={{ color: "var(--text)" }}>
          Historical Financial Statements
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
          Work in two steps: save each filing as an Excel workbook, then compile those files into consolidated statements.
        </p>
      </header>

      {/* Step 1 */}
      <section
        id="historical-financials-step1"
        className="rounded-xl border p-4 sm:p-6"
        style={{ borderColor: "var(--border2)", background: "var(--card)" }}
      >
        <div className="mb-5 flex gap-4">
          <span className={STEP_CIRCLE} style={{ background: "var(--accent)", color: "#fff" }}>
            1
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--text)" }}>
              Save bulk filing workbooks
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
              Pull SEC as-presented numbers for each 10-K and 10-Q and store them under{" "}
              <strong style={{ color: "var(--text)" }}>Saved Documents</strong> as{" "}
              <span className="font-mono text-xs">.xlsx</span> files. Run bulk save before compiling—you need those files in
              step 2.
            </p>
          </div>
        </div>
        <SecXbrlBulkFilingsAiPanel
          ticker={safeTicker}
          showAiConsolidation={false}
          onAfterBulkSave={() => setSavedDocumentsRev((n) => n + 1)}
        />
      </section>

      {/* Connector */}
      <div className="flex justify-center sm:justify-start sm:pl-12">
        <div className="h-8 w-px sm:h-10" style={{ background: "var(--border2)" }} aria-hidden />
      </div>

      {/* Step 2 */}
      <section
        id="historical-financials-step2"
        className="rounded-xl border p-4 sm:p-6"
        style={{ borderColor: "var(--border2)", background: "var(--card)" }}
      >
        <div className="mb-5 flex gap-4">
          <span className={STEP_CIRCLE} style={{ background: "var(--accent)", color: "#fff" }}>
            2
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--text)" }}>
              Compile into financials
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
              Merge the saved SEC-XBRL workbooks into quarterly and annual income statement, balance sheet, and cash flow
              views. Select files, run the compiler, then review or download Excel from the Statements tab.
            </p>
          </div>
        </div>
        <CompanyXbrlCompilerTab
          ticker={safeTicker}
          savedDocumentsRev={savedDocumentsRev}
          compilerTitle="Compiler — merge saved workbooks"
        />
      </section>
    </div>
  );
}
