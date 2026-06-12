"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";
import {
  debtFootnoteHasDisplayHtml,
  pickBestUnverifiedDebtCandidate,
  type DebtFootnoteRollForward,
} from "@/lib/debt-footnote-display";
import type { DebtSectionExtractResult } from "@/lib/secDebtSectionExtract";

export type DebtFootnoteFilingPayload = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  docUrl: string;
  extract: DebtSectionExtractResult;
};

export type DebtFootnoteFilingPanelProps = {
  filing: DebtFootnoteFilingPayload;
  rollForward?: DebtFootnoteRollForward | null;
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

function stripHtmlToRoughPlain(html: string): string {
  return html
    .replace(/<\/(tr|table|p|div|h\d)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function DebtFootnoteFilingPanel({ filing, rollForward = null }: DebtFootnoteFilingPanelProps) {
  const ex = filing.extract;
  const safeFootnoteHtml = useMemo(() => sanitizeFootnoteHtml(ex.extractedFootnoteHtml ?? ""), [ex.extractedFootnoteHtml]);
  const safeTablesOnly = useMemo(() => sanitizeFootnoteHtml(ex.tablesHtml), [ex.tablesHtml]);
  const displayHtml = safeFootnoteHtml.trim() ? safeFootnoteHtml : safeTablesOnly;
  const footnotePlain = (ex.extractedFootnoteText ?? ex.plainTextFallback ?? "").trim();
  const hasDisplayHtml = debtFootnoteHasDisplayHtml(ex);
  const unverifiedCandidate = useMemo(
    () => (!hasDisplayHtml ? pickBestUnverifiedDebtCandidate(ex) : null),
    [ex, hasDisplayHtml]
  );
  const showUnverifiedFallback = !hasDisplayHtml && Boolean(unverifiedCandidate);
  const needsReview = ex.confidence === "Medium" || ex.confidence === "Low" || ex.reviewRequired;

  const plainPreview = useMemo(() => {
    if (footnotePlain.length > 400) return footnotePlain;
    const fromTables = safeTablesOnly ? stripHtmlToRoughPlain(safeTablesOnly) : "";
    return fromTables.length > 400 ? fromTables : ex.plainTextFallback || fromTables;
  }, [footnotePlain, safeTablesOnly, ex.plainTextFallback]);

  return (
    <section className="space-y-1.5">
      {rollForward ? (
        <p className="rounded border border-amber-700/40 bg-amber-950/20 px-2 py-1 text-[10px] leading-snug text-[var(--text)]">
          <span className="font-medium text-amber-200/95">From annual 10-K</span>
          <span className="text-[var(--muted)]">
            {" "}
            — this 10-Q has no standalone debt note. Showing debt from 10-K filed{" "}
            {rollForward.sourceFilingDate.slice(0, 10)}.{" "}
            <a
              href={rollForward.sourceDocUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] underline underline-offset-2"
            >
              Open 10-K
            </a>
          </span>
        </p>
      ) : null}
      {needsReview && hasDisplayHtml ? (
        <p className="rounded border border-amber-700/35 bg-amber-950/15 px-2 py-1 text-[10px] leading-snug text-[var(--muted)]">
          Extraction confidence: {ex.confidence}. Review against the SEC filing before relying on this text.
        </p>
      ) : null}
      {ex.confidence === "Not Found" && ex.note && !showUnverifiedFallback ? (
        <p className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[10px] leading-snug text-[var(--muted)]">
          {ex.note}
        </p>
      ) : null}
      {showUnverifiedFallback && unverifiedCandidate ? (
        <div className="space-y-1 rounded border border-amber-700/40 bg-amber-950/15 px-2 py-1.5">
          <p className="text-[10px] font-medium leading-snug text-amber-200/95">
            Unverified extraction — open SEC filing to confirm
          </p>
          <p className="text-[10px] leading-snug text-[var(--text)]">
            Best candidate: {unverifiedCandidate.titleRaw || "Debt note"}
            {unverifiedCandidate.totalDebtScore != null
              ? ` (score ${unverifiedCandidate.totalDebtScore})`
              : ""}
          </p>
          {unverifiedCandidate.snippet ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-snug text-[var(--muted)]">
              {unverifiedCandidate.snippet}
            </pre>
          ) : null}
        </div>
      ) : null}
      {displayHtml.trim() ? (
        <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--panel)]">
          <div
            className="saved-html-content sec-debt-footnote-html min-w-0 max-h-[min(82vh,calc(100dvh-9rem))] overflow-y-auto p-2 text-[12px] leading-snug text-[var(--text)]"
            // eslint-disable-next-line react/no-danger -- sanitized with DOMPurify
            dangerouslySetInnerHTML={{ __html: displayHtml }}
          />
        </div>
      ) : null}
      {!displayHtml.trim() && !footnotePlain && !showUnverifiedFallback ? (
        <pre className="max-h-[min(82vh,calc(100dvh-9rem))] overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--panel)] p-2 font-mono text-[11px] text-[var(--text)]">
          {plainPreview || "No extractable content — open the SEC filing."}
        </pre>
      ) : null}
    </section>
  );
}
