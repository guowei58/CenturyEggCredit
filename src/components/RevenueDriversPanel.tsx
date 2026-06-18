"use client";

import { useMemo, type ReactNode } from "react";
import DOMPurify from "dompurify";

import type { IxbrlRevenueDrivers, IxbrlRevenueDriversTable } from "@/lib/sec-ixbrl-mdna-tables";
import { highlightNarrativeTableTotalRowsHtml } from "@/lib/sec-narrative-table-display";

const MDNA_SOURCES = new Set<IxbrlRevenueDriversTable["source"]>(["mdna_revenue", "mdna_segment", "segment_note"]);

function normalizeFormLabel(form?: string | null): string | null {
  const f = (form ?? "").trim().toUpperCase();
  if (!f) return null;
  if (f.includes("10-Q")) return "10-Q";
  if (f.includes("10-K")) return "10-K";
  if (f.includes("8-K")) return "8-K";
  return form?.trim() ?? null;
}

function RevenueDriversSourceBox({
  variant,
  label,
  children,
}: {
  variant: "mdna" | "press";
  label: string;
  children: ReactNode;
}) {
  const accent = variant === "mdna" ? "var(--accent)" : "var(--warn)";

  return (
    <section
      className="space-y-3 rounded-lg border border-[var(--border)] p-4"
      style={{
        borderLeftWidth: "4px",
        borderLeftColor: accent,
        background: `color-mix(in srgb, var(--panel) 88%, ${accent} 12%)`,
      }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: accent }}>
        {label}
      </div>
      {children}
    </section>
  );
}

function sanitizeRevenueDriverTableHtml(html: string, preserveIxTags: boolean): string {
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

function RevenueDriverTableBlock({
  table,
  preserveIxTags,
}: {
  table: IxbrlRevenueDriversTable;
  preserveIxTags: boolean;
}) {
  const safeHtml = useMemo(() => {
    const sanitized = sanitizeRevenueDriverTableHtml(table.tableHtml ?? "", preserveIxTags);
    return highlightNarrativeTableTotalRowsHtml(sanitized);
  }, [preserveIxTags, table.tableHtml]);
  if (!safeHtml.trim()) return null;

  const rootClass = preserveIxTags
    ? "ixbrl-mdna-section-root ixbrl-revenue-drivers-root"
    : "ixbrl-ebitda-press-release-root ixbrl-revenue-drivers-root";

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

export function RevenueDriversPanel({
  revenueDrivers,
  periodicSecUrl,
  periodicForm,
}: {
  revenueDrivers: IxbrlRevenueDrivers;
  periodicSecUrl?: string | null;
  periodicForm?: string | null;
}) {
  const periodicFormLabel = normalizeFormLabel(periodicForm);

  if (revenueDrivers.status === "tables" && revenueDrivers.tables.length > 0) {
    const mdnaTables = revenueDrivers.tables.filter((t) => MDNA_SOURCES.has(t.source));
    const pressTables = revenueDrivers.tables.filter((t) => t.source === "press_release");

    const mdnaGrouped = new Map<string, IxbrlRevenueDriversTable[]>();
    for (const table of mdnaTables) {
      const key = table.sectionLabel || "MD&A";
      const list = mdnaGrouped.get(key) ?? [];
      list.push(table);
      mdnaGrouped.set(key, list);
    }

    return (
      <div className="space-y-6">
        {mdnaTables.length > 0 ? (
          <RevenueDriversSourceBox
            variant="mdna"
            label={`MD&A${periodicFormLabel ? ` · ${periodicFormLabel}` : ""}`}
          >
            {[...mdnaGrouped.entries()].map(([sectionLabel, tables]) => (
              <div key={sectionLabel} className="space-y-3">
                {mdnaGrouped.size > 1 ? (
                  <div className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                    {sectionLabel}
                  </div>
                ) : null}
                {tables.map((table, i) => (
                  <RevenueDriverTableBlock key={`mdna-${table.textOffset}-${i}`} table={table} preserveIxTags />
                ))}
              </div>
            ))}
          </RevenueDriversSourceBox>
        ) : null}

        {pressTables.length > 0 ? (
          <RevenueDriversSourceBox variant="press" label="Press release">
            {pressTables.map((table, i) => (
              <RevenueDriverTableBlock key={`press-${table.textOffset}-${i}`} table={table} preserveIxTags={false} />
            ))}
          </RevenueDriversSourceBox>
        ) : null}
      </div>
    );
  }

  if (revenueDrivers.status === "mention_only") {
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
        Revenue and segment discussion appears in MD&amp;A or segment notes, but no qualifying revenue-driver tables
        were detected for this period.
        {periodicSecUrl ? (
          <>
            {" "}
            <a
              href={periodicSecUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--accent)" }}
            >
              Open periodic filing on SEC.gov
            </a>
          </>
        ) : null}
      </p>
    );
  }

  return (
    <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
      No revenue-driver or segment revenue tables found in MD&amp;A, segment notes, or the earnings press release for
      this period.
      {periodicSecUrl ? (
        <>
          {" "}
          <a
            href={periodicSecUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            style={{ color: "var(--accent)" }}
          >
            Open periodic filing on SEC.gov
          </a>
        </>
      ) : null}
    </p>
  );
}
