"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Card } from "@/components/ui";
import type { AiProvider } from "@/lib/ai-provider";
import { AI_PROVIDER_CHIP_SELECTED } from "@/lib/ai-provider";
import { modelPayloadForRun, type ModelRunChoice } from "@/lib/ai-model-prefs-client";
import { presetsForProvider } from "@/lib/ai-model-options";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { fetchSavedTabContent } from "@/lib/saved-data-client";
import { downloadMarkdownConsolidationAsXlsx } from "@/lib/markdown-tables-to-xlsx";
import {
  normalizeAccessionKey,
  savePresentedStatementsXlsxToServer,
  type PresentedFiling,
  type SecXbrlAsPresentedApiResponse,
} from "@/lib/sec-xbrl-as-presented-save-client";

const XBRL_AI_SAVE_KEY = "xbrl-consolidated-financials-ai" as const;

const AI_CONSOLIDATE_LABELS: Record<AiProvider, string> = {
  claude: "Claude API",
  openai: "ChatGPT API",
  gemini: "Gemini API",
  deepseek: "DeepSeek API",
};

const AI_CONSOLIDATE_PROVIDERS: AiProvider[] = ["claude", "openai", "gemini", "deepseek"];

const DEFAULT_CONSOLIDATE_MODELS: Record<AiProvider, ModelRunChoice> = {
  claude: "__saved__",
  openai: "__saved__",
  gemini: "__saved__",
  deepseek: "__saved__",
};

/**
 * Bulk SEC-XBRL workbook save + optional AI consolidation.
 * On the Good/Bad/Ugly tab: bulk save is under The Bad; AI consolidation under The Ugly.
 */
export function SecXbrlBulkFilingsAiPanel({
  ticker,
  showBulkSave = true,
  showAiConsolidation = true,
  onAfterBulkSave,
}: {
  ticker: string;
  /** SEC XBRL bulk save list + button. Default true. */
  showBulkSave?: boolean;
  /** AI consolidation card (ingests saved workbooks). Default true. */
  showAiConsolidation?: boolean;
  /** Called when bulk save finishes (success or partial failure) so other UI can refresh Saved Documents lists. */
  onAfterBulkSave?: () => void;
}) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const { status: authStatus } = useSession();
  const { ready: prefsReady, preferences } = useUserPreferences();
  const [consolidateModelChoice, setConsolidateModelChoice] =
    useState<Record<AiProvider, ModelRunChoice>>(DEFAULT_CONSOLIDATE_MODELS);
  const lastModelHydrateTickerRef = useRef<string | null>(null);
  const [listData, setListData] = useState<SecXbrlAsPresentedApiResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const tabAliveRef = useRef(true);
  const [consolidatedMd, setConsolidatedMd] = useState<string>("");
  const [aiBusy, setAiBusy] = useState<AiProvider | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [aiOkMsg, setAiOkMsg] = useState<string | null>(null);
  const [consolidatedExcelErr, setConsolidatedExcelErr] = useState<string | null>(null);

  const loadConsolidated = useCallback(async () => {
    if (authStatus !== "authenticated" || !tk) {
      setConsolidatedMd("");
      return;
    }
    const c = await fetchSavedTabContent(tk, XBRL_AI_SAVE_KEY);
    setConsolidatedMd(c);
  }, [authStatus, tk]);

  useEffect(() => {
    if (!showAiConsolidation) {
      setConsolidatedMd("");
      return;
    }
    void loadConsolidated();
  }, [loadConsolidated, showAiConsolidation]);

  useEffect(() => {
    tabAliveRef.current = true;
    return () => {
      tabAliveRef.current = false;
    };
  }, [tk]);

  /** Per ticker: if User Settings pick a listed preset, mirror it in the row select (still overridable). */
  useEffect(() => {
    if (!showAiConsolidation || !prefsReady || !tk) return;
    if (lastModelHydrateTickerRef.current === tk) return;
    lastModelHydrateTickerRef.current = tk;
    const models = preferences.aiModels as Partial<Record<AiProvider | "ollama", string>> | undefined;
    setConsolidateModelChoice((prev) => {
      const next = { ...prev };
      for (const p of AI_CONSOLIDATE_PROVIDERS) {
        const raw = p === "deepseek" ? models?.deepseek ?? models?.ollama : models?.[p];
        const id = typeof raw === "string" ? raw.trim() : "";
        if (id && presetsForProvider(p).some((opt) => opt.id === id)) {
          next[p] = id;
        }
      }
      return next;
    });
  }, [prefsReady, preferences.aiModels, tk, showAiConsolidation]);

  useEffect(() => {
    if (!showBulkSave || !tk) return;
    let cancelled = false;
    setListLoading(true);
    setListErr(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sec/xbrl/as-presented/${encodeURIComponent(tk)}`, { cache: "no-store" });
        const j = (await res.json()) as SecXbrlAsPresentedApiResponse;
        if (!res.ok) throw new Error(j.error || "Failed to load filings list");
        if (!cancelled) setListData(j);
      } catch (e) {
        if (!cancelled) setListErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tk, showBulkSave]);

  const filings: PresentedFiling[] = listData?.filings ?? [];
  const selectedAcc = listData?.selected?.accessionNumber ?? "";

  if (!tk) {
    return (
      <p className="text-sm" style={{ color: "var(--muted2)" }}>
        Select a company with a ticker.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {showBulkSave ? (
      <Card title={`SEC XBRL — bulk save (${tk})`}>
        <p className="text-xs" style={{ color: "var(--muted2)" }}>
          {listData?.companyName ? <span style={{ color: "var(--text)" }}>{listData.companyName}</span> : null}
          {listData?.cik ? <> · CIK {listData.cik}</> : null}
        </p>
        {listLoading ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            Loading filings…
          </p>
        ) : listErr ? (
          <p className="mt-3 text-sm" style={{ color: "var(--warn)" }}>
            {listErr}
          </p>
        ) : null}

        {!listLoading && !listErr && filings.length > 0 ? (
          <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border2)" }}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  All XBRL filings (10-K / 10-Q)
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted2)" }}>
                  {filings.length} filing{filings.length === 1 ? "" : "s"} in the last ~20 years. Each saved workbook matches
                  single-filing exports: Meta, display + raw sheets, Validation, very sparse period columns omitted (~5%
                  line fill), zero-only rows
                  omitted — same as &quot;Save as Excel&quot; on the SEC XBRL Financials tab.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                disabled={bulkSaving || authStatus !== "authenticated" || listLoading || Boolean(listErr)}
                title={
                  authStatus !== "authenticated"
                    ? "Sign in to save workbooks to Saved Documents."
                    : "Fetch each filing and save one .xlsx per accession. Re-running replaces the same file for each filing."
                }
                onClick={() => {
                  if (authStatus !== "authenticated" || bulkSaving || !tk) return;
                  setBulkMsg(null);
                  setBulkSaving(true);
                  setBulkProgress({ done: 0, total: filings.length, label: "" });
                  void (async () => {
                    let saved = 0;
                    let skipped = 0;
                    let failed = 0;
                    const failNotes: string[] = [];
                    const companyName = listData?.companyName;
                    const cik = listData?.cik;

                    try {
                      for (let i = 0; i < filings.length; i++) {
                        if (!tabAliveRef.current) break;
                        const f = filings[i]!;
                        setBulkProgress({
                          done: i,
                          total: filings.length,
                          label: `${f.filingDate} ${f.form}`,
                        });
                        try {
                          const res = await fetch(
                            `/api/sec/xbrl/as-presented/${encodeURIComponent(tk)}?acc=${encodeURIComponent(f.accessionNumber)}`,
                            { cache: "no-store" }
                          );
                          const j = (await res.json()) as SecXbrlAsPresentedApiResponse;
                          const stmts = j.statements ?? [];
                          if (!res.ok || j.ok === false) {
                            failed++;
                            failNotes.push(`${f.accessionNumber}: ${j.error ?? res.statusText}`);
                            continue;
                          }
                          if (!stmts.length) {
                            skipped++;
                            continue;
                          }
                          const r = await savePresentedStatementsXlsxToServer(
                            tk,
                            {
                              form: f.form,
                              filingDate: f.filingDate,
                              accessionNumber: f.accessionNumber,
                            },
                            companyName ?? j.companyName,
                            cik ?? j.cik,
                            stmts,
                            j.validation,
                            j.calculationLinkbaseLoaded
                          );
                          if (r.ok) saved++;
                          else {
                            failed++;
                            failNotes.push(`${f.accessionNumber}: ${r.error}`);
                          }
                        } catch (e) {
                          failed++;
                          failNotes.push(`${f.accessionNumber}: ${e instanceof Error ? e.message : "error"}`);
                        }
                      }

                      if (tabAliveRef.current) {
                        const tail = failNotes.length
                          ? ` Errors (first 5): ${failNotes.slice(0, 5).join(" · ")}${failNotes.length > 5 ? "…" : ""}`
                          : "";
                        setBulkMsg(
                          `Saved ${saved} workbook(s). Skipped ${skipped} (no as-presented statements). Failed ${failed}.${tail}`
                        );
                      }
                    } finally {
                      setBulkSaving(false);
                      setBulkProgress(null);
                      onAfterBulkSave?.();
                    }
                  })();
                }}
              >
                {bulkSaving ? "Saving…" : "Bulk Save SEC XBRL Data"}
              </button>
            </div>
            {bulkProgress && bulkSaving ? (
              <p className="mt-2 text-[10px] font-mono" style={{ color: "var(--muted2)" }}>
                {bulkProgress.done + 1}/{bulkProgress.total} · {bulkProgress.label}
              </p>
            ) : null}
            {bulkMsg ? (
              <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
                {bulkMsg}
              </p>
            ) : null}
            <div
              className="mt-2 max-h-56 overflow-y-auto rounded border text-xs"
              style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
            >
              <ul className="divide-y p-0" style={{ borderColor: "var(--border2)" }}>
                {filings.map((f) => {
                  const isSel = normalizeAccessionKey(f.accessionNumber) === normalizeAccessionKey(selectedAcc);
                  return (
                    <li
                      key={f.accessionNumber}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1.5"
                      style={{
                        background: isSel ? "var(--panel)" : undefined,
                        borderColor: "var(--border2)",
                      }}
                    >
                      <span className="shrink-0 font-mono text-[10px]" style={{ color: "var(--muted)" }}>
                        {f.filingDate}
                      </span>
                      <span className="shrink-0 font-semibold" style={{ color: "var(--text)" }}>
                        {f.form}
                      </span>
                      <span className="min-w-0 break-all font-mono text-[10px]" style={{ color: "var(--muted2)" }}>
                        {f.accessionNumber}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : !listLoading && !listErr ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            No filings returned for this ticker.
          </p>
        ) : null}
      </Card>
      ) : null}

      {showAiConsolidation ? (
      <Card title={`AI consolidation (all saved XBRL workbooks) — ${tk}`}>
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          Ingests every <span className="font-mono">SEC-XBRL-financials</span> <span className="font-mono">.xlsx</span> in{" "}
          <strong>Saved Documents</strong> for {tk} (all sheets as CSV text), then calls your selected model with a fixed
          consolidation spec: latest filing wins on overlaps, standalone quarters from YTD where needed (income / cash flow
          only), balance sheet point-in-time only, plus overlap/restatement and provenance sections. Each primary statement
          is one wide markdown table; period headers follow a <span className="font-medium">spreadsheet-style</span> timeline: optional leading{" "}
          <span className="font-medium">FY####</span> annual-only columns, then <span className="font-medium">1Q, 2Q, 3Q, 4Q, and FY</span> for{" "}
          <span className="font-medium">every</span> fiscal year in the quarterly range (use — when a cell has no source value). Output is saved as{" "}
          <span className="font-mono">xbrl-consolidated-financials-ai.md</span> (server-backed tab content). Large libraries
          are truncated near ~300k characters of ingested text — prefer running again after archiving very old exports if you
          hit limits.
        </p>
        <div className="mt-3">
          <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
            Run via API
          </span>
          <p className="mt-1 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
            Choose a model for each provider, then run. <span className="font-medium">Saved default</span> uses the model from User
            Settings (or server/env fallback).
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {AI_CONSOLIDATE_PROVIDERS.map((p) => {
              const sel = AI_PROVIDER_CHIP_SELECTED[p];
              const isPending = aiBusy === p;
              const inactive = aiBusy !== null && aiBusy !== p;
              return (
                <div
                  key={p}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-2"
                  style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
                >
                  <span
                    className="min-w-[108px] shrink-0 text-[11px] font-semibold tracking-wide"
                    style={{ color: sel.background }}
                  >
                    {AI_CONSOLIDATE_LABELS[p]}
                  </span>
                  <select
                    className="min-w-0 flex-1 rounded border px-2 py-1.5 text-[11px] sm:max-w-md"
                    style={{ borderColor: "var(--border2)", background: "var(--card)", color: "var(--text)" }}
                    disabled={inactive || authStatus !== "authenticated" || !prefsReady}
                    value={consolidateModelChoice[p]}
                    aria-label={`Model for ${AI_CONSOLIDATE_LABELS[p]}`}
                    onChange={(e) => {
                      const v = e.target.value as ModelRunChoice;
                      setConsolidateModelChoice((prev) => ({ ...prev, [p]: v }));
                    }}
                  >
                    <option value="__saved__">Saved default (User Settings)</option>
                    {presetsForProvider(p).map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={inactive || authStatus !== "authenticated" || !prefsReady}
                    className="tab-prompt-ai-action-btn shrink-0 px-3 py-1.5 text-[11px]"
                    style={{
                      borderColor: sel.background,
                      color: isPending ? "#fff" : sel.background,
                      background: isPending ? sel.background : "transparent",
                    }}
                    title={
                      authStatus !== "authenticated"
                        ? "Sign in to ingest saved workbooks and run the model."
                        : "Ingest all saved SEC-XBRL xlsx and run consolidation with the selected model"
                    }
                    onClick={() => {
                      if (authStatus !== "authenticated" || aiBusy || !prefsReady) return;
                      setAiErr(null);
                      setAiOkMsg(null);
                      setAiBusy(p);
                      const choice = consolidateModelChoice[p];
                      void (async () => {
                        try {
                          const res = await fetch(`/api/sec/xbrl/ai-consolidate/${encodeURIComponent(tk)}`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              provider: p,
                              maxTokens: 32768,
                              ...modelPayloadForRun(p, choice),
                            }),
                          });
                          const j = (await res.json().catch(() => ({}))) as {
                            ok?: boolean;
                            text?: string;
                            error?: string;
                            fileCount?: number;
                            truncated?: boolean;
                            outputTruncated?: boolean;
                            filenames?: string[];
                          };
                          if (!res.ok || j.ok !== true || typeof j.text !== "string") {
                            throw new Error(j.error || `Request failed (${res.status})`);
                          }
                          setConsolidatedMd(j.text);
                          const trunc = j.truncated ? " Ingest pack was truncated at size cap." : "";
                          const outTrunc = j.outputTruncated
                            ? " Model output hit max length — consolidated file is incomplete. Use Claude or fewer workbooks."
                            : "";
                          setAiOkMsg(
                            `Saved ${j.fileCount ?? "?"} workbook(s).${trunc}${outTrunc} Files: ${(j.filenames ?? []).slice(0, 5).join(", ")}${(j.filenames?.length ?? 0) > 5 ? "…" : ""}`
                          );
                        } catch (e) {
                          setAiErr(e instanceof Error ? e.message : "Request failed");
                        } finally {
                          setAiBusy(null);
                        }
                      })();
                    }}
                  >
                    {isPending ? "Running…" : "Run"}
                  </button>
                </div>
              );
            })}
          </div>
          {authStatus !== "authenticated" ? (
            <span className="mt-2 block text-[10px]" style={{ color: "var(--muted)" }}>
              Sign in required.
            </span>
          ) : null}
        </div>
        {aiErr ? (
          <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
            {aiErr}
          </p>
        ) : null}
        {aiOkMsg ? (
          <p className="mt-2 text-[10px]" style={{ color: "var(--muted2)" }}>
            {aiOkMsg}
          </p>
        ) : null}
        <div
          className="mt-4 rounded border px-4 py-3"
          style={{ borderColor: "var(--accent)", background: "var(--card2)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Consolidated financial model
          </p>
          {consolidatedMd.trim() ? (
            <p className="mt-2 text-sm font-medium leading-snug" style={{ color: "var(--text)" }}>
              Consolidation is complete. You can open or download the Excel file below.
            </p>
          ) : null}
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
            The consolidated tables export to one Excel file (one sheet per markdown table). The same output is saved on the server as{" "}
            <span className="font-mono">xbrl-consolidated-financials-ai.md</span> for this ticker.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!consolidatedMd.trim()}
              className="rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
              title="Export markdown tables to .xlsx"
              onClick={() => {
                setConsolidatedExcelErr(null);
                void (async () => {
                  try {
                    await downloadMarkdownConsolidationAsXlsx(tk, consolidatedMd);
                  } catch (e) {
                    setConsolidatedExcelErr(e instanceof Error ? e.message : "Excel export failed");
                  }
                })();
              }}
            >
              Download consolidated model (.xlsx)
            </button>
          </div>
          {!consolidatedMd.trim() ? (
            <p className="mt-2 text-xs" style={{ color: "var(--muted2)" }}>
              No file ready yet.{" "}
              {showBulkSave
                ? "Save SEC-XBRL workbooks above, run an API provider, then download here"
                : "Save SEC-XBRL workbooks with bulk save under The Bad, run an API provider below, then download here"}{" "}
              (usually ready within a couple of minutes after the run completes).
            </p>
          ) : null}
          {consolidatedExcelErr ? (
            <p className="mt-2 text-[11px]" style={{ color: "var(--danger)" }}>
              {consolidatedExcelErr}
            </p>
          ) : null}
        </div>
      </Card>
      ) : null}
    </div>
  );
}
