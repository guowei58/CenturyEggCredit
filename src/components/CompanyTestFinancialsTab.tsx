"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Card } from "@/components/ui";
import {
  triggerBrowserDownloadFacePresentedWorkbook,
  type FacePresentedStatementForSave,
  type SecIxbrlFacePresentedApiResponse,
} from "@/lib/sec-ixbrl-face-save-client";
import type { FaceStatementExtractionQa } from "@/lib/sec-ixbrl-face-extract";
import type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";
import { formatFaceStatementCell, type FaceStatementId } from "@/lib/sec-ixbrl-face-display";
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

type TestFaceDiagnosticsResponse =
  | {
      ok: true;
      ticker: string;
      checked: number;
      suspicious: number;
      minFilingYear?: number;
      maxFilingsRequested?: number;
      firstInlineXbrlQuarter: {
        filingDate: string;
        form: string;
        accessionNumber: string;
      } | null;
      failures: Array<{
        accessionNumber: string;
        filingDate: string;
        form: string;
        isInlineXbrl: boolean;
        issues: string[];
        summaries: Array<{ id: string; periods: string[]; firstRows: string[] }>;
        extractionQa?: FaceStatementExtractionQa[];
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

type PresentedStatement = FacePresentedStatementForSave;
type ApiResponse = SecIxbrlFacePresentedApiResponse;

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

function FaceExtractionQaBanner({ qa }: { qa: FaceStatementExtractionQa }) {
  return (
    <p className="text-[11px] leading-snug" style={{ color: "var(--muted2)" }}>
      {qa.rowCount} rows · {qa.taggedCells}/{qa.numericCells} cells tagged · {qa.untaggedNumericCells} untagged ·{" "}
      {qa.cellsWithSignMismatch} visible/raw sign mismatches · confidence {qa.confidenceScore}%
      {qa.numericCells > 0 && qa.taggedCells === 0
        ? " · No inline XBRL in this filing’s HTML (legacy table — concepts unavailable for consolidation)"
        : qa.numericCells > 0 && qa.taggedCells / qa.numericCells < 0.85
          ? " · Low ix coverage — check row/column alignment or filing format"
          : ""}
    </p>
  );
}

function StatementAsPresentedTable({
  stmt,
  qa,
}: {
  stmt: PresentedStatement;
  qa?: FaceStatementExtractionQa;
}) {
  const periods = stmt.periods;
  const rows = stmt.rows;
  return (
    <Card title={`${stmt.title}${stmt.units ? ` — ${stmt.units}` : ""}`}>
      {qa ? (
        <div className="mb-2 px-1">
          <FaceExtractionQaBanner qa={qa} />
        </div>
      ) : null}
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
                  title={`${r.concept}${r.cellIxByPeriod?.[periods[0]?.key ?? ""]?.xbrlConcept ? ` · ${r.cellIxByPeriod[periods[0]!.key]!.xbrlConcept}` : ""}`}
                >
                  {r.label}
                </td>
                {periods.map((p) => {
                  const visible = r.visibleTextByPeriod?.[p.key];
                  const meta = r.cellIxByPeriod?.[p.key];
                  return (
                  <td
                    key={p.key}
                    className="whitespace-nowrap px-3 py-2.5 text-right text-base font-mono tabular-nums tracking-tight"
                    style={{ color: "var(--text)" }}
                    title={meta?.xbrlConcept ? `${visible ?? ""} · ix:${meta.xbrlConcept} · raw:${r.rawValues[p.key] ?? "—"}` : visible ?? ""}
                  >
                    {formatFaceStatementCell(r, p.key, stmt.id as FaceStatementId)}
                  </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        <span className="font-medium">HTML face extraction</span> — monetary lines standardized to{" "}
        <span className="font-medium">$ millions</span> (sign from the filing). Hover for Inline XBRL concept / raw fact.{" "}
        <span className="font-medium">EPS</span> stays native $/share; <span className="font-medium">share counts</span> stay
        in millions of shares (no $). Workbook
        Workbook download uses the same <span className="font-mono">faceStatementCellNumeric</span> scale as this grid (Excel numbers, no M suffix). Source:{" "}
        {stmt.sourceHtmlFile ? (
          <span className="font-mono">{stmt.sourceHtmlFile}</span>
        ) : (
          <span className="font-mono">{stmt.role}</span>
        )}
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

export function CompanyTestFinancialsTab({ ticker }: { ticker: string }) {
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
  const [diag, setDiag] = useState<Extract<TestFaceDiagnosticsResponse, { ok: true }> | null>(null);
  const [narrativeBatchBusy, setNarrativeBatchBusy] = useState(false);
  const [narrativeBatchErr, setNarrativeBatchErr] = useState<string | null>(null);
  const [narrativeBatch, setNarrativeBatch] = useState<Extract<NarrativeBatchDiagnosticsResponse, { ok: true }> | null>(
    null
  );
  const lastAsPresentedTkRef = useRef<string>("");


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
        const params = new URLSearchParams();
        if (selectedAcc) params.set("acc", selectedAcc);
        if (!tkChanged && selectedAcc) params.set("skipSubmissions", "1");
        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/sec/xbrl/test-as-presented/${encodeURIComponent(tk)}${qs}`, { cache: "no-store" });
        const j = (await res.json()) as ApiResponse;
        const msg = (j.error ?? "").trim() || "Failed to load TEST HTML-face financials";

        if (cancelled) return;

        if (res.ok && j.ok !== false) {
          setData((prev) => ({
            ...j,
            filings:
              Array.isArray(j.filings) && j.filings.length > 0
                ? j.filings
                : (prev?.filings ?? []),
          }));
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
            extractionQa: j.extractionQa,
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
  const extractionQa = data?.extractionQa ?? [];
  const extractionQaById = new Map(extractionQa.map((q) => [q.statementId, q]));

  useEffect(() => {
    if (!data?.selected?.accessionNumber) return;
    setSelectedAcc(data.selected.accessionNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.selected?.accessionNumber]);

  if (!tk) {
    return (
      <Card title="TEST — HTML face financials">
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
          TEST (HTML face) — {tk}
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
            <button
              type="button"
              className="m-0 rounded border px-2 py-0.5 text-[11px] font-semibold leading-tight disabled:opacity-50"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
              disabled={loading || !statements.length || !selectedFiling}
              title="Download TEST HTML-face workbook (Meta + Validation + IS/BS/CF)"
              onClick={() => {
                if (!selectedFiling || !statements.length) return;
                triggerBrowserDownloadFacePresentedWorkbook({
                  ticker: tk,
                  companyName: data?.companyName,
                  cik: data?.cik,
                  filing: {
                    form: selectedFiling.form,
                    filingDate: selectedFiling.filingDate,
                    accessionNumber: selectedFiling.accessionNumber,
                    primaryDocument: selectedFiling.primaryDocument,
                  },
                  statements,
                  validation,
                  calculationLinkbaseLoaded: Boolean(data?.calculationLinkbaseLoaded),
                });
              }}
            >
              Download workbook
            </button>
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
            title="Sweep 10-K/10-Q filings: verify IS/BS/CF HTML-face extraction, inline XBRL tag coverage, and first iXBRL quarter"
            onClick={() => {
              setDiagBusy(true);
              setDiagErr(null);
              void (async () => {
                try {
                  const minYear = new Date().getFullYear() - XBRL_AS_PRESENTED_DIAG_LOOKBACK_YEARS;
                  const res = await fetch(
                    `/api/sec/xbrl/test-as-presented/${encodeURIComponent(tk)}/diagnostics?max=${XBRL_AS_PRESENTED_DIAG_MAX_FILINGS}&sinceYear=${minYear}`,
                    {
                      cache: "no-store",
                    }
                  );
                  const j = (await res.json()) as TestFaceDiagnosticsResponse;
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
      <Card title="TEST tab — HTML face extraction">
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
          Compare against <span className="font-medium" style={{ color: "var(--text)" }}>SEC XBRL Financials</span> on
          the adjacent tab. This path builds primary statements from the{" "}
          <span className="font-medium">filed HTML table</span> (visible labels, order, parentheses signs). Inline XBRL tags
          are attached per cell when present; <span className="font-mono">_cal.xml</span> is used for{" "}
          <span className="font-medium">validation warnings only</span> — it does not add rows or flip signs.
        </p>
      </Card>
      {diag ? (
        <Card title={`HTML-face self-diagnostic — ${diag.ticker}`}>
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
          <p className="mt-2 text-xs leading-snug" style={{ color: "var(--text)" }}>
            <span className="font-semibold">First inline XBRL quarter:</span>{" "}
            {diag.firstInlineXbrlQuarter ? (
              <>
                {diag.firstInlineXbrlQuarter.filingDate} · {diag.firstInlineXbrlQuarter.form} ·{" "}
                {diag.firstInlineXbrlQuarter.accessionNumber}
              </>
            ) : (
              <span style={{ color: "var(--muted2)" }}>none in this filing window</span>
            )}
          </p>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--muted2)" }}>
            Each filing must extract income statement, balance sheet, and cash flow from filed HTML and pass shape
            heuristics. Inline XBRL filings must tag every numeric cell on those statements.
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
                    {failure.isInlineXbrl ? (
                      <span className="ml-2 font-normal" style={{ color: "var(--muted2)" }}>
                        · inline XBRL
                      </span>
                    ) : null}
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs" style={{ color: "var(--warn)" }}>
                    {failure.issues.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                  {failure.extractionQa && failure.extractionQa.length > 0 ? (
                    <div className="mt-2 space-y-1 text-[11px]" style={{ color: "var(--muted2)" }}>
                      <p className="font-semibold uppercase tracking-wide" style={{ color: "var(--text)" }}>
                        Inline XBRL tag coverage
                      </p>
                      {failure.extractionQa.map((qa) => (
                        <p key={qa.statementId}>
                          <span className="font-medium" style={{ color: "var(--text)" }}>
                            {qa.statementId}
                          </span>
                          : {qa.taggedCells}/{qa.numericCells} tagged
                          {qa.untaggedNumericCells > 0 ? ` (${qa.untaggedNumericCells} untagged)` : ""}
                        </p>
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
              Primary statements from filed HTML (income statement, balance sheet, cash flow)
              {validation?.some((v) => v.severity === "fail") ? (
                <span className="text-[var(--warn)]"> — calc validation disagrees with face (warnings below)</span>
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
            <StatementAsPresentedTable key={s.id} stmt={s} qa={extractionQaById.get(s.id)} />
          ))}
        </div>
      ) : null}

      {!loading && !err && validation && validation.length > 0 ? (
        <Card title="Calculation linkbase validation (does not change the face grid)">
          <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
            These checks use <span className="font-mono">_cal.xml</span> against displayed face values / raw ix facts. They
            flag mismatches but do not modify rows or signs on the statements above.
          </p>
          <ul className="mt-3 list-inside list-disc space-y-2 text-xs" style={{ color: "var(--text)" }}>
            {validation.map((v, i) => (
              <li key={`${v.check}-${v.periodKey}-${i}`}>
                <span className="font-semibold">{v.periodLabel}</span> · {v.statement.replace(/_/g, " ")} · {v.severity} ·{" "}
                {v.check}: {v.detail}
                <ValidationReconciliationBlock issue={v} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {!loading && !err && statements.length === 0 ? (
        <Card title="No HTML-face statements found">
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            Could not locate primary statement tables in the filing HTML. Try a different filing or compare the SEC XBRL
            Financials tab.
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

