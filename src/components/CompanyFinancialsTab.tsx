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

const STEP_BUTTON =
  "rounded-md border px-3 py-1.5 text-lg font-semibold tracking-tight transition disabled:cursor-not-allowed disabled:opacity-50";

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
      <div
        id="historical-financials-step1"
        className="flex flex-wrap items-center gap-x-6 gap-y-3"
      >
        <div className="flex items-center gap-3">
          <span className={STEP_CIRCLE} style={{ background: "var(--accent)", color: "#fff" }}>
            1
          </span>
          <button
            type="button"
            className={STEP_BUTTON}
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

        <div id="historical-financials-step2" className="flex items-center gap-3">
          <span className={STEP_CIRCLE} style={{ background: "var(--accent)", color: "#fff" }}>
            2
          </span>
          <button
            type="button"
            className={STEP_BUTTON}
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

      <SecXbrlBulkFilingsAiPanel
        ref={bulkPanelRef}
        ticker={safeTicker}
        workbookSource="test-html-face"
        showAiConsolidation={false}
        showBulkSaveButton={false}
        showFilingsList={false}
        minFilingYear={FACE_BULK_MIN_FILING_YEAR}
        onBulkSaveUiChange={onBulkSaveUiChange}
        onAfterBulkSave={() => setSavedDocumentsRev((n) => n + 1)}
      />

      <CompanyXbrlCompilerTab
        ref={compilerRef}
        ticker={safeTicker}
        savedDocumentsRev={savedDocumentsRev}
        onCompileUiChange={onCompileUiChange}
      />
    </div>
  );
}
