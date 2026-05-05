"use client";

import type { ReactNode } from "react";
import { useCallback, useId, useLayoutEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { Card } from "@/components/ui";

type ExtractJson = {
  anchorLabel: string | null;
  tablesHtml: string;
  plainTextFallback: string;
  note: string;
  debtNoteTitle?: string | null;
  noteNumber?: string | null;
  confidence?: string;
  extractionMethod?: string;
  extractedFootnoteText?: string;
  /** Full debt note as HTML — preserves filing `<table>` markup. */
  extractedFootnoteHtml?: string;
  debtTablesMarkdown?: string[];
  startHeading?: string | null;
  endHeading?: string | null;
  warnings?: string[];
  htmlStartOffset?: number;
  htmlEndOffset?: number;
  reviewRequired?: boolean;
  candidates?: Array<{
    rank: number;
    titleRaw?: string;
    headingScore?: number;
    totalDebtScore?: number;
    snippet?: string;
    selected?: boolean;
  }>;
  diagnosticReport?: {
    primarySelectionReason?: string;
    noteHeadingCount?: number;
    detectedNoteHeadings?: string[];
    topCandidatesSnippet?: Array<{ heading: string; totalScore: number; snippet: string }>;
    possibleMdandaOrNonNotesLeak?: boolean;
  };
};

type FilingJson = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  docUrl: string;
  extract: ExtractJson;
} | null;

type ApiJson = {
  ticker: string;
  cik: string;
  companyName: string;
  tenK: FilingJson;
  tenQ: FilingJson;
  message?: string;
  error?: string;
};

function sanitizeFootnoteHtml(html: string): string {
  if (!html.trim()) return "";
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: [
      "colspan",
      "rowspan",
      "class",
      "style",
      "align",
      "valign",
      "width",
      "height",
      "border",
      "cellpadding",
      "cellspacing",
      "nowrap",
      "id",
      "headers",
      "scope",
    ],
    ADD_TAGS: ["colgroup", "col"],
  });
}

function FilingDebtBlock({
  filing,
  onCopyPlain,
}: {
  filing: NonNullable<FilingJson>;
  onCopyPlain: (text: string) => void;
}) {
  const ex = filing.extract;
  const safeFootnoteHtml = useMemo(() => sanitizeFootnoteHtml(ex.extractedFootnoteHtml ?? ""), [ex.extractedFootnoteHtml]);
  const safeTablesOnly = useMemo(() => sanitizeFootnoteHtml(ex.tablesHtml), [ex.tablesHtml]);
  const displayHtml = safeFootnoteHtml.trim() ? safeFootnoteHtml : safeTablesOnly;
  const footnotePlain = (ex.extractedFootnoteText ?? ex.plainTextFallback ?? "").trim();

  const plainPreview = useMemo(() => {
    if (footnotePlain.length > 400) return footnotePlain;
    const fromTables = safeTablesOnly ? stripHtmlToRoughPlain(safeTablesOnly) : "";
    return fromTables.length > 400 ? fromTables : ex.plainTextFallback || fromTables;
  }, [footnotePlain, safeTablesOnly, ex.plainTextFallback]);

  return (
    <div className="space-y-3 rounded border border-[var(--border)] bg-[var(--card)]/40 p-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <a
          href={filing.docUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-[var(--accent)] underline underline-offset-2"
        >
          Open SEC filing
        </a>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--card)]"
          onClick={() => onCopyPlain(footnotePlain || plainPreview)}
        >
          Copy debt footnote (text)
        </button>
      </div>
      {ex.confidence === "Not Found" && ex.note ? (
        <p className="rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[11px] leading-snug text-[var(--muted)]">
          {ex.note}
        </p>
      ) : null}
      {ex.reviewRequired && ex.confidence && ex.confidence !== "Not Found" ? (
        <div className="rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-[11px] leading-snug text-[var(--text)]">
          <span className="font-medium text-amber-200/95">Review suggested</span>
          <span className="text-[var(--muted)]">
            {" "}
            ({ex.confidence}
            {ex.extractionMethod ? ` · ${ex.extractionMethod.replace(/_/g, " ")}` : ""})
          </span>
          {ex.warnings && ex.warnings.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-[var(--muted)]">
              {ex.warnings.slice(0, 6).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {ex.diagnosticReport &&
      (ex.diagnosticReport.topCandidatesSnippet?.length || ex.diagnosticReport.detectedNoteHeadings?.length) ? (
        <details className="rounded border border-[var(--border)] bg-[var(--panel)]">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-[var(--text)]">
            Extraction diagnostics
          </summary>
          <div className="space-y-2 border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
            {ex.diagnosticReport.primarySelectionReason ? (
              <p>
                <span className="font-medium text-[var(--text)]">Selection: </span>
                {ex.diagnosticReport.primarySelectionReason}
              </p>
            ) : null}
            {typeof ex.diagnosticReport.noteHeadingCount === "number" ? (
              <p>Note headings detected: {ex.diagnosticReport.noteHeadingCount}</p>
            ) : null}
            {ex.diagnosticReport.possibleMdandaOrNonNotesLeak ? (
              <p className="text-amber-200/90">Flag: possible MD&A or non-notes leakage — verify against the filing.</p>
            ) : null}
            {ex.diagnosticReport.topCandidatesSnippet && ex.diagnosticReport.topCandidatesSnippet.length > 0 ? (
              <div>
                <p className="font-medium text-[var(--text)]">Top candidates</p>
                <ul className="mt-1 list-decimal pl-4">
                  {ex.diagnosticReport.topCandidatesSnippet.map((c, i) => (
                    <li key={`${i}-${c.heading.slice(0, 40)}`} className="mb-1">
                      <span className="text-[var(--text)]">[{c.totalScore}]</span> {c.heading}
                      {c.snippet ? <span className="block font-mono text-[10px] text-[var(--muted)]">{c.snippet}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
      {displayHtml.trim() ? (
        <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--panel)]">
          <div
            className="saved-html-content sec-debt-footnote-html min-w-0 max-h-[min(70vh,920px)] overflow-y-auto p-3 text-[12px] leading-snug text-[var(--text)]"
            // eslint-disable-next-line react/no-danger -- sanitized with DOMPurify
            dangerouslySetInnerHTML={{ __html: displayHtml }}
          />
        </div>
      ) : null}
      {!displayHtml.trim() && !footnotePlain ? (
        <pre className="max-h-[min(55vh,560px)] overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--panel)] p-3 font-mono text-[11px] text-[var(--text)]">
          {plainPreview || "No extractable content — open the SEC filing."}
        </pre>
      ) : null}
    </div>
  );
}

function stripHtmlToRoughPlain(html: string): string {
  return html
    .replace(/<\/(tr|table|p|div|h\d)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function DebtFootnoteFilingSection({
  formBadge,
  heading,
  children,
}: {
  formBadge: string;
  heading: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <div id={headingId} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 rounded border border-[var(--accent)]/45 bg-[rgba(0,212,170,0.1)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
            {formBadge}
          </span>
          <h2 className="text-[14px] font-semibold leading-tight text-[var(--text)]">{heading}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

/** localStorage survives tab switches (component unmounts) and browser restarts; larger quota than sessionStorage. */
const STORAGE_KEY_PREFIX = "capital-structure-latest-periodic:v2:";
const LEGACY_SESSION_KEY_PREFIX = "capital-structure-latest-periodic:v1:";

function readCapitalStructureSavedResults(ticker: string): ApiJson | null {
  if (typeof window === "undefined" || !ticker) return null;
  try {
    let raw = localStorage.getItem(STORAGE_KEY_PREFIX + ticker);
    let legacy = false;
    if (!raw) {
      raw = sessionStorage.getItem(LEGACY_SESSION_KEY_PREFIX + ticker);
      legacy = !!raw;
    }
    if (!raw) return null;
    const j = JSON.parse(raw) as ApiJson;
    if (!j || typeof j.ticker !== "string" || j.ticker.toUpperCase() !== ticker) return null;
    if (legacy) {
      try {
        localStorage.setItem(STORAGE_KEY_PREFIX + ticker, raw);
        sessionStorage.removeItem(LEGACY_SESSION_KEY_PREFIX + ticker);
      } catch {
        /* ignore */
      }
    }
    return j;
  } catch {
    return null;
  }
}

function writeCapitalStructureSavedResults(ticker: string, data: ApiJson) {
  if (typeof window === "undefined" || !ticker) return;
  try {
    const payload = JSON.stringify(data);
    localStorage.setItem(STORAGE_KEY_PREFIX + ticker, payload);
    try {
      sessionStorage.removeItem(LEGACY_SESSION_KEY_PREFIX + ticker);
    } catch {
      /* ignore */
    }
  } catch {
    /* quota / private mode — try sessionStorage as fallback */
    try {
      sessionStorage.setItem(LEGACY_SESSION_KEY_PREFIX + ticker, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }
}

export function CompanyCapitalStructureLatestPeriodicTab({ ticker }: { ticker: string }) {
  const tk = ticker?.trim().toUpperCase() ?? "";
  const [data, setData] = useState<ApiJson | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** True when current `data` was restored from browser storage (not from the latest SEC refresh). */
  const [fromSavedStorage, setFromSavedStorage] = useState(false);

  const refreshFromSec = useCallback(async () => {
    if (!tk) return;
    setBusy(true);
    setErr(null);
    setFromSavedStorage(false);
    try {
      const enc = encodeURIComponent(tk);
      const r = await fetch(`/api/companies/${enc}/capital-structure-latest-periodic`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const j = (await r.json()) as ApiJson;
      if (!r.ok) {
        setData(null);
        setErr(j.error ?? "Request failed.");
        return;
      }
      setData(j);
      writeCapitalStructureSavedResults(tk, j);
    } catch {
      setData(null);
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }, [tk]);

  /* Restore before paint so switching nav tabs does not flash empty / reload when saved results exist. */
  useLayoutEffect(() => {
    if (!tk) {
      setData(null);
      setErr(null);
      setFromSavedStorage(false);
      return;
    }
    const cached = readCapitalStructureSavedResults(tk);
    if (cached) {
      setData(cached);
      setErr(null);
      setFromSavedStorage(true);
      return;
    }
    setFromSavedStorage(false);
    void refreshFromSec();
  }, [tk, refreshFromSec]);

  const copyPlain = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <Card title={`Debt footnotes — 10-K and 10-Q${tk ? ` (${tk})` : ""}`}>
      <div className="space-y-5 text-[12px] text-[var(--text)]">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !tk}
            className="rounded border border-[var(--accent)]/50 px-3 py-1.5 text-[11px] text-[var(--text)] hover:bg-[rgba(0,212,170,0.12)] disabled:opacity-40"
            onClick={() => void refreshFromSec()}
          >
            {busy ? "Loading…" : "Refresh from SEC"}
          </button>
          {fromSavedStorage && data && !busy ? (
            <span className="text-[11px] text-[var(--muted)]">
              Showing saved results — use &quot;Refresh from SEC&quot; to fetch the latest filings.
            </span>
          ) : null}
        </div>
        {err ? (
          <div className="rounded border border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text)]">{err}</div>
        ) : null}
        {data?.message ? (
          <div className="rounded border border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">{data.message}</div>
        ) : null}
        {data ? (
          <div className="space-y-8">
            {data.tenK ? (
              <DebtFootnoteFilingSection formBadge="10-K" heading="Annual report — debt footnote">
                <FilingDebtBlock filing={data.tenK} onCopyPlain={copyPlain} />
              </DebtFootnoteFilingSection>
            ) : !busy ? (
              <p className="text-[11px] text-[var(--muted)]">No exact 10-K located in submissions feed.</p>
            ) : null}
            {data.tenQ ? (
              <DebtFootnoteFilingSection formBadge="10-Q" heading="Quarterly report — debt footnote">
                <FilingDebtBlock filing={data.tenQ} onCopyPlain={copyPlain} />
              </DebtFootnoteFilingSection>
            ) : !busy ? (
              <p className="text-[11px] text-[var(--muted)]">No exact 10-Q located in submissions feed.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
