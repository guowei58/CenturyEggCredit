"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SecXbrlBulkFilingsAiPanel,
  type BulkSaveUiState,
  type SecXbrlBulkFilingsAiPanelHandle,
} from "@/components/SecXbrlBulkFilingsAiPanel";
import { FACE_BULK_MIN_FILING_YEAR } from "@/lib/sec-xbrl-as-presented-save-client";
import {
  CompanyXbrlCompilerTab,
  type CompileUiState,
  type CompanyXbrlCompilerTabHandle,
} from "@/components/CompanyXbrlCompilerTab";

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
  const bulkPanelRef = useRef<SecXbrlBulkFilingsAiPanelHandle>(null);
  const compilerRef = useRef<CompanyXbrlCompilerTabHandle>(null);
  const [bulkSaveUi, setBulkSaveUi] = useState<BulkSaveUiState>({ canSave: false, saving: false });
  const [compileUi, setCompileUi] = useState<CompileUiState>({ canCompile: false, compiling: false });

  const onBulkSaveUiChange = useCallback((state: BulkSaveUiState) => {
    setBulkSaveUi(state);
  }, []);

  const onCompileUiChange = useCallback((state: CompileUiState) => {
    setCompileUi(state);
  }, []);

  useEffect(() => {
    setSavedDocumentsRev(0);
  }, [safeTicker]);

  useEffect(() => {
    if (!scrollToBadSection) return;
    document.getElementById("historical-financials-step2")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToBadSection]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl" style={{ color: "var(--text)" }}>
          Historical Financial Statements
        </h1>
      </header>

      <div className="space-y-2">
      {/* Step 1 */}
      <section
        id="historical-financials-step1"
        className="rounded-xl border p-4 sm:p-6"
        style={{ borderColor: "var(--border2)", background: "var(--card)" }}
      >
        <div className="mb-4 flex gap-4">
          <span className={STEP_CIRCLE} style={{ background: "var(--accent)", color: "#fff" }}>
            1
          </span>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-lg font-semibold tracking-tight transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: "var(--accent)",
                color: "var(--accent)",
                background: "transparent",
              }}
              disabled={!bulkSaveUi.canSave || bulkSaveUi.saving}
              title={
                bulkSaveUi.saving
                  ? "Saving workbooks to Saved Documents…"
                  : bulkSaveUi.canSave
                    ? "Save all filing workbooks since 2019 to Saved Documents"
                    : "Sign in and wait for filings to load"
              }
              onClick={() => bulkPanelRef.current?.startBulkSave()}
            >
              {bulkSaveUi.saving ? "Saving…" : "Save bulk filing workbooks"}
            </button>
          </div>
        </div>
        <SecXbrlBulkFilingsAiPanel
          ref={bulkPanelRef}
          ticker={safeTicker}
          workbookSource="test-html-face"
          showAiConsolidation={false}
          showBulkSaveButton={false}
          minFilingYear={FACE_BULK_MIN_FILING_YEAR}
          onBulkSaveUiChange={onBulkSaveUiChange}
          onAfterBulkSave={() => setSavedDocumentsRev((n) => n + 1)}
        />
      </section>

      {/* Connector */}
      <div className="flex justify-center sm:justify-start sm:pl-[1.125rem]">
        <div className="h-3 w-px" style={{ background: "var(--border2)" }} aria-hidden />
      </div>

      {/* Step 2 */}
      <section
        id="historical-financials-step2"
        className="rounded-xl border p-4 sm:p-6"
        style={{ borderColor: "var(--border2)", background: "var(--card)" }}
      >
        <div className="mb-4 flex gap-4">
          <span className={STEP_CIRCLE} style={{ background: "var(--accent)", color: "#fff" }}>
            2
          </span>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-lg font-semibold tracking-tight transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: "var(--accent)",
                color: "var(--accent)",
                background: "transparent",
              }}
              disabled={!compileUi.canCompile || compileUi.compiling}
              title={
                compileUi.compiling
                  ? "Compiling statements…"
                  : compileUi.canCompile
                    ? "Compile saved workbooks into historical financial statements"
                    : "Complete step 1 and wait for workbooks to load"
              }
              onClick={() => compilerRef.current?.startCompile()}
            >
              {compileUi.compiling ? "Compiling…" : "Compile into financials"}
            </button>
          </div>
        </div>
        <CompanyXbrlCompilerTab
          ref={compilerRef}
          ticker={safeTicker}
          savedDocumentsRev={savedDocumentsRev}
          onCompileUiChange={onCompileUiChange}
        />
      </section>
      </div>
    </div>
  );
}
