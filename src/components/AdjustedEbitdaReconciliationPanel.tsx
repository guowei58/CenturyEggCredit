"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";

import type { AdjustedEbitdaDisplay, AdjustedEbitdaDisplaySection } from "@/lib/adjusted-ebitda-display";
import { highlightNarrativeTableTotalRowsHtml } from "@/lib/sec-narrative-table-display";
import type { IxbrlEbitdaTable } from "@/lib/sec-ixbrl-mdna-tables";

function sanitizeAdjustedEbitdaTableHtml(html: string, preserveIxTags: boolean): string {
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
      ...(preserveIxTags
        ? ["name", "contextref", "unitref", "decimals", "scale", "sign", "format", "continuedat", "escape"]
        : []),
    ],
    ADD_TAGS: preserveIxTags
      ? ["colgroup", "col", "ix:nonfraction", "ix:nonFraction", "ix:continuation", "ix:nonnumeric", "ix:nonNumeric"]
      : ["colgroup", "col"],
  });
}

function AdjustedEbitdaTableBlock({
  table,
  preserveIxTags,
}: {
  table: IxbrlEbitdaTable;
  preserveIxTags: boolean;
}) {
  const safeHtml = useMemo(() => {
    const sanitized = sanitizeAdjustedEbitdaTableHtml(table.tableHtml ?? "", preserveIxTags);
    return highlightNarrativeTableTotalRowsHtml(sanitized);
  }, [preserveIxTags, table.tableHtml]);
  if (!safeHtml.trim()) return null;

  const rootClass = preserveIxTags
    ? "ixbrl-mdna-section-root ixbrl-ebitda-mdna-root"
    : "ixbrl-ebitda-press-release-root";

  return (
    <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--panel)]">
      <div
        className={`saved-html-content sec-debt-footnote-html period-narrative-financial-table ${rootClass} min-w-0 text-sm text-[var(--text)]`}
        // eslint-disable-next-line react/no-danger -- sanitized with DOMPurify
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}

function AdjustedEbitdaSectionBlock({ section }: { section: AdjustedEbitdaDisplaySection }) {
  const preserveIxTags = section.source === "mdna";

  return (
    <div className="space-y-3">
      {section.tables.map((table, i) => (
        <AdjustedEbitdaTableBlock key={`${section.source}-${table.textOffset}-${i}`} table={table} preserveIxTags={preserveIxTags} />
      ))}
    </div>
  );
}

export function AdjustedEbitdaReconciliationPanel({
  display,
  periodicSecUrl,
}: {
  display: AdjustedEbitdaDisplay;
  periodicSecUrl?: string | null;
}) {
  const pressSecUrl = display.supplementalSource?.primaryDocumentUrl ?? null;

  if (display.status === "tables" && display.sections.length > 0) {
    return (
      <div className="space-y-6">
        {display.sections.map((section) => (
          <AdjustedEbitdaSectionBlock key={section.source} section={section} />
        ))}
      </div>
    );
  }

  if (display.status === "mention_only") {
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
        Adjusted EBITDA / non-GAAP measures are mentioned in the filing MD&amp;A, but no reconciliation table was
        detected in MD&amp;A or the linked press release for this period.
        {periodicSecUrl ? (
          <>
            {" "}
            <a href={periodicSecUrl} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>
              Open periodic filing on SEC.gov
            </a>
          </>
        ) : null}
      </p>
    );
  }

  const suggestedUrl = display.suggestedPressRelease?.primaryDocumentUrl ?? pressSecUrl;
  return (
    <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
      No Adjusted EBITDA / non-GAAP reconciliation table found in MD&amp;A or the earnings press release for this
      period.
      {display.nearby8KScan?.candidatesTried ? (
        <span> Scanned {display.nearby8KScan.candidatesTried} nearby 8-K filing(s).</span>
      ) : null}
      {suggestedUrl ? (
        <>
          {" "}
          <a href={suggestedUrl} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>
            Open suggested earnings release on SEC.gov
          </a>
        </>
      ) : null}
    </p>
  );
}
