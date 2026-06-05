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
  /** Bumps after bulk save so the deterministic compiler reloads Saved Documents without a full page refresh. */
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
          Work in two steps: bulk-save each 10-K/10-Q (filing date 2019–present) using the same HTML face extraction as the{" "}
          <strong style={{ color: "var(--text)" }}>Period Financials</strong> tab, then compile those workbooks into quarterly and
          annual statements.
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
              For each 10-K and 10-Q (newest filing first, e.g. FY 2026 10-K before older quarters), extract primary
              statements from filed HTML tables (Period Financials methodology) and save under{" "}
              <strong style={{ color: "var(--text)" }}>Saved Documents</strong> as{" "}
              <span className="font-mono text-xs">.xlsx</span> files—not to your Downloads folder. Open Saved Documents to
              download individual files. Run bulk save before compiling.
            </p>
          </div>
        </div>
        <SecXbrlBulkFilingsAiPanel
          ticker={safeTicker}
          workbookSource="test-html-face"
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
              Merge the saved HTML-face workbooks into quarterly and annual income statement, balance sheet, and cash flow
              views. Open <strong style={{ color: "var(--text)" }}>Run compile</strong>, select workbooks, click compile,
              then open <strong style={{ color: "var(--text)" }}>View statements</strong> to review or download Excel.
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
