"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { downloadAsPresentedStatementsExcel } from "@/lib/sec-xbrl-presented-excel";

type PresentedFiling = { form: string; filingDate: string; accessionNumber: string; primaryDocument: string };
type PresentedStatement = {
  id: string;
  title: string;
  role: string;
  periods: Array<{ key: string; label: string; end: string; start: string | null }>;
  rows: Array<{ concept: string; label: string; depth: number; preferredLabelRole: string | null; values: Record<string, number | null> }>;
};
type ApiResponse = {
  ok?: boolean;
  error?: string;
  ticker?: string;
  cik?: string;
  companyName?: string;
  filings?: PresentedFiling[];
  selected?: { form: string; filingDate: string; accessionNumber: string };
  statements?: PresentedStatement[];
};

/** Raw values from XBRL are assumed USD; show everything in $ millions for a uniform scale. */
function fmt(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const millions = v / 1_000_000;
  const sign = millions < 0 ? "-" : "";
  const abs = Math.abs(millions);
  const s = abs.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  return `${sign}$${s}M`;
}

/** Hide period columns where the share of rows with a non-zero amount is at or below this threshold (e.g. 0.1 = 10%). */
const SPARSE_PERIOD_MAX_FILL_RATIO = 0.1;

/**
 * Period columns that are mostly empty (≤10% of rows with a non-zero value) are omitted so sparse XBRL columns
 * don’t dominate the table. If every column would be hidden, all periods are kept.
 */
function visiblePeriodsForAsPresentedStatement(stmt: PresentedStatement): PresentedStatement["periods"] {
  const { periods, rows } = stmt;
  const n = rows.length;
  if (n === 0 || periods.length === 0) return periods;

  const kept = periods.filter((p) => {
    let nonZero = 0;
    for (const r of rows) {
      const v = r.values[p.key];
      if (v !== null && Number.isFinite(v) && v !== 0) nonZero++;
    }
    return nonZero / n > SPARSE_PERIOD_MAX_FILL_RATIO;
  });

  return kept.length > 0 ? kept : periods;
}

function StatementAsPresentedTable({ stmt }: { stmt: PresentedStatement }) {
  const periods = visiblePeriodsForAsPresentedStatement(stmt);
  return (
    <Card title={stmt.title}>
      <div className="overflow-auto">
        <table className="min-w-[860px] w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--panel)] p-2 text-left" style={{ color: "var(--muted2)" }}>
                Line
              </th>
              {periods.map((p) => (
                <th key={p.key} className="p-2 text-right align-bottom" style={{ color: "var(--muted2)" }} title={p.label}>
                  <span className="inline-block max-w-[140px] whitespace-normal text-[10px] leading-snug">{p.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stmt.rows.map((r, idx) => (
              <tr key={`${r.concept}-${idx}`} className="border-t" style={{ borderColor: "var(--border2)" }}>
                <td
                  className="sticky left-0 z-10 bg-[var(--panel)] p-2"
                  style={{ color: "var(--text)", paddingLeft: `${8 + Math.min(10, r.depth) * 12}px` }}
                  title={r.concept}
                >
                  {r.label}
                </td>
                {periods.map((p) => (
                  <td key={p.key} className="p-2 text-right font-mono" style={{ color: "var(--text)" }}>
                    {fmt(r.values[p.key] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px]" style={{ color: "var(--muted)" }}>
        Amounts in <span className="font-medium">$ millions</span> (USD). Primary statement only (consolidated presentation
        linkbase). Period columns with non-zero values in at most {Math.round(SPARSE_PERIOD_MAX_FILL_RATIO * 100)}% of rows
        are hidden. Up to five period columns; rows tagged <span className="font-mono">[Abstract]</span> /{" "}
        <span className="font-mono">[Member]</span> are taxonomy structure and usually have no amounts. Dashes can also
        mean the fact lives in another XBRL context (segment, parenthetical, etc.). Role:{" "}
        <span className="font-mono">{stmt.role}</span>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs" style={{ color: "var(--muted2)" }}>
              {data?.companyName ? <span style={{ color: "var(--text)" }}>{data.companyName}</span> : null}
              {data?.cik ? <> · CIK {data.cik}</> : null}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px]" style={{ color: "var(--muted2)" }}>
              Showing the primary income statement, balance sheet, and cash flow only (no equity rollforward, disclosures, or
              parenthetical tables).
            </p>
            <button
              type="button"
              className="btn-shell hi shrink-0 rounded-md px-3 py-1.5 text-xs font-medium"
              onClick={() => {
                if (!data?.selected?.accessionNumber) return;
                const sel = data.selected;
                const filingMeta = filings.find((f) => f.accessionNumber === sel.accessionNumber);
                downloadAsPresentedStatementsExcel({
                  ticker: tk,
                  companyName: data.companyName,
                  cik: data.cik,
                  filing: {
                    form: sel.form ?? filingMeta?.form ?? "",
                    filingDate: sel.filingDate ?? filingMeta?.filingDate ?? "",
                    accessionNumber: sel.accessionNumber,
                  },
                  statements: statements.map((s) => {
                    const periods = visiblePeriodsForAsPresentedStatement(s);
                    return {
                      title: s.title,
                      role: s.role,
                      periods: periods.map((p) => ({ key: p.key, label: p.label })),
                      rows: s.rows.map((r) => ({
                        concept: r.concept,
                        label: r.label,
                        depth: r.depth,
                        values: r.values,
                      })),
                    };
                  }),
                });
              }}
            >
              Download Excel (.xlsx)
            </button>
          </div>
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
    </div>
  );
}

