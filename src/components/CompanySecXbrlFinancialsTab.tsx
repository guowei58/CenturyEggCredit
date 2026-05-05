"use client";

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { Card } from "@/components/ui";
import {
  SPARSE_PERIOD_MIN_LINE_FILL_RATIO_DISPLAY,
  visiblePeriodsAndRowsForStatement,
  type PresentedStatementForSave,
  type SecXbrlAsPresentedApiResponse,
} from "@/lib/sec-xbrl-as-presented-save-client";
import type { IxbrlExtractionDiagnostics } from "@/lib/sec-ixbrl-mdna-tables";

type PresentedStatement = PresentedStatementForSave;
type ApiResponse = SecXbrlAsPresentedApiResponse;

type IxbrlFilingSection = "mdna" | "segment";

type IxbrlMdnaTable = {
  id: string;
  caption: string | null;
  rows: string[][];
  tableHtml?: string | null;
  factCount: number;
  section: IxbrlFilingSection;
  textOffset?: number;
  confidence?: "high" | "medium" | "low";
  inclusionReason?: string;
};

type IxbrlMdnaJson =
  | {
      ok: true;
      tables: IxbrlMdnaTable[];
      mdnaHeadingFound: boolean;
      segmentHeadingFound: boolean;
      mdnaTableHit: boolean;
      diagnostics?: IxbrlExtractionDiagnostics;
      selected?: { primaryDocument?: string; form?: string; accessionNumber?: string };
      error?: undefined;
    }
  | { ok: false; error?: string; tables?: IxbrlMdnaTable[] };

/** Raw values from XBRL are assumed USD; show everything in $ millions for a uniform scale. */
function fmt(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const millions = v / 1_000_000;
  const sign = millions < 0 ? "-" : "";
  const abs = Math.abs(millions);
  const s = abs.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  return `${sign}$${s}M`;
}

function StatementAsPresentedTable({ stmt }: { stmt: PresentedStatement }) {
  const { periods, rows } = visiblePeriodsAndRowsForStatement(stmt, {
    minLineFillRatio: SPARSE_PERIOD_MIN_LINE_FILL_RATIO_DISPLAY,
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
                  <th key={p.key} className="px-3 py-2.5 text-right align-bottom text-sm" style={{ color: "var(--muted2)" }} title={p.label}>
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
                {periods.map((p) => (
                  <td key={p.key} className="px-3 py-2.5 text-right text-base font-mono tabular-nums tracking-tight" style={{ color: "var(--text)" }}>
                    {fmt(r.values[p.key] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        Amounts in <span className="font-medium">$ millions</span> (USD). Grid shows{" "}
        <span className="font-medium">SEC-style display</span> (instance fact, including inline sign, inverted only when
        the presentation arc uses a negated label role). API JSON includes <span className="font-medium">rawValues</span>{" "}
        before that flip. Paired &quot;(XBRL raw)&quot; sheets hold instance-side numbers. In this view, period columns are
        hidden when fewer than about one-third of rows have an amount in that column (sparse columns). Role:{" "}
        <span className="font-mono">{stmt.role}</span>
      </p>
    </Card>
  );
}

const IXBRL_SECTION_LABEL: Record<IxbrlFilingSection, string> = {
  mdna: "MD&A",
  segment: "Segment note",
};

function IxbrlHtmlTableCard({ table }: { table: IxbrlMdnaTable }) {
  const colCount = table.rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
  const sectionLabel = IXBRL_SECTION_LABEL[table.section];
  const title =
    (table.caption?.trim() ? table.caption : null) ??
    (table.factCount > 0
      ? `Filing table (${table.factCount} tagged amounts)`
      : "Filing table");

  const safeHtml =
    table.tableHtml && table.tableHtml.length > 0
      ? DOMPurify.sanitize(table.tableHtml, { USE_PROFILES: { html: true } })
      : null;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{title}</span>
          <span className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase sm:text-xs" style={{ background: "var(--panel)", color: "var(--accent)" }}>
            {sectionLabel}
          </span>
          {table.confidence ? (
            <span
              className="rounded px-2 py-0.5 text-[10px] font-medium uppercase sm:text-xs"
              style={{
                background: "var(--card2)",
                color:
                  table.confidence === "high" ? "var(--muted2)" : table.confidence === "medium" ? "var(--warn)" : "var(--muted)",
              }}
              title={table.inclusionReason ?? ""}
            >
              {table.confidence}
            </span>
          ) : null}
        </span>
      }
    >
      <div className="overflow-auto">
        {safeHtml ? (
          <div
            className="ixbrl-filing-table-root min-w-[640px] text-sm leading-snug [&_table]:w-full [&_table]:min-w-0 [&_table]:border-collapse [&_table]:text-[var(--text)] [&_caption]:caption-top [&_caption]:mb-3 [&_caption]:w-full [&_caption]:text-left [&_caption]:text-base [&_caption]:font-semibold [&_caption]:leading-snug [&_caption]:text-[var(--text)] [&_thead>tr]:bg-transparent [&_tbody>tr]:bg-transparent [&_th]:border [&_th]:border-solid [&_th]:border-[var(--border2)] [&_th]:bg-[var(--panel)] [&_th]:px-2.5 [&_th]:py-2 [&_th]:align-bottom [&_th]:text-left [&_th]:font-medium [&_th]:text-[var(--text)] [&_td]:border [&_td]:border-solid [&_td]:border-[var(--border2)] [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-top [&_td]:text-[var(--text)] [&_tbody>tr:nth-child(odd)>td]:bg-white/[0.04] [&_tbody>tr:nth-child(even)>td]:bg-white/[0.07] [&_.ixbrl-nf]:inline-block [&_.ixbrl-nf]:text-right [&_.ixbrl-nf]:font-mono [&_.ixbrl-nf]:tabular-nums"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : (
          <table className="min-w-[720px] w-full border-collapse text-sm">
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri} className="border-t" style={{ borderColor: "var(--border2)" }}>
                  {Array.from({ length: colCount }, (_, ci) => (
                    <td
                      key={ci}
                      className={`px-3 py-2.5 align-top leading-snug ${ci > 0 ? "text-base font-mono tabular-nums tracking-tight" : ""}`}
                      style={{
                        color: "var(--text)",
                        textAlign: ci > 0 ? "right" : "left",
                      }}
                    >
                      {row[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        Tables use the filing&apos;s HTML when possible (preserves merged cells). When that isn&apos;t available, a flat grid is shown.
        <span className="font-mono"> ix:nonFraction</span> amounts are shown as{" "}
        <span className="font-medium">$ millions</span> (USD) using element text × <span className="font-mono">10^scale</span> and optional{" "}
        <span className="font-mono">sign</span>.
      </p>
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

  useEffect(() => {
    if (!tk) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setData(null);
    void (async () => {
      try {
        const qs = selectedAcc ? `?acc=${encodeURIComponent(selectedAcc)}` : "";
        const res = await fetch(`/api/sec/xbrl/as-presented/${encodeURIComponent(tk)}${qs}`, { cache: "no-store" });
        const j = (await res.json()) as ApiResponse;
        if (!res.ok) throw new Error(j.error || "Failed to load SEC XBRL financials");
        if (!cancelled) setData(j);
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

  return (
    <div className="space-y-4">
      <Card title={`SEC XBRL Financials — ${tk}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
            Filing
          </span>
          <select
            className="rounded border px-2 py-1 text-xs"
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
          {selected ? (
            <span className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>
              {selected}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--muted)" }}>
          Bulk-save filing workbooks from the{" "}
          <span className="font-medium" style={{ color: "var(--muted2)" }}>
            Historical Financial Statements
          </span>{" "}
          tab before running the deterministic compiler.
        </p>
        {loading ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            Loading…
          </p>
        ) : err ? (
          <p className="mt-3 text-sm" style={{ color: "var(--warn)" }}>
            {err}
          </p>
        ) : null}
      </Card>

      {!loading && !err && statements.length > 0 ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            Primary statements (income statement, balance sheet, cash flow)
          </p>
          {statements.map((s) => (
            <StatementAsPresentedTable key={s.id} stmt={s} />
          ))}
        </div>
      ) : null}

      {!loading && !err && statements.length === 0 ? (
        <Card title="No as-presented statements found">
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            SEC didn’t return usable as-presented statement linkbases for this filing. Try a different filing.
          </p>
        </Card>
      ) : null}

      <Card title={`MD&A & segment tables (filing HTML) — ${tk}`}>
        {ixLoading ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            Loading filing HTML…
          </p>
        ) : ixErr ? (
          <p className="mt-3 text-sm" style={{ color: "var(--warn)" }}>
            {ixErr}
          </p>
        ) : ixbrl?.ok ? (
          <div className="mt-3 space-y-3">
            {ixbrl.diagnostics ? (
              <details className="rounded border text-[11px]" style={{ borderColor: "var(--border2)" }}>
                <summary className="cursor-pointer px-3 py-2 font-semibold" style={{ color: "var(--muted2)" }}>
                  Extraction diagnostics
                </summary>
                <div className="space-y-2 border-t px-3 py-2 font-mono leading-relaxed" style={{ borderColor: "var(--border2)", color: "var(--muted)" }}>
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
            {ixbrl.tables.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted2)" }}>
                No tables in those sections (unusual headings, or segment note title didn&apos;t match expected patterns).
              </p>
            ) : (
              <div className="space-y-4">
                {ixbrl.tables.map((t) => (
                  <IxbrlHtmlTableCard key={t.id} table={t} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            No data.
          </p>
        )}
      </Card>
    </div>
  );
}

