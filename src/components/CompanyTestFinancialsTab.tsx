"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Card, TabBar } from "@/components/ui";
import {
  buildPeriodFinancialsFilingLabels,
  formatPeriodFinancialsFilingLabel,
  reportDateToRoicPeriod,
  roicTranscriptIndexUrl,
  roicTranscriptQuarterUrl,
} from "@/lib/period-financials-roic";
import { roicPeriodToPresentationPeriod } from "@/lib/presentations/discovery/period";
import {
  saveFacePresentedStatementsXlsxToServer,
  type FacePresentedStatementForSave,
  type SecIxbrlFacePresentedApiResponse,
} from "@/lib/sec-ixbrl-face-save-client";
import { saveRemoteUrlForTicker } from "@/lib/save-remote-url-client";
import type { FaceStatementExtractionQa } from "@/lib/sec-ixbrl-face-extract";
import type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";
import {
  faceStatementRowEmphasis,
  formatFaceStatementCell,
  type FaceStatementId,
} from "@/lib/sec-ixbrl-face-display";
import type {
  EarningsPressReleasePayload,
  IxbrlExtractionDiagnostics,
  IxbrlEbitdaReconciliation,
} from "@/lib/sec-ixbrl-mdna-tables";
import type { NarrativeDiagFinding } from "@/lib/sec-ixbrl-narrative-self-diagnostics";
import { ManagementPresentationDiscoveryPanel } from "@/components/ManagementPresentationDiscoveryPanel";

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

/** Set true to show the MD&A/Earnings Check batch button in the toolbar. */
const SHOW_MDNA_EARNINGS_CHECK_BUTTON = false;

/** Set true to show the HTML-face self-diagnostic button in the toolbar. */
const SHOW_SELF_DIAGNOSTIC_BUTTON = false;

/** Set true to show the MD&A extraction diagnostics panel on the MD&A tab. */
const SHOW_MDNA_EXTRACTION_DIAGNOSTICS = false;

/** Set true to show _cal.xml validation warnings on the Financials tab. */
const SHOW_CALC_LINKBASE_VALIDATION = false;

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

type TestSubTabId =
  | "financials"
  | "press-release"
  | "management-presentation"
  | "earnings-transcript"
  | "mdna";

const TEST_SUB_TABS: readonly { id: TestSubTabId; label: string }[] = [
  { id: "financials", label: "Financials" },
  { id: "press-release", label: "Press release (8-K)" },
  { id: "management-presentation", label: "Management Presentation" },
  { id: "earnings-transcript", label: "Earnings Transcript" },
  { id: "mdna", label: "MD&A" },
];

type TabSavePhase = "idle" | "saving" | "ok" | "err";

function PeriodFinancialsTabChipButton({
  label,
  onClick,
  disabled,
  title,
  phase = "idle",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  phase?: TabSavePhase;
}) {
  const text = phase === "saving" ? "…" : phase === "ok" ? "✓" : label;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || phase === "saving"}
      title={title}
      className="tab-bar-inline-btn"
      style={{
        borderColor: phase === "ok" ? "var(--accent)" : "var(--border2)",
        color:
          phase === "err" ? "var(--danger)" : phase === "ok" ? "var(--accent)" : "var(--muted2)",
        background: phase === "ok" ? "rgba(0, 212, 170, 0.08)" : "transparent",
      }}
    >
      {text}
    </button>
  );
}

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

function EarningsExhibitSecLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 text-[11px] font-medium normal-case tracking-normal text-[var(--accent)] underline underline-offset-2"
    >
      Open on SEC.gov
    </a>
  );
}

function EarningsExhibitHtmlPanel({
  payload,
  secUrl,
  loading,
  error,
  emptyMessage,
  suggestedPressRelease,
  nearby8KScan,
  showSecLink = true,
}: {
  payload: EarningsPressReleasePayload | null | undefined;
  secUrl: string | null;
  loading: boolean;
  error: string | null | undefined;
  emptyMessage: string;
  suggestedPressRelease?: IxbrlEbitdaReconciliation["suggestedPressRelease"];
  nearby8KScan?: IxbrlEbitdaReconciliation["nearby8KScan"];
  /** When false, parent renders the SEC link in the card header. */
  showSecLink?: boolean;
}) {
  if (loading) {
    return (
      <p className="text-sm" style={{ color: "var(--muted2)" }}>
        Loading exhibit from adjacent Form 8-K…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--warn)" }}>
        {error}
      </p>
    );
  }
  if (!payload) {
    return (
      <div className="space-y-2">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--muted2)" }}>
          {emptyMessage}
        </p>
        {nearby8KScan && nearby8KScan.candidatesTried > 0 ? (
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            We ranked up to {nearby8KScan.candidatesTried} adjacent Form 8-K candidate(s) (by period end / filing
            date); none yielded embedded earnings exhibit HTML in this response.
          </p>
        ) : null}
        {suggestedPressRelease ? (
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
            <span className="font-medium" style={{ color: "var(--text)" }}>
              Suggested document:
            </span>{" "}
            <a
              href={suggestedPressRelease.primaryDocumentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] underline underline-offset-2"
            >
              {suggestedPressRelease.form} · {suggestedPressRelease.filingDate}
            </a>
            {" · "}
            <span className="font-mono text-[10px]">{suggestedPressRelease.primaryDocument}</span>
          </p>
        ) : null}
      </div>
    );
  }

  const isSlideDeck = payload.exhibitClass === "slide_deck";
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
        <p
          className="min-w-0 break-words text-[10px] leading-snug [overflow-wrap:anywhere]"
          style={{ color: "var(--muted2)" }}
        >
          <span className="font-mono">{payload.source.form}</span> · {payload.source.filingDate}
          {payload.source.documentRole === "exhibit_99" ? " · Ex. 99" : " · 8-K"}
          {isSlideDeck ? " · slides" : ""}
          {" · "}
          <span className="font-mono">{payload.source.primaryDocument}</span>
        </p>
        {showSecLink && secUrl ? <EarningsExhibitSecLink href={secUrl} /> : null}
      </div>
      {payload.truncated ? (
        <p className="text-[10px] leading-snug" style={{ color: "var(--warn)" }}>
          Truncated preview — open on SEC.gov for the full filing.
        </p>
      ) : null}
      <div
        className="max-h-[min(82vh,calc(100dvh-11rem))] w-full max-w-full min-w-0 overflow-auto rounded border border-[var(--border)] bg-[var(--panel)]"
        style={{ contain: "inline-size" }}
      >
        <div
          className={`saved-html-content sec-debt-footnote-html ixbrl-earnings-press-release-root w-full max-w-full min-w-0 p-3 text-[12px] text-[var(--text)]${isSlideDeck ? " ixbrl-earnings-slide-deck-root" : ""}`}
          // eslint-disable-next-line react/no-danger -- sanitized with DOMPurify; server stripped script/style
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(payload.html, { USE_PROFILES: { html: true } }),
          }}
        />
      </div>
    </div>
  );
}

function PeriodFinancialsEarningsTranscriptPanel({
  ticker,
  period,
}: {
  ticker: string;
  period: string | null;
}) {
  const roicPageUrl = roicTranscriptQuarterUrl(ticker, period);
  const roicIndexUrl = roicTranscriptIndexUrl(ticker);

  return (
    <Card
      className="!p-3 sm:!p-4 [&_.card-header]:!mb-1.5"
      title={`Earnings transcript — ${ticker}${period ? ` · ${period}` : ""}`}
      titleAside={
        period ? (
          <span className="ml-auto flex shrink-0 items-center gap-2.5 text-[11px] font-medium normal-case tracking-normal">
            <a
              href={roicPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] underline underline-offset-2"
            >
              Open on Roic.ai
            </a>
            <a
              href={roicIndexUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--muted2)] underline underline-offset-2"
            >
              All transcripts
            </a>
          </span>
        ) : null
      }
    >
      {!period ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Could not infer a fiscal quarter from the selected filing. Choose a periodic 10-Q or 10-K with a report date.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-[var(--border)] bg-[var(--panel)]">
          <iframe
            title={`Roic.ai earnings transcript — ${ticker}`}
            src={roicPageUrl}
            className="h-[min(82vh,calc(100dvh-11rem))] w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      )}
    </Card>
  );
}

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
  const periods = stmt.periods;
  const rows = stmt.rows;
  const statementId = stmt.id as FaceStatementId;
  return (
    <Card title={`${stmt.title}${stmt.units ? ` — ${stmt.units}` : ""}`}>
      <div className="overflow-auto">
        <table className="min-w-[920px] w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2 text-left text-sm font-medium" style={{ color: "var(--muted2)" }}>
                Line
              </th>
              {periods.map((p) => {
                const head = (p.shortLabel?.trim() ? p.shortLabel : p.label) || p.label;
                return (
                  <th key={p.key} className="whitespace-nowrap px-3 py-2 text-right align-bottom text-sm" style={{ color: "var(--muted2)" }} title={p.label}>
                    <span className="inline-block max-w-[160px] whitespace-normal leading-snug">{head}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const emphasis = faceStatementRowEmphasis(r, statementId);
              const rowBg =
                emphasis === "subtotal"
                  ? "color-mix(in srgb, var(--accent) 11%, var(--panel))"
                  : emphasis === "heading"
                    ? "color-mix(in srgb, var(--muted) 7%, var(--panel))"
                    : idx % 2 === 1
                      ? "color-mix(in srgb, var(--muted) 4%, var(--panel))"
                      : "var(--panel)";
              const labelWeight = emphasis === "normal" ? 400 : 600;
              const valueWeight = emphasis === "subtotal" ? 600 : 400;
              const labelColor = emphasis === "heading" ? "var(--muted2)" : "var(--text)";
              return (
              <tr
                key={`${r.concept}-${idx}`}
                className="border-t"
                style={{
                  borderColor: emphasis === "subtotal" ? "color-mix(in srgb, var(--accent) 28%, var(--border2))" : "var(--border2)",
                  background: rowBg,
                }}
              >
                <td
                  className="sticky left-0 z-10 px-3 py-2"
                  style={{
                    color: labelColor,
                    fontWeight: labelWeight,
                    background: rowBg,
                    paddingLeft: `${10 + Math.min(10, r.depth) * 14}px`,
                    fontStyle: emphasis === "heading" ? "italic" : "normal",
                  }}
                  title={`${r.concept}${r.cellIxByPeriod?.[periods[0]?.key ?? ""]?.xbrlConcept ? ` · ${r.cellIxByPeriod[periods[0]!.key]!.xbrlConcept}` : ""}`}
                >
                  {r.label}
                </td>
                {periods.map((p) => {
                  const visible = r.visibleTextByPeriod?.[p.key];
                  const meta = r.cellIxByPeriod?.[p.key];
                  const cellText = formatFaceStatementCell(r, p.key, statementId);
                  return (
                  <td
                    key={p.key}
                    className="whitespace-nowrap px-3 py-2 text-right text-base font-mono tabular-nums tracking-tight"
                    style={{
                      color: emphasis === "heading" ? "var(--muted)" : "var(--text)",
                      fontWeight: valueWeight,
                      opacity: cellText === "—" ? 0.55 : 1,
                    }}
                    title={meta?.xbrlConcept ? `${visible ?? ""} · ix:${meta.xbrlConcept} · raw:${r.rawValues[p.key] ?? "—"}` : visible ?? ""}
                  >
                    {cellText}
                  </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  const [activeSubTab, setActiveSubTab] = useState<TestSubTabId>("financials");
  const [fullscreenSubTab, setFullscreenSubTab] = useState<TestSubTabId | null>(null);
  const [tabSavePhase, setTabSavePhase] = useState<Partial<Record<TestSubTabId, TabSavePhase>>>({});
  const [tabSaveErr, setTabSaveErr] = useState<Partial<Record<TestSubTabId, string>>>({});
  const [mgmtDiscoverySaveUrl, setMgmtDiscoverySaveUrl] = useState<string | null>(null);
  const [mgmtDiscoveryAlreadySaved, setMgmtDiscoveryAlreadySaved] = useState(false);
  const tabSaveOkTimerRef = useRef<Partial<Record<TestSubTabId, ReturnType<typeof setTimeout>>>>({});
  const lastAsPresentedTkRef = useRef<string>("");

  const onSelectSubTab = useCallback((id: TestSubTabId) => {
    setActiveSubTab(id);
    setFullscreenSubTab((prev) => (prev && prev !== id ? null : prev));
  }, []);

  useEffect(() => {
    return () => {
      for (const t of Object.values(tabSaveOkTimerRef.current)) {
        if (t) clearTimeout(t);
      }
    };
  }, []);

  useEffect(() => {
    if (!fullscreenSubTab) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreenSubTab(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreenSubTab]);

  useEffect(() => {
    if (!fullscreenSubTab) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreenSubTab]);

  useEffect(() => {
    setNarrativeBatch(null);
    setNarrativeBatchErr(null);
    setActiveSubTab("financials");
    setFullscreenSubTab(null);
    setMgmtDiscoverySaveUrl(null);
    setMgmtDiscoveryAlreadySaved(false);
  }, [tk]);

  useEffect(() => {
    setMgmtDiscoverySaveUrl(null);
    setMgmtDiscoveryAlreadySaved(false);
  }, [selectedAcc]);

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
        const msg = (j.error ?? "").trim() || "Failed to load Period Financials HTML-face data";

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
  const filingPeriodLabels = buildPeriodFinancialsFilingLabels(filings);
  const selected = data?.selected?.accessionNumber ?? "";
  const statements = data?.statements ?? [];
  const validation = data?.validation;

  useEffect(() => {
    if (!data?.selected?.accessionNumber) return;
    setSelectedAcc(data.selected.accessionNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.selected?.accessionNumber]);

  if (!tk) {
    return (
      <Card title="Period Financials — HTML face financials">
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

  const pressReleasePayload =
    ixbrl?.ok === true && ixbrl.earningsPressRelease?.exhibitClass !== "slide_deck"
      ? ixbrl.earningsPressRelease
      : null;

  const managementPresentationPayload =
    ixbrl?.ok === true
      ? (ixbrl.earningsSlideDeck ??
          (ixbrl.earningsPressRelease?.exhibitClass === "slide_deck" ? ixbrl.earningsPressRelease : null))
      : null;

  const managementPresentationSecUrl =
    managementPresentationPayload?.source.primaryDocumentUrl?.trim() ??
    (ixbrl?.ok === true ? ixbrl.earningsSlideDeck?.source.primaryDocumentUrl?.trim() ?? null : null);

  const selectedFiling =
    filings.find((f) => f.accessionNumber === (selectedAcc || selected)) ??
    filings.find((f) => f.accessionNumber === selected) ??
    filings[0];
  const xbrlPrimaryStatementsFilingUrl =
    data?.cik && selectedFiling
      ? secFilingPrimaryDocUrl(data.cik, selectedFiling.accessionNumber, selectedFiling.primaryDocument)
      : null;

  const ixbrlReportDate = ixbrl?.ok === true ? ixbrl.selected?.reportDate : undefined;
  const roicTranscriptPeriod = reportDateToRoicPeriod(ixbrlReportDate, selectedFiling?.filingDate);
  const managementPresentationDiscoveryPeriod =
    (selectedFiling?.accessionNumber
      ? filingPeriodLabels.get(selectedFiling.accessionNumber)
      : null) ??
    (roicTranscriptPeriod ? roicPeriodToPresentationPeriod(roicTranscriptPeriod) : null);

  const contentTabId = fullscreenSubTab ?? activeSubTab;

  type TabSaveTarget =
    | { kind: "financials-xlsx" }
    | { kind: "url"; url: string }
    | { kind: "unavailable"; reason: string };

  function resolveTabSaveTarget(tabId: TestSubTabId): TabSaveTarget {
    switch (tabId) {
      case "financials":
        if (!statements.length || !selectedFiling?.accessionNumber) {
          return { kind: "unavailable", reason: "No HTML-face statements loaded for this filing." };
        }
        return { kind: "financials-xlsx" };
      case "press-release":
        if (!earningsReleaseSecUrl) {
          return { kind: "unavailable", reason: "No earnings press release URL for this period." };
        }
        return { kind: "url", url: earningsReleaseSecUrl };
      case "management-presentation":
        if (managementPresentationSecUrl) return { kind: "url", url: managementPresentationSecUrl };
        if (mgmtDiscoveryAlreadySaved) {
          return { kind: "unavailable", reason: "Presentation already saved to Saved Documents." };
        }
        if (mgmtDiscoverySaveUrl) return { kind: "url", url: mgmtDiscoverySaveUrl };
        return { kind: "unavailable", reason: "No management presentation found for this period." };
      case "earnings-transcript":
        if (!roicTranscriptPeriod) {
          return { kind: "unavailable", reason: "Could not infer fiscal quarter for transcript." };
        }
        return { kind: "url", url: roicTranscriptQuarterUrl(tk, roicTranscriptPeriod) };
      case "mdna":
        if (!ixMdnaFilingUrl) {
          return { kind: "unavailable", reason: "No SEC filing URL for MD&A." };
        }
        return { kind: "url", url: ixMdnaFilingUrl };
      default:
        return { kind: "unavailable", reason: "Nothing to save." };
    }
  }

  async function handleTabSave(tabId: TestSubTabId) {
    const target = resolveTabSaveTarget(tabId);
    if (target.kind === "unavailable") return;

    const prevTimer = tabSaveOkTimerRef.current[tabId];
    if (prevTimer) {
      clearTimeout(prevTimer);
      tabSaveOkTimerRef.current[tabId] = undefined;
    }

    setTabSavePhase((p) => ({ ...p, [tabId]: "saving" }));
    setTabSaveErr((p) => ({ ...p, [tabId]: undefined }));

    try {
      if (target.kind === "financials-xlsx") {
        if (!selectedFiling) throw new Error("No filing selected.");
        const result = await saveFacePresentedStatementsXlsxToServer(
          tk,
          {
            form: selectedFiling.form,
            filingDate: selectedFiling.filingDate,
            accessionNumber: selectedFiling.accessionNumber,
          },
          data?.companyName,
          data?.cik,
          statements,
          validation,
          Boolean(data?.calculationLinkbaseLoaded)
        );
        if (!result.ok) {
          setTabSaveErr((p) => ({ ...p, [tabId]: result.error }));
          setTabSavePhase((p) => ({ ...p, [tabId]: "err" }));
          return;
        }
      } else {
        const result = await saveRemoteUrlForTicker(tk, target.url, "saved-documents");
        if (!result.ok) {
          setTabSaveErr((p) => ({ ...p, [tabId]: result.error }));
          setTabSavePhase((p) => ({ ...p, [tabId]: "err" }));
          return;
        }
      }
      setTabSavePhase((p) => ({ ...p, [tabId]: "ok" }));
      tabSaveOkTimerRef.current[tabId] = setTimeout(() => {
        setTabSavePhase((p) => ({ ...p, [tabId]: "idle" }));
        tabSaveOkTimerRef.current[tabId] = undefined;
      }, 2200);
    } catch (e) {
      setTabSaveErr((p) => ({
        ...p,
        [tabId]: e instanceof Error ? e.message : "Save failed.",
      }));
      setTabSavePhase((p) => ({ ...p, [tabId]: "err" }));
    }
  }

  function onFullscreenSubTab(tabId: TestSubTabId) {
    setActiveSubTab(tabId);
    setFullscreenSubTab(tabId);
  }

  function renderSubTabTrailing(tabId: TestSubTabId) {
    const saveTarget = resolveTabSaveTarget(tabId);
    const saveDisabled = saveTarget.kind === "unavailable";
    const saveTitle =
      saveTarget.kind === "unavailable"
        ? saveTarget.reason
        : tabSaveErr[tabId] && tabSavePhase[tabId] === "err"
          ? tabSaveErr[tabId]
          : saveTarget.kind === "financials-xlsx"
            ? "Save HTML-face workbook to Saved Documents"
            : "Save to Saved Documents (as PDF)";
    const saveLabel =
      tabSavePhase[tabId] === "err"
        ? "Retry"
        : mgmtDiscoveryAlreadySaved && tabId === "management-presentation"
          ? "Saved"
          : "Save";

    return (
      <>
        <PeriodFinancialsTabChipButton
          label={saveLabel}
          phase={tabSavePhase[tabId] ?? "idle"}
          disabled={saveDisabled || (mgmtDiscoveryAlreadySaved && tabId === "management-presentation")}
          title={saveTitle}
          onClick={() => void handleTabSave(tabId)}
        />
        <PeriodFinancialsTabChipButton
          label="⤢"
          title={`Review ${TEST_SUB_TABS.find((t) => t.id === tabId)?.label ?? "tab"} in fullscreen`}
          onClick={() => onFullscreenSubTab(tabId)}
        />
      </>
    );
  }

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
          Period Financials — {tk}
        </span>
        <select
          className="min-w-0 max-w-[min(420px,70vw)] shrink m-0 rounded border px-1.5 py-0.5 text-xs leading-tight"
          style={{ borderColor: "var(--border2)", background: "var(--card2)", color: "var(--text)" }}
          value={selectedAcc}
          onChange={(e) => setSelectedAcc(e.target.value)}
        >
          {filings.map((f) => (
            <option key={f.accessionNumber} value={f.accessionNumber} title={f.accessionNumber}>
              {formatPeriodFinancialsFilingLabel(
                f,
                filingPeriodLabels.get(f.accessionNumber) ??
                  (f.form === "10-K" ? `FY ${(f.filingDate ?? "").slice(0, 4)}` : `1Q ${(f.filingDate ?? "").slice(0, 4)}`)
              )}
            </option>
          ))}
        </select>
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
        {SHOW_MDNA_EARNINGS_CHECK_BUTTON || SHOW_SELF_DIAGNOSTIC_BUTTON ? (
        <span className="ml-auto flex shrink-0 flex-nowrap items-center gap-1">
          {SHOW_MDNA_EARNINGS_CHECK_BUTTON ? (
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
                      throw new Error(("error" in j ? j.error : undefined) || "Failed to run MD&A/Earnings Check");
                    }
                    setNarrativeBatch(j);
                  } catch (e) {
                    setNarrativeBatchErr(e instanceof Error ? e.message : "Failed to run MD&A/Earnings Check");
                  } finally {
                    setNarrativeBatchBusy(false);
                  }
                })();
              }}
            >
              {narrativeBatchBusy ? "Checking…" : "MD&A/Earnings Check"}
            </button>
          ) : null}
          {SHOW_SELF_DIAGNOSTIC_BUTTON ? (
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
          ) : null}
        </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-[var(--border)]" style={{ background: "var(--panel)" }}>
          <TabBar
            tabs={TEST_SUB_TABS}
            activeId={activeSubTab}
            onSelect={onSelectSubTab}
            variant="company"
            className="px-5 sm:px-8"
            renderTabTrailing={renderSubTabTrailing}
          />
        </div>
        <div
          className={
            fullscreenSubTab
              ? "fixed inset-0 z-[300] flex min-h-0 flex-col overflow-hidden"
              : "min-h-0 flex-1 overflow-y-auto"
          }
          style={fullscreenSubTab ? { background: "var(--card)" } : undefined}
          data-period-financials-fullscreen={fullscreenSubTab ? "1" : undefined}
        >
          {fullscreenSubTab ? (
            <div
              className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-2 sm:px-8"
              style={{ borderColor: "var(--border)", background: "var(--panel)" }}
            >
              <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                {TEST_SUB_TABS.find((t) => t.id === fullscreenSubTab)?.label ?? "Period Financials"}
              </span>
              <button
                type="button"
                className="rounded border px-2 py-1 text-[11px] font-medium"
                style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
                onClick={() => setFullscreenSubTab(null)}
              >
                Exit fullscreen
              </button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4 sm:px-8 sm:pb-5">
      {contentTabId === "financials" ? (
        <>
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
          {xbrlPrimaryStatementsFilingUrl ? (
            <div className="flex justify-end">
              <a
                href={xbrlPrimaryStatementsFilingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm font-medium text-[var(--accent)] underline underline-offset-2"
              >
                Open SEC filing
              </a>
            </div>
          ) : null}
          {statements.map((s) => (
            <StatementAsPresentedTable key={s.id} stmt={s} />
          ))}
        </div>
      ) : null}

      {SHOW_CALC_LINKBASE_VALIDATION && !loading && !err && validation && validation.length > 0 ? (
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
        </>
      ) : null}

      {contentTabId === "press-release" ? (
          <Card
            className="!p-3 sm:!p-4 [&_.card-header]:!mb-1.5"
            title={`Earnings press release — ${tk}`}
            titleAside={
              earningsReleaseSecUrl ? (
                <span className="ml-auto">
                  <EarningsExhibitSecLink href={earningsReleaseSecUrl} />
                </span>
              ) : null
            }
          >
            {ixbrl?.ok === true ? (
              <EarningsExhibitHtmlPanel
                payload={pressReleasePayload}
                secUrl={earningsReleaseSecUrl}
                showSecLink={false}
                loading={ixLoading}
                error={ixErr}
                emptyMessage="No Form 8-K press release could be resolved for this periodic filing (no nearby earnings 8-K in our ranked window, or EDGAR did not return the HTML). Change the filing above or open the periodic report on SEC.gov."
                suggestedPressRelease={ixbrl.ebitdaReconciliation?.suggestedPressRelease}
                nearby8KScan={ixbrl.ebitdaReconciliation?.nearby8KScan}
              />
            ) : ixLoading ? (
              <EarningsExhibitHtmlPanel
                payload={null}
                secUrl={null}
                loading
                error={null}
                emptyMessage=""
              />
            ) : (
              <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
                {ixErr ?? "No filing data."}
              </p>
            )}
          </Card>
      ) : null}

      {contentTabId === "management-presentation" ? (
          <Card
            className="!p-3 sm:!p-4 [&_.card-header]:!mb-1.5"
            title={`Management presentation — ${tk}`}
            titleAside={
              managementPresentationSecUrl ? (
                <span className="ml-auto">
                  <EarningsExhibitSecLink href={managementPresentationSecUrl} />
                </span>
              ) : null
            }
          >
            {ixbrl?.ok === true ? (
              ixLoading ? (
                <p className="text-sm" style={{ color: "var(--muted2)" }}>
                  Loading…
                </p>
              ) : managementPresentationPayload ? (
                <EarningsExhibitHtmlPanel
                  payload={managementPresentationPayload}
                  secUrl={managementPresentationSecUrl}
                  showSecLink={false}
                  loading={false}
                  error={ixErr}
                  emptyMessage=""
                />
              ) : (
                <ManagementPresentationDiscoveryPanel
                  ticker={tk}
                  period={managementPresentationDiscoveryPeriod}
                  reportDate={ixbrlReportDate}
                  enabled
                  onDiscoverySaveUrlChange={({ url, alreadySaved }) => {
                    setMgmtDiscoverySaveUrl(url);
                    setMgmtDiscoveryAlreadySaved(alreadySaved);
                  }}
                />
              )
            ) : ixLoading ? (
              <EarningsExhibitHtmlPanel payload={null} secUrl={null} loading error={null} emptyMessage="" />
            ) : (
              <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
                {ixErr ?? "No filing data."}
              </p>
            )}
          </Card>
      ) : null}

      {contentTabId === "earnings-transcript" ? (
        <PeriodFinancialsEarningsTranscriptPanel ticker={tk} period={roicTranscriptPeriod} />
      ) : null}

      {contentTabId === "mdna" ? (
      <Card
        className="!p-3 sm:!p-4 [&_.card-header]:!mb-1.5"
        title={`MD&A (filing HTML) — ${tk}`}
        titleAside={
          ixMdnaFilingUrl ? (
            <span className="ml-auto">
              <EarningsExhibitSecLink href={ixMdnaFilingUrl} />
            </span>
          ) : null
        }
      >
        {ixLoading ? (
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            Loading filing HTML…
          </p>
        ) : ixErr ? (
          <p className="text-sm" style={{ color: "var(--warn)" }}>
            {ixErr}
          </p>
        ) : ixbrl?.ok ? (
          <div className="space-y-2">
            {SHOW_MDNA_EXTRACTION_DIAGNOSTICS && ixbrl.diagnostics ? (
              <details className="rounded border border-[var(--border)] bg-[var(--panel)]">
                <summary className="cursor-pointer px-3 py-1.5 text-[11px] font-medium text-[var(--text)]">
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
                  <p className="rounded border border-amber-700/40 bg-amber-950/20 px-3 py-1.5 text-[10px] leading-snug text-[var(--text)]">
                    <span className="font-medium text-amber-200/95">Truncated</span>
                    <span className="text-[var(--muted)]"> — open on SEC.gov for the full MD&amp;A.</span>
                  </p>
                ) : null}
                <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--panel)]">
                  <div
                    className="saved-html-content sec-debt-footnote-html min-w-0 max-h-[min(82vh,calc(100dvh-11rem))] overflow-y-auto p-3 text-[12px] text-[var(--text)]"
                    // eslint-disable-next-line react/no-danger -- sanitized with DOMPurify
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(ixbrl.mdnaSectionHtml, { USE_PROFILES: { html: true } }),
                    }}
                  />
                </div>
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
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            No data.
          </p>
        )}
      </Card>
      ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

