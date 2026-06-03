"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Card } from "@/components/ui";
import {
  SPARSE_PERIOD_MIN_LINE_FILL_RATIO_DISPLAY,
  PresentedWorkbookColumnMode,
  triggerBrowserDownloadPresentedStatementsWorkbook,
  visiblePeriodsAndRowsForStatement,
  type PresentedStatementForSave,
  type SecXbrlAsPresentedApiResponse,
} from "@/lib/sec-xbrl-as-presented-save-client";
import { SelfDiagnosticChecklistTable } from "@/components/SelfDiagnosticChecklistTable";
import type { SelfDiagnosticCheckResult } from "@/lib/sec-self-diagnostic-checklist";
import { hasBlockingXbrlExportFailures, type XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";
import { formatSecXAsPresentedCell } from "@/lib/sec-xbrl-as-presented-scale";
import { incomeStatementCellNumeric } from "@/lib/sec-xbrl-income-statement-numeric";
import type {
  EarningsPressReleasePayload,
  IxbrlExtractionDiagnostics,
  IxbrlEbitdaReconciliation,
} from "@/lib/sec-ixbrl-mdna-tables";
import type { NarrativeDiagFinding } from "@/lib/sec-ixbrl-narrative-self-diagnostics";

type NarrativeBatchDiagnosticsResponse =
  | {
      ok: true;
      ticker: string;
      checked: number;
      suspicious: number;
      minFilingYear?: number;
      maxFilingsRequested?: number;
      failures: AnalyzedNarrativeBatchFailure[];
    }
  | { ok: false; error?: string; ticker?: string };

/** Failures as returned by the narrative batch API (includes full findings for detail blocks). */
type AnalyzedNarrativeBatchFailure = {
  accessionNumber: string;
  filingDate: string;
  form: string;
  issues: string[];
  loadError?: string;
  mdnaOk: boolean;
  earningsOk: boolean;
  mdnaFindings: NarrativeDiagFinding[];
  earningsFindings: NarrativeDiagFinding[];
};

/** Calendar filing-date years included: current year minus this value through present (inclusive). */
const XBRL_AS_PRESENTED_DIAG_LOOKBACK_YEARS = 20;
/** Newest-first cap on 10-K/10-Q rows from SEC before year filter (~20y × 4 quarters ≈ 80). */
const XBRL_AS_PRESENTED_DIAG_MAX_FILINGS = 80;

type XbrlDiagnosticsResponse =
  | {
      ok: true;
      ticker: string;
      checked: number;
      suspicious: number;
      minFilingYear?: number;
      maxFilingsRequested?: number;
      failures: Array<{
        accessionNumber: string;
        filingDate: string;
        form: string;
        issues: string[];
        summaries: Array<{ id: string; periods: string[]; firstRows: string[] }>;
        validationFailures?: XbrlExportValidationIssue[];
        selfDiagnosticChecklist?: SelfDiagnosticCheckResult[];
        statementStructureDiagnostics?: XbrlExportValidationIssue[];
      }>;
    }
  | { ok: false; error?: string; ticker?: string };

type IxbrlMdnaJson =
  | {
      ok: true;
      cik?: string;
      mdnaHeadingFound: boolean;
      segmentHeadingFound: boolean;
      mdnaTableHit: boolean;
      mdnaSectionHtml?: string | null;
      mdnaSectionHtmlTruncated?: boolean;
      diagnostics?: IxbrlExtractionDiagnostics;
      ebitdaReconciliation?: IxbrlEbitdaReconciliation;
      earningsPressRelease?: EarningsPressReleasePayload;
      earningsSlideDeck?: EarningsPressReleasePayload;
      selected?: {
        primaryDocument?: string;
        form?: string;
        accessionNumber?: string;
        filingDate?: string;
        /** Period end on periodic reports when SEC provides `reportDate` (used to align earnings 8-K search). */
        reportDate?: string;
      };
      error?: undefined;
    }
  | { ok: false; error?: string; ebitdaReconciliation?: IxbrlEbitdaReconciliation };

type PresentedStatement = PresentedStatementForSave;
type ApiResponse = SecXbrlAsPresentedApiResponse;

function secFilingPrimaryDocUrl(
  cik: string | undefined,
  accessionNumber: string | undefined,
  primaryDocument: string | undefined
): string | null {
  const cikNum = (cik ?? "").replace(/\D/g, "");
  const acc = (accessionNumber ?? "").replace(/-/g, "");
  const doc = (primaryDocument ?? "").trim();
  if (!cikNum || !acc || !doc) return null;
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${encodeURIComponent(doc)}`;
}

/** Rollup / validation limbs: always USD millions. */
function fmt(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const millions = v / 1_000_000;
  const sign = millions < 0 ? "-" : "";
  const abs = Math.abs(millions);
  const s = abs.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  return `${sign}$${s}M`;
}

function ValidationReconciliationBlock({ issue }: { issue: XbrlExportValidationIssue }) {
  const rec = issue.reconciliation;
  if (!rec) return null;
  return (
    <div className="mt-2 rounded border text-[10px] leading-snug" style={{ borderColor: "var(--border2)" }}>
      <p className="border-b px-2 py-1.5 italic" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
        {rec.formula}
      </p>
      <div className="max-h-64 overflow-auto">
        <table className="w-full border-collapse font-mono text-[10px]">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "var(--border2)", color: "var(--muted)" }}>
              <th className="px-2 py-1 font-normal">Line</th>
              <th className="px-2 py-1 text-right font-normal">w</th>
              <th className="px-2 py-1 text-right font-normal">Amount</th>
              <th className="px-2 py-1 text-right font-normal">Gap / w×V</th>
            </tr>
          </thead>
          <tbody>
            {rec.lines.map((ln, i) => (
              <tr key={i} className="border-t" style={{ borderColor: "var(--border2)", color: "var(--text)" }}>
                <td className="px-2 py-1">{ln.label}</td>
                <td className="px-2 py-1 text-right">{ln.weight != null ? String(ln.weight) : "—"}</td>
                <td className="px-2 py-1 text-right">{fmt(ln.valueUsd)}</td>
                <td className="px-2 py-1 text-right">
                  {ln.contributionUsd != null ? fmt(ln.contributionUsd) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatementAsPresentedTable({ stmt }: { stmt: PresentedStatement }) {
  const isIncome = stmt.id === "primary-is";
  /** Sparse columns like workbooks omit near-empty periods; rows match workbook line list (facts in any filing period). */
  const { periods, rows } = visiblePeriodsAndRowsForStatement(stmt, {
    minLineFillRatio: SPARSE_PERIOD_MIN_LINE_FILL_RATIO_DISPLAY,
    incomeStatementUseInstanceRaw: isIncome,
    includeAllRowsWithFacts: true,
  });
  return (
    <Card title={stmt.title}>
      <div className="overflow-auto">
        <table className="min-w-[920px] w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2.5 text-left text-sm font-medium" style={{ color: "var(--muted2)" }}>
                Line
              </th>
              {periods.map((p) => {
                const head = (p.shortLabel?.trim() ? p.shortLabel : p.label) || p.label;
                return (
                  <th key={p.key} className="whitespace-nowrap px-3 py-2.5 text-right align-bottom text-sm" style={{ color: "var(--muted2)" }} title={p.label}>
                    <span className="inline-block max-w-[160px] whitespace-normal leading-snug">{head}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.concept}-${idx}`} className="border-t" style={{ borderColor: "var(--border2)" }}>
                <td
                  className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2.5"
                  style={{ color: "var(--text)", paddingLeft: `${10 + Math.min(10, r.depth) * 14}px` }}
                  title={r.concept}
                >
                  {r.label}
                </td>
                {periods.map((p) => {
                  const cell = isIncome ? incomeStatementCellNumeric(r, p.key) : r.values[p.key];
                  return (
                  <td key={p.key} className="whitespace-nowrap px-3 py-2.5 text-right text-base font-mono tabular-nums tracking-tight" style={{ color: "var(--text)" }}>
                    {formatSecXAsPresentedCell(r.concept, cell ?? null)}
                  </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        Most line items in <span className="font-medium">$ millions</span> (USD);{" "}
        <span className="font-medium">per-share</span> rows (EPS, etc.) use native dollars-per-share scale (not ÷1M).{" "}
        <span className="font-medium">Share-count</span> rows (e.g. weighted average shares outstanding) show{" "}
        <span className="font-medium">millions of shares</span> without a dollar sign.{" "}
        {isIncome ? (
          <>
            This <span className="font-medium">income statement</span> mirrors the SEC printed signage: presentation
            lines with <span className="font-medium">negated preferred labels</span> use flipped{" "}
            <span className="font-medium">SEC display</span> values on the printed face; other lines use instance{" "}
            <span className="font-medium">rawValues</span> when available so interest/nonoperating stay on one convention.
            API JSON includes both <span className="font-medium">values</span> and{" "}
            <span className="font-medium">rawValues</span>.
          </>
        ) : (
          <>
            Grid shows <span className="font-medium">SEC-style display</span> (instance fact, including inline sign,
            inverted only when the presentation arc uses a negated label role). API JSON includes{" "}
            <span className="font-medium">rawValues</span> before that flip; the Excel workbook matches this grid.
          </>
        )}{" "}
        Period columns where fewer than ~
        {Math.round(SPARSE_PERIOD_MIN_LINE_FILL_RATIO_DISPLAY * 100)}% of lines carry a numeric fact are hidden so one-off stubs
        do not widen the grid. Rows still include every XBRL tag that appears on the filing&apos;s income statement,
        balance sheet, and cash‑flow presentations (including lines keyed only on sparse XBRL periods; those cells render
        blank on excluded columns).{" "}
        Use the toolbar <span className="font-medium">Download workbook</span> button to export the XBRL workbook the app
        builds (Meta + Validation + primary statements)—choose either <span className="font-medium">all XBRL periods</span>{" "}
        (Historical bulk-save shape) or <span className="font-medium">sparse columns</span> aligned with these tables.&nbsp;
        Role: <span className="font-mono">{stmt.role}</span>
      </p>
    </Card>
  );
}

function narrativeFindingStyle(f: NarrativeDiagFinding): { color: string; mark: string } {
  if (f.severity === "warn") return { color: "var(--warn)", mark: "!" };
  if (f.severity === "info") return { color: "var(--muted2)", mark: "i" };
  return { color: "var(--muted)", mark: "✓" };
}

function NarrativeBatchDiagnosticCard({ result }: { result: Extract<NarrativeBatchDiagnosticsResponse, { ok: true }> }) {
  return (
    <Card title={`Self-check — MD&A &amp; earnings — ${result.ticker}`}>
      <p className="text-xs leading-snug" style={{ color: "var(--muted2)" }}>
        Checked {result.checked} filing{result.checked === 1 ? "" : "s"}
        {result.minFilingYear != null ? (
          <>
            {" "}
            (filing date year ≥ {result.minFilingYear}
            {result.maxFilingsRequested != null
              ? `; up to ${result.maxFilingsRequested} newest 10-K/10-Q from SEC before filter`
              : ""}
            )
          </>
        ) : null}
        . Flagged {result.suspicious}. Batch mode uses periodic filing HTML only; earnings linkage counts adjacent Form
        8-K filings in the same window as the tab (no Exhibit 99 fetch per period).
      </p>
      {result.failures.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
          No MD&amp;A or earnings-linkage warnings in this sweep.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {result.failures.map((failure) => (
            <div
              key={failure.accessionNumber}
              className="rounded border p-3"
              style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
            >
              <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                {failure.filingDate} · {failure.form} · {failure.accessionNumber}
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs" style={{ color: "var(--warn)" }}>
                {failure.issues.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
              {!failure.loadError && (failure.mdnaFindings.length > 0 || failure.earningsFindings.length > 0) ? (
                <details className="mt-2 text-[11px]" style={{ color: "var(--muted2)" }}>
                  <summary className="cursor-pointer font-medium" style={{ color: "var(--text)" }}>
                    All findings
                  </summary>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="mb-1 font-semibold" style={{ color: "var(--text)" }}>
                        MD&amp;A
                      </p>
                      <ul className="list-none space-y-1 leading-snug">
                        {failure.mdnaFindings.map((f) => {
                          const st = narrativeFindingStyle(f);
                          return (
                            <li key={f.id} className="flex gap-2">
                              <span className="font-mono text-[10px] opacity-80">[{st.mark}]</span>
                              <span style={{ color: st.color }}>{f.message}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 font-semibold" style={{ color: "var(--text)" }}>
                        Earnings
                      </p>
                      <ul className="list-none space-y-1 leading-snug">
                        {failure.earningsFindings.map((f) => {
                          const st = narrativeFindingStyle(f);
                          return (
                            <li key={f.id} className="flex gap-2">
                              <span className="font-mono text-[10px] opacity-80">[{st.mark}]</span>
                              <span style={{ color: st.color }}>{f.message}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </details>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function CompanySecXbrlFinancialsTab({ ticker }: { ticker: string }) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedAcc, setSelectedAcc] = useState<string>("");
  const [ixbrl, setIxbrl] = useState<IxbrlMdnaJson | null>(null);
  const [ixLoading, setIxLoading] = useState(false);
  const [ixErr, setIxErr] = useState<string | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagErr, setDiagErr] = useState<string | null>(null);
  const [diag, setDiag] = useState<Extract<XbrlDiagnosticsResponse, { ok: true }> | null>(null);
  const [narrativeBatchBusy, setNarrativeBatchBusy] = useState(false);
  const [narrativeBatchErr, setNarrativeBatchErr] = useState<string | null>(null);
  const [narrativeBatch, setNarrativeBatch] = useState<Extract<NarrativeBatchDiagnosticsResponse, { ok: true }> | null>(
    null
  );
  const lastAsPresentedTkRef = useRef<string>("");

  const [presentedWorkbookColumns, setPresentedWorkbookColumns] =
    useState<PresentedWorkbookColumnMode>("all_filing_periods");

  useEffect(() => {
    setNarrativeBatch(null);
    setNarrativeBatchErr(null);
  }, [tk]);

  useEffect(() => {
    if (!tk) return;
    const tkChanged = lastAsPresentedTkRef.current !== tk;
    lastAsPresentedTkRef.current = tk;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    if (tkChanged) {
      setData(null);
    } else {
      /** Keep the filing list while switching period; clear statements so stale grids are not shown. */
      setData((prev) =>
        prev && Array.isArray(prev.filings) && prev.filings.length > 0
          ? {
              ...prev,
              ok: false,
              statements: [],
              validation: undefined,
              calculationLinkbaseLoaded: false,
            }
          : prev
      );
    }
    void (async () => {
      try {
        const qs = selectedAcc ? `?acc=${encodeURIComponent(selectedAcc)}` : "";
        const res = await fetch(`/api/sec/xbrl/as-presented/${encodeURIComponent(tk)}${qs}`, { cache: "no-store" });
        const j = (await res.json()) as ApiResponse;
        const msg = (j.error ?? "").trim() || "Failed to load SEC XBRL financials";

        if (cancelled) return;

        if (res.ok && j.ok !== false) {
          setData(j);
          setErr(null);
          return;
        }

        setErr(msg);
        if (Array.isArray(j.filings) && j.filings.length > 0) {
          setData({
            ok: false,
            error: msg,
            ticker: j.ticker ?? tk,
            cik: j.cik,
            companyName: j.companyName,
            filings: j.filings,
            selected: j.selected,
            statements: j.statements ?? [],
            validation: j.validation,
            selfDiagnosticChecklist: j.selfDiagnosticChecklist,
            calculationLinkbaseLoaded: j.calculationLinkbaseLoaded,
          });
        } else if (tkChanged) {
          setData(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tk, selectedAcc]);

  useEffect(() => {
    if (!tk) return;
    let cancelled = false;
    setIxLoading(true);
    setIxErr(null);
    setIxbrl(null);
    void (async () => {
      try {
        const qs = selectedAcc ? `?acc=${encodeURIComponent(selectedAcc)}` : "";
        const res = await fetch(
          `/api/sec/xbrl/ixbrl-mdna-tables/${encodeURIComponent(tk)}${qs}`,
          { cache: "no-store" }
        );
        const j = (await res.json()) as IxbrlMdnaJson;
        if (cancelled) return;
        if (!res.ok || j.ok === false) {
          setIxErr(j.error ?? `Inline XBRL fetch failed (${res.status})`);
          setIxbrl(null);
          return;
        }
        setIxbrl(j);
      } catch (e) {
        if (!cancelled) setIxErr(e instanceof Error ? e.message : "Inline XBRL fetch failed");
      } finally {
        if (!cancelled) setIxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tk, selectedAcc]);

  const filings = data?.filings ?? [];
  const selected = data?.selected?.accessionNumber ?? "";
  const statements = data?.statements ?? [];
  const validation = data?.validation;
  const selfDiagnosticChecklist = data?.selfDiagnosticChecklist;
  const blockingValidation =
    Boolean(data?.ok !== false && !loading && !err && validation && hasBlockingXbrlExportFailures(validation));

  useEffect(() => {
    if (!data?.selected?.accessionNumber) return;
    setSelectedAcc(data.selected.accessionNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.selected?.accessionNumber]);

  if (!tk) {
    return (
      <Card title="SEC XBRL Financials">
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Select a company with a ticker.
        </p>
      </Card>
    );
  }

  const ixMdnaFilingUrl =
    ixbrl?.ok === true
      ? secFilingPrimaryDocUrl(ixbrl.cik, ixbrl.selected?.accessionNumber, ixbrl.selected?.primaryDocument)
      : null;

  /** When tables came from a nearby 8-K / Exhibit 99, or we suggest that URL after a failed scan (fallback if API omits embedded HTML). */
  const earningsReleaseSecUrl =
    ixbrl?.ok === true
      ? (() => {
          const embedded = ixbrl.earningsPressRelease?.source.primaryDocumentUrl?.trim();
          if (embedded) return embedded;
          const er = ixbrl.ebitdaReconciliation;
          if (!er) return null;
          const fromDetected = er.status === "tables" ? er.supplementalSource?.primaryDocumentUrl : null;
          const fromSuggestion = er.suggestedPressRelease?.primaryDocumentUrl ?? null;
          const urlRaw = (fromDetected ?? fromSuggestion)?.trim();
          return urlRaw && urlRaw.length > 0 ? urlRaw : null;
        })()
      : null;

  const earningsSlideDeckSecUrl =
    ixbrl?.ok === true ? ixbrl.earningsSlideDeck?.source.primaryDocumentUrl?.trim() ?? null : null;

  const earningsMainCardTitle =
    ixbrl?.ok === true && ixbrl.earningsPressRelease?.exhibitClass === "slide_deck"
      ? `Earnings slide deck — ${tk}`
      : `Earnings press release — ${tk}`;

  const selectedFiling =
    filings.find((f) => f.accessionNumber === (selectedAcc || selected)) ??
    filings.find((f) => f.accessionNumber === selected) ??
    filings[0];
  const xbrlPrimaryStatementsFilingUrl =
    data?.cik && selectedFiling
      ? secFilingPrimaryDocUrl(data.cik, selectedFiling.accessionNumber, selectedFiling.primaryDocument)
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b border-[var(--border)] px-5 py-1.5 sm:px-8"
        style={{
          background: "var(--card)",
          boxShadow: "0 4px 12px color-mix(in srgb, var(--card) 88%, transparent)",
        }}
      >
        <span
          className="shrink-0 whitespace-nowrap text-[10px] font-semibold uppercase"
          style={{ color: "var(--muted)" }}
        >
          SEC XBRL — {tk}
        </span>
        <select
          className="min-w-0 max-w-[min(420px,70vw)] shrink m-0 rounded border px-1.5 py-0.5 text-xs leading-tight"
          style={{ borderColor: "var(--border2)", background: "var(--card2)", color: "var(--text)" }}
          value={selectedAcc}
          onChange={(e) => setSelectedAcc(e.target.value)}
        >
          {filings.map((f) => (
            <option key={f.accessionNumber} value={f.accessionNumber}>
              {f.filingDate} · {f.form} · {f.accessionNumber}
            </option>
          ))}
        </select>
        {!loading &&
        data?.ok !== false &&
        statements.length > 0 &&
        selectedFiling?.accessionNumber ? (
          <>
            <span className="h-5 w-px shrink-0" style={{ background: "var(--border2)" }} aria-hidden />
            <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px]" style={{ color: "var(--muted2)" }}>
              <span>Workbook</span>
              <select
                className="m-0 max-w-[170px] rounded border px-1 py-0.5 font-mono text-[10px] leading-tight"
                style={{ borderColor: "var(--border2)", background: "var(--card2)", color: "var(--text)" }}
                value={presentedWorkbookColumns}
                onChange={(e) => setPresentedWorkbookColumns(e.target.value as PresentedWorkbookColumnMode)}
                title="XBRL workbook column layout"
              >
                <option value="all_filing_periods">All XBRL periods</option>
                <option value="match_sec_tab">Sparse (match tabs)</option>
              </select>
              <button
                type="button"
                className="m-0 rounded border px-2 py-0.5 text-[11px] font-semibold leading-tight disabled:opacity-50"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                disabled={loading || !statements.length || !selectedFiling}
                title="Downloads SEC‑XBRL‑financials workbook (Meta + Validation + IS/BS/CF). Works even when validation blocks saves."
                onClick={() => {
                  if (!selectedFiling || !statements.length) return;
                  triggerBrowserDownloadPresentedStatementsWorkbook({
                    ticker: tk,
                    companyName: data?.companyName,
                    cik: data?.cik,
                    filing: {
                      form: selectedFiling.form,
                      filingDate: selectedFiling.filingDate,
                      accessionNumber: selectedFiling.accessionNumber,
                    },
                    statements,
                    validation,
                    calculationLinkbaseLoaded: Boolean(data?.calculationLinkbaseLoaded),
                    columnMode: presentedWorkbookColumns,
                  });
                }}
              >
                Download
              </button>
            </label>
          </>
        ) : null}
        {loading ? (
          <span className="shrink-0 whitespace-nowrap text-xs" style={{ color: "var(--muted2)" }}>
            Loading…
          </span>
        ) : null}
        {err ? (
          <span
            className="min-w-0 max-w-[12rem] shrink truncate text-xs"
            style={{ color: "var(--warn)" }}
            title={err}
          >
            {err}
          </span>
        ) : null}
        {diagErr ? (
          <span
            className="min-w-0 max-w-[14rem] shrink truncate text-[10px]"
            style={{ color: "var(--warn)" }}
            title={diagErr}
          >
            {diagErr}
          </span>
        ) : null}
        {narrativeBatchErr ? (
          <span
            className="min-w-0 max-w-[14rem] shrink truncate text-[10px]"
            style={{ color: "var(--warn)" }}
            title={narrativeBatchErr}
          >
            {narrativeBatchErr}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 flex-nowrap items-center gap-1">
          <button
            type="button"
            className="shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-semibold leading-tight disabled:opacity-50"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card2)" }}
            disabled={loading || narrativeBatchBusy || diagBusy || !tk}
            title="Run MD&A bounds/HTML and adjacent 8-K earnings linkage for each 10-K/10-Q (same filing window as Run self-diagnostic)"
            onClick={() => {
              setNarrativeBatchBusy(true);
              setNarrativeBatchErr(null);
              void (async () => {
                try {
                  const minYear = new Date().getFullYear() - XBRL_AS_PRESENTED_DIAG_LOOKBACK_YEARS;
                  const res = await fetch(
                    `/api/sec/xbrl/as-presented/${encodeURIComponent(tk)}/narrative-diagnostics?max=${XBRL_AS_PRESENTED_DIAG_MAX_FILINGS}&sinceYear=${minYear}`,
                    { cache: "no-store" }
                  );
                  const j = (await res.json()) as NarrativeBatchDiagnosticsResponse;
                  if (!res.ok || j.ok === false) {
                    throw new Error(("error" in j ? j.error : undefined) || "Failed to run MD&A / earnings check");
                  }
                  setNarrativeBatch(j);
                } catch (e) {
                  setNarrativeBatchErr(e instanceof Error ? e.message : "Failed to run MD&A / earnings check");
                } finally {
                  setNarrativeBatchBusy(false);
                }
              })();
            }}
          >
            {narrativeBatchBusy ? "Checking…" : "MD&amp;A / earnings check"}
          </button>
          <button
            type="button"
            className="shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-semibold leading-tight disabled:opacity-50"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card2)" }}
            disabled={loading || diagBusy || !tk}
            onClick={() => {
              setDiagBusy(true);
              setDiagErr(null);
              void (async () => {
                try {
                  const minYear = new Date().getFullYear() - XBRL_AS_PRESENTED_DIAG_LOOKBACK_YEARS;
                  const res = await fetch(
                    `/api/sec/xbrl/as-presented/${encodeURIComponent(tk)}/diagnostics?max=${XBRL_AS_PRESENTED_DIAG_MAX_FILINGS}&sinceYear=${minYear}`,
                    {
                      cache: "no-store",
                    }
                  );
                  const j = (await res.json()) as XbrlDiagnosticsResponse;
                  if (!res.ok || j.ok === false) {
                    throw new Error(("error" in j ? j.error : undefined) || "Failed to run diagnostics");
                  }
                  setDiag(j);
                } catch (e) {
                  setDiagErr(e instanceof Error ? e.message : "Failed to run diagnostics");
                } finally {
                  setDiagBusy(false);
                }
              })();
            }}
          >
            {diagBusy ? "Running…" : "Run self-diagnostic"}
          </button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto space-y-4 px-5 pb-4 sm:px-8 sm:pb-5">
      {diag ? (
        <Card title={`Self-Diagnostic — ${diag.ticker}`}>
          <p className="text-xs leading-snug" style={{ color: "var(--muted2)" }}>
            Checked {diag.checked} filing{diag.checked === 1 ? "" : "s"}
            {diag.minFilingYear != null ? (
              <>
                {" "}
                (filing date year ≥ {diag.minFilingYear}
                {diag.maxFilingsRequested != null ? `; up to ${diag.maxFilingsRequested} newest 10-K/10-Q from SEC before filter` : ""}
                )
              </>
            ) : null}
            . Flagged {diag.suspicious}.
          </p>
          {diag.failures.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
              No suspicious filings found in this sweep.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {diag.failures.map((failure) => (
                <div
                  key={failure.accessionNumber}
                  className="rounded border p-3"
                  style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
                >
                  <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                    {failure.filingDate} · {failure.form} · {failure.accessionNumber}
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs" style={{ color: "var(--warn)" }}>
                    {failure.issues.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                  {failure.selfDiagnosticChecklist && failure.selfDiagnosticChecklist.length > 0 ? (
                    <SelfDiagnosticChecklistTable checklist={failure.selfDiagnosticChecklist} compact />
                  ) : null}
                  {failure.validationFailures && failure.validationFailures.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-[10px] font-semibold uppercase" style={{ color: "var(--muted2)" }}>
                        Reconciliation detail
                      </p>
                      {failure.validationFailures.map((v, vi) => (
                        <details
                          key={`${v.check}-${v.periodKey}-vf-${vi}`}
                          className="rounded border text-[11px]"
                          style={{ borderColor: "var(--border2)" }}
                          open={vi === 0}
                        >
                          <summary className="cursor-pointer px-2 py-1.5 font-medium" style={{ color: "var(--text)" }}>
                            {v.periodLabel} · {v.statement} · {v.check}
                          </summary>
                          <div className="border-t px-2 py-1.5" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
                            {v.detail}
                            <ValidationReconciliationBlock issue={v} />
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : null}
                  {failure.statementStructureDiagnostics && failure.statementStructureDiagnostics.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-[10px] font-semibold uppercase" style={{ color: "var(--muted2)" }}>
                        Balance sheet / cash flow math (structure diagnostics)
                      </p>
                      <p className="text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
                        Shown when this filing triggered balance-sheet or cash-flow <span className="italic">shape</span>{" "}
                        warnings, or when totals were not already listed under rollup failures above. Values use the same
                        primary statement tags as formal checks.
                      </p>
                      {failure.statementStructureDiagnostics.map((v, vi) => (
                        <details
                          key={`${v.check}-${v.periodKey}-sd-${vi}`}
                          className="rounded border text-[11px]"
                          style={{ borderColor: "var(--border2)" }}
                          open={false}
                        >
                          <summary className="cursor-pointer px-2 py-1.5 font-medium" style={{ color: "var(--text)" }}>
                            {v.periodLabel} · {v.statement} · {v.check}
                            {v.severity === "warn" ? (
                              <span className="ml-2 text-[9px] font-normal opacity-80">(diagnostic)</span>
                            ) : null}
                          </summary>
                          <div className="border-t px-2 py-1.5" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
                            {v.detail}
                            <ValidationReconciliationBlock issue={v} />
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : null}
                  {failure.summaries.map((summary) => (
                    <div key={summary.id} className="mt-2 text-[11px] leading-snug" style={{ color: "var(--muted2)" }}>
                      <span className="font-semibold" style={{ color: "var(--text)" }}>
                        {summary.id}
                      </span>
                      : periods {summary.periods.join(" | ")}; first rows {summary.firstRows.join(" | ")}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {narrativeBatch ? <NarrativeBatchDiagnosticCard result={narrativeBatch} /> : null}

      {!loading && !err && statements.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm" style={{ color: "var(--muted2)" }}>
              Primary statements (income statement, balance sheet, cash flow)
              {blockingValidation ? (
                <span className="text-[var(--warn)]"> — review against failed tie-outs below</span>
              ) : null}
            </p>
            {xbrlPrimaryStatementsFilingUrl ? (
              <a
                href={xbrlPrimaryStatementsFilingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm font-medium text-[var(--accent)] underline underline-offset-2"
              >
                Open SEC filing
              </a>
            ) : null}
          </div>
          {statements.map((s) => (
            <StatementAsPresentedTable key={s.id} stmt={s} />
          ))}
        </div>
      ) : null}

      {!loading && !err && selfDiagnosticChecklist && selfDiagnosticChecklist.length > 0 ? (
        <Card title="Self-diagnostic — 15 tie-out checks">
          <p className="text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
            Each row is one of the canonical rollup / bridge checks.{" "}
            <span className="font-medium" style={{ color: "var(--text)" }}>Not run</span> means required lines,
            presentation depth, or <span className="font-mono">_cal.xml</span> were missing for that check on this filing.
          </p>
          <SelfDiagnosticChecklistTable checklist={selfDiagnosticChecklist} />
        </Card>
      ) : null}

      {!loading && !err && blockingValidation && validation?.length ? (
        <Card title="Statement validation — fix before using these numbers">
          <p className="text-sm leading-relaxed" style={{ color: "var(--warn)" }}>
            Failing <strong className="text-[var(--text)]">tie-out checks</strong> are listed below. The three primary
            statements above stay visible so you can compare line items to the reconciliation math. Warnings alone do not
            block saves. Open the SEC filing to confirm presentation; some extensions omit standard subtotals.
          </p>
          <ul className="mt-3 list-inside list-disc space-y-2 text-xs" style={{ color: "var(--text)" }}>
            {validation
              .filter((v) => v.severity === "fail")
              .map((v, i) => (
                <li key={`${v.check}-${v.periodKey}-${i}`}>
                  <span className="font-semibold">{v.periodLabel}</span> · {v.statement.replace(/_/g, " ")} ·{" "}
                  {v.check}: {v.detail}
                  <ValidationReconciliationBlock issue={v} />
                </li>
              ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
            Saving to <span className="font-medium">Saved Documents</span> is disabled while failures exist. Income-statement
            checks use <span className="font-medium">instance raw</span> when present (same numbers as the IS tab); balance
            sheet and cash flow use SEC display. Revenue / expense / section rollups use the calculation linkbase when{" "}
            <span className="font-mono">_cal.xml</span> is available (raw instance facts for those checks).
          </p>
        </Card>
      ) : null}

      {!loading && !err && statements.length === 0 ? (
        <Card title="No as-presented statements found">
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            SEC didn’t return usable as-presented statement linkbases for this filing. Try a different filing.
          </p>
        </Card>
      ) : null}

      <Card title={earningsMainCardTitle}>
        {ixLoading ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            Resolving the earnings press release (Form 8-K, usually Exhibit 99) aligned with the selected filing…
          </p>
        ) : ixErr ? (
          <p className="mt-3 text-sm" style={{ color: "var(--warn)" }}>
            {ixErr}
          </p>
        ) : ixbrl?.ok === true ? (
          <div className="mt-3 space-y-3 rounded border border-[var(--border)] bg-[var(--card)]/40 p-4">
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
              {earningsReleaseSecUrl ? (
                <a
                  href={earningsReleaseSecUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-medium text-[var(--accent)] underline underline-offset-2"
                >
                  Open on SEC.gov
                </a>
              ) : null}
            </div>
            {ixbrl.earningsPressRelease ? (
              <div className="space-y-2">
                <p
                  className="break-words rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[11px] leading-relaxed [overflow-wrap:anywhere]"
                  style={{ color: "var(--text)" }}
                >
                  <span className="font-medium text-[var(--text)]">Source:</span>{" "}
                  <span className="font-mono text-[10px]">{ixbrl.earningsPressRelease.source.form}</span> ·{" "}
                  {ixbrl.earningsPressRelease.source.filingDate}
                  {ixbrl.earningsPressRelease.source.documentRole === "exhibit_99"
                    ? " · Exhibit 99 HTML"
                    : " · 8-K primary HTML"}
                  {ixbrl.earningsPressRelease.exhibitClass === "slide_deck" ? " · investor presentation" : ""}
                  {" · "}
                  <span className="font-mono text-[10px]">{ixbrl.earningsPressRelease.source.primaryDocument}</span>
                </p>
                {ixbrl.earningsPressRelease.truncated ? (
                  <p className="text-[11px] leading-relaxed" style={{ color: "var(--warn)" }}>
                    Showing the first portion of this document only (size cap). Use &quot;Open on SEC.gov&quot; for the
                    full filing.
                  </p>
                ) : null}
                <div
                  className="max-h-[min(70vh,1400px)] min-h-[120px] w-full max-w-full min-w-0 overflow-auto rounded border border-[var(--border)] bg-[var(--panel)]"
                  style={{ contain: "inline-size" }}
                >
                  <div
                    className={`saved-html-content sec-debt-footnote-html ixbrl-earnings-press-release-root w-full max-w-full min-w-0 p-3 text-[12px] text-[var(--text)]${ixbrl.earningsPressRelease.exhibitClass === "slide_deck" ? " ixbrl-earnings-slide-deck-root" : ""}`}
                    // eslint-disable-next-line react/no-danger -- sanitized with DOMPurify; server stripped script/style
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(ixbrl.earningsPressRelease.html, { USE_PROFILES: { html: true } }),
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[12px] leading-relaxed" style={{ color: "var(--muted2)" }}>
                  No Form 8-K press release could be resolved for this periodic filing (no nearby earnings 8-K in our
                  ranked window, or EDGAR did not return the HTML). Change the filing above or open the periodic report
                  on SEC.gov.
                </p>
                {(() => {
                  const e = ixbrl.ebitdaReconciliation;
                  if (!e?.nearby8KScan || e.nearby8KScan.candidatesTried <= 0) return null;
                  return (
                    <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                      We ranked up to {e.nearby8KScan.candidatesTried} adjacent Form 8-K candidate(s) (by period end /
                      filing date); none yielded embedded earnings exhibit HTML in this response.
                    </p>
                  );
                })()}
                {ixbrl.ebitdaReconciliation?.suggestedPressRelease ? (
                  <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
                    <span className="font-medium" style={{ color: "var(--text)" }}>
                      Suggested document:
                    </span>{" "}
                    <a
                      href={ixbrl.ebitdaReconciliation.suggestedPressRelease.primaryDocumentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent)] underline underline-offset-2"
                    >
                      {ixbrl.ebitdaReconciliation.suggestedPressRelease.form} ·{" "}
                      {ixbrl.ebitdaReconciliation.suggestedPressRelease.filingDate}
                    </a>
                    {" · "}
                    <span className="font-mono text-[10px]">
                      {ixbrl.ebitdaReconciliation.suggestedPressRelease.primaryDocument}
                    </span>
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            No filing data.
          </p>
        )}
      </Card>

      {ixbrl?.ok === true && ixbrl.earningsSlideDeck ? (
        <Card title={`Investor slide deck — ${tk}`}>
          <div className="mt-3 space-y-3 rounded border border-[var(--border)] bg-[var(--card)]/40 p-4">
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
              {earningsSlideDeckSecUrl ? (
                <a
                  href={earningsSlideDeckSecUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-medium text-[var(--accent)] underline underline-offset-2"
                >
                  Open on SEC.gov
                </a>
              ) : null}
            </div>
            <div className="space-y-2">
              <p
                className="break-words rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[11px] leading-relaxed [overflow-wrap:anywhere]"
                style={{ color: "var(--text)" }}
              >
                <span className="font-medium text-[var(--text)]">Source:</span>{" "}
                <span className="font-mono text-[10px]">{ixbrl.earningsSlideDeck.source.form}</span> ·{" "}
                {ixbrl.earningsSlideDeck.source.filingDate}
                {ixbrl.earningsSlideDeck.source.documentRole === "exhibit_99"
                  ? " · Exhibit 99 HTML · investor presentation"
                  : " · 8-K primary HTML"}
                {" · "}
                <span className="font-mono text-[10px]">{ixbrl.earningsSlideDeck.source.primaryDocument}</span>
              </p>
              {ixbrl.earningsSlideDeck.truncated ? (
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--warn)" }}>
                  Showing the first portion of this document only (size cap). Use &quot;Open on SEC.gov&quot; for the full
                  filing.
                </p>
              ) : null}
              <div
                className="max-h-[min(70vh,1400px)] min-h-[120px] w-full max-w-full min-w-0 overflow-auto rounded border border-[var(--border)] bg-[var(--panel)]"
                style={{ contain: "inline-size" }}
              >
                <div
                  className="saved-html-content sec-debt-footnote-html ixbrl-earnings-press-release-root ixbrl-earnings-slide-deck-root w-full max-w-full min-w-0 p-3 text-[12px] text-[var(--text)]"
                  // eslint-disable-next-line react/no-danger -- sanitized with DOMPurify; server stripped script/style
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(ixbrl.earningsSlideDeck.html, { USE_PROFILES: { html: true } }),
                  }}
                />
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <Card title={`MD&A (filing HTML) — ${tk}`}>
        {ixLoading ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            Loading filing HTML…
          </p>
        ) : ixErr ? (
          <p className="mt-3 text-sm" style={{ color: "var(--warn)" }}>
            {ixErr}
          </p>
        ) : ixbrl?.ok ? (
          <div className="mt-3 space-y-3 rounded border border-[var(--border)] bg-[var(--card)]/40 p-4">
            <div className="flex flex-wrap items-center justify-end gap-3">
              {ixMdnaFilingUrl ? (
                <a
                  href={ixMdnaFilingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-[var(--accent)] underline underline-offset-2"
                >
                  Open SEC filing
                </a>
              ) : null}
            </div>
            {ixbrl.diagnostics ? (
              <details className="rounded border border-[var(--border)] bg-[var(--panel)]">
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-[var(--text)]">
                  Extraction diagnostics
                </summary>
                <div className="space-y-2 border-t border-[var(--border)] px-3 py-2 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  <div>
                    MD&amp;A: conf {ixbrl.diagnostics.mdna.confidence ?? "—"} · range{" "}
                    {ixbrl.diagnostics.mdna.startOffset ?? "—"}–{ixbrl.diagnostics.mdna.endOffset ?? "—"} · used{" "}
                    {ixbrl.diagnostics.mdna.rangeUsedForExtraction ? "yes" : "no"}
                  </div>
                  <div>
                    Notes: {ixbrl.diagnostics.notes.found ? "found" : "missing"} · segment score{" "}
                    {ixbrl.diagnostics.segmentNote.score ?? "—"} ({ixbrl.diagnostics.segmentNote.confidence ?? "—"}) · heading{" "}
                    {(ixbrl.diagnostics.segmentNote.heading ?? "").slice(0, 120)}
                    {(ixbrl.diagnostics.segmentNote.heading ?? "").length > 120 ? "…" : ""}
                  </div>
                  <div>
                    Tables: doc {ixbrl.diagnostics.tables.totalInDocument} · in MD&amp;A slice {ixbrl.diagnostics.tables.taggedInMdnaRange}{" "}
                    · in segment slice {ixbrl.diagnostics.tables.taggedInSegmentRange} · included {ixbrl.diagnostics.tables.included} ·
                    rejected {ixbrl.diagnostics.tables.rejected}
                  </div>
                  {Object.keys(ixbrl.diagnostics.rejectionReasons).length > 0 ? (
                    <div>
                      Rejections:{" "}
                      {Object.entries(ixbrl.diagnostics.rejectionReasons)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ")}
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
            {ixbrl.mdnaSectionHtml && ixbrl.mdnaSectionHtml.length > 0 ? (
              <>
                {ixbrl.mdnaSectionHtmlTruncated ? (
                  <p className="rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-[11px] leading-snug text-[var(--text)]">
                    <span className="font-medium text-amber-200/95">Truncated</span>
                    <span className="text-[var(--muted)]">
                      {" "}
                      — excerpt shortened for size; open the SEC filing for the full MD&amp;A.
                    </span>
                  </p>
                ) : null}
                <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--panel)]">
                  <div
                    className="saved-html-content sec-debt-footnote-html min-w-0 max-h-[min(70vh,920px)] overflow-y-auto p-3 text-[12px] text-[var(--text)]"
                    // eslint-disable-next-line react/no-danger -- sanitized with DOMPurify
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(ixbrl.mdnaSectionHtml, { USE_PROFILES: { html: true } }),
                    }}
                  />
                </div>
                <p className="text-[11px] leading-snug text-[var(--muted)]">
                  Full Item 7 / Item 2 HTML from the selected filing (narrative and tables). Inline{" "}
                  <span className="font-mono">ix:nonFraction</span> values are shown as{" "}
                  <span className="font-medium text-[var(--text)]">$ millions</span> (USD).
                </p>
              </>
            ) : ixbrl.mdnaHeadingFound && ixbrl.diagnostics?.mdna.rangeUsedForExtraction === false ? (
              <p className="rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[11px] leading-snug text-[var(--muted)]">
                MD&amp;A headings were found but bounds were too uncertain to extract a full HTML slice. For 10-Qs, uncertain
                boundaries are on by default; try another filing or inspect diagnostics.
              </p>
            ) : (
              <pre className="max-h-[min(55vh,560px)] overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--panel)] p-3 font-mono text-[11px] text-[var(--text)]">
                No MD&amp;A HTML extracted for this filing — check headings in diagnostics or choose another period.
              </pre>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            No data.
          </p>
        )}
      </Card>
    </div>
    </div>
  );
}

