"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, DataTable, TabBar } from "@/components/ui";
import { pivotFundamentalSeries } from "@/lib/roic-fundamental-pivot";
import type { PivotedFundamental } from "@/lib/roic-fundamental-pivot";
import { ROIC_V2_STATEMENT_SECTIONS, type RoicV2FundamentalDataset } from "@/lib/roic-ai-v2-datasets";
import { formatRoicTableNumber, datasetShowsMillionsNote } from "@/lib/roic-fundamental-format";
import { tabLabelToId } from "@/lib/tabs";

type StatementPeriod = "annual" | "quarterly";

type ApiOk = {
  ticker: string;
  roicSymbol: string;
  dataset: string;
  period?: StatementPeriod;
  symbolResolution?: { tried: string[]; resolved: string };
  series: Record<string, unknown>[];
};

function formatPivotCell(
  dataset: RoicV2FundamentalDataset,
  key: string,
  v: unknown
): { text: string; negative: boolean } {
  if (v === null || v === undefined) return { text: "—", negative: false };
  if (typeof v === "number" && Number.isFinite(v)) {
    const neg = v < 0;
    return { text: formatRoicTableNumber(dataset, key, v), negative: neg };
  }
  if (typeof v === "boolean") return { text: v ? "true" : "false", negative: false };
  const s = String(v);
  return { text: s.length > 120 ? `${s.slice(0, 120)}…` : s, negative: false };
}

function RoicFundamentalPivotTable({
  pivoted,
  dataset,
}: {
  pivoted: PivotedFundamental;
  dataset: RoicV2FundamentalDataset;
}) {
  const { columnLabels, rows } = pivoted;
  const millionsNote = datasetShowsMillionsNote(dataset);

  if (columnLabels.length === 0) {
    return <p className="text-sm" style={{ color: "var(--muted2)" }}>No periods in response.</p>;
  }

  return (
    <div className="space-y-2">
      {millionsNote ? (
        <p className="text-[11px]" style={{ color: "var(--muted2)" }}>
          Dollar amounts in <strong style={{ color: "var(--text)" }}>$ millions</strong>. Margins, ratios, share counts, and
          per-share metrics keep their native units.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border2)" }}>
        <DataTable>
          <thead>
            <tr>
              <th
                className="sticky left-0 z-[1] whitespace-nowrap border-r bg-[var(--card2)] px-3 py-2 text-left text-xs font-semibold shadow-[2px_0_6px_-2px_rgba(0,0,0,0.15)]"
                style={{ color: "var(--text)", borderColor: "var(--border2)" }}
              >
                Line item
              </th>
              {columnLabels.map((y, hi) => (
                <th
                  key={`${y}-${hi}`}
                  className="whitespace-nowrap bg-[var(--card2)] px-3 py-2 text-right text-xs font-semibold tabular-nums"
                  style={{ color: "var(--text)" }}
                >
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="transition-colors hover:bg-[var(--card2)]/40">
                <td
                  className="sticky left-0 z-[1] max-w-[min(22rem,50vw)] border-r bg-[var(--card)] px-3 py-1.5 text-xs font-medium shadow-[2px_0_6px_-2px_rgba(0,0,0,0.12)]"
                  style={{ color: "var(--muted2)", borderColor: "var(--border2)" }}
                  title={row.label}
                >
                  <span className="line-clamp-2">{row.label}</span>
                </td>
                {row.values.map((cell, ci) => {
                  const { text, negative } = formatPivotCell(dataset, row.key, cell);
                  return (
                    <td
                      key={ci}
                      className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs tabular-nums"
                      style={{ color: negative ? "var(--danger)" : "var(--text)" }}
                      title={String(cell ?? "")}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
    </div>
  );
}

const INNER_TABS = ROIC_V2_STATEMENT_SECTIONS.map((s) => ({
  id: s.dataset,
  label: s.label,
}));

export function CompanyRoicAiV2StatementsTab({
  ticker,
  statementPeriod,
  title,
}: {
  ticker: string;
  statementPeriod: StatementPeriod;
  title: string;
}) {
  const safeTicker = ticker?.trim().toUpperCase() ?? "";
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<RoicV2FundamentalDataset>(ROIC_V2_STATEMENT_SECTIONS[0]!.dataset);
  const [roicSymbolOverride, setRoicSymbolOverride] = useState("");
  const [resolvedMeta, setResolvedMeta] = useState<{ roicSymbol: string; tried?: string[] } | null>(null);

  const [byDataset, setByDataset] = useState<Partial<Record<RoicV2FundamentalDataset, ApiOk>>>({});
  const [errors, setErrors] = useState<Partial<Record<RoicV2FundamentalDataset, string>>>({});

  const activePayload = byDataset[activeSection];
  const activeError = errors[activeSection];

  const pivoted = useMemo(() => {
    if (!activePayload?.series?.length) return null;
    return pivotFundamentalSeries(activePayload.series, {
      quarterlyColumnLabels: statementPeriod === "quarterly",
    });
  }, [activePayload, statementPeriod]);

  const loadAll = useCallback(async () => {
    if (!safeTicker) return;
    setLoading(true);
    setByDataset({});
    setErrors({});
    setResolvedMeta(null);

    const sym = roicSymbolOverride.trim();
    const periodParam = statementPeriod === "quarterly" ? "period=quarterly" : "";
    const symParam = sym ? `symbol=${encodeURIComponent(sym)}` : "";
    const qs = [symParam, periodParam].filter(Boolean).join("&");
    const suffix = qs ? `?${qs}` : "";

    const results = await Promise.allSettled(
      ROIC_V2_STATEMENT_SECTIONS.map(async ({ dataset }) => {
        const res = await fetch(`/api/roic-ai/v2/${encodeURIComponent(safeTicker)}/${dataset}${suffix}`);
        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!res.ok) {
          throw { dataset, message: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
        }
        const series = body?.series;
        if (!Array.isArray(series)) {
          throw { dataset, message: "Unexpected API response" };
        }
        return { dataset, payload: body as ApiOk };
      })
    );

    const nextData: Partial<Record<RoicV2FundamentalDataset, ApiOk>> = {};
    const nextErr: Partial<Record<RoicV2FundamentalDataset, string>> = {};
    let firstResolution: { roicSymbol: string; tried?: string[] } | null = null;

    for (const r of results) {
      if (r.status === "fulfilled") {
        const { dataset, payload } = r.value;
        nextData[dataset] = payload;
        if (!firstResolution && payload.roicSymbol) {
          firstResolution = {
            roicSymbol: payload.roicSymbol,
            tried: payload.symbolResolution?.tried,
          };
        }
      } else {
        const reason = r.reason as { dataset?: RoicV2FundamentalDataset; message?: string };
        const ds = reason?.dataset;
        if (ds) nextErr[ds] = reason.message ?? "Failed";
      }
    }

    setByDataset(nextData);
    setErrors(nextErr);
    setResolvedMeta(firstResolution);
    setLoading(false);
  }, [safeTicker, roicSymbolOverride, statementPeriod]);

  useEffect(() => {
    if (!safeTicker) return;
    void loadAll();
  }, [safeTicker, statementPeriod, roicSymbolOverride, loadAll]);

  const periodHint =
    statementPeriod === "quarterly"
      ? "Quarterly columns show calendar year and quarter (e.g. 2024 Q3)."
      : "Annual columns show fiscal year.";

  return (
    <div className="space-y-4">
      <Card title={title}>
        <p className="mb-3 text-sm" style={{ color: "var(--muted2)" }}>
          Roic fundamentals v2 — {periodHint} Data loads when you open this tab. API key stays on the server (
          <code className="text-xs">ROIC_AI_API_KEY</code>).
        </p>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[12rem] flex-col gap-1 text-xs" style={{ color: "var(--muted2)" }}>
            Roic symbol override (optional)
            <input
              type="text"
              value={roicSymbolOverride}
              onChange={(e) => setRoicSymbolOverride(e.target.value)}
              placeholder="e.g. QVCGA"
              className="rounded border px-2 py-1 font-mono text-sm"
              style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card)" }}
            />
          </label>
          {loading ? (
            <span className="text-xs" style={{ color: "var(--muted2)" }}>
              Loading tables…
            </span>
          ) : null}
        </div>

        {resolvedMeta ? (
          <p className="mb-3 text-xs" style={{ color: "var(--muted2)" }}>
            Resolved symbol:{" "}
            <span className="font-mono" style={{ color: "var(--text)" }}>{resolvedMeta.roicSymbol}</span>
            {resolvedMeta.tried?.length ? <> (tried {resolvedMeta.tried.join(", ")})</> : null}
          </p>
        ) : null}

        <div className="mb-4 border-b border-[var(--border)] pb-1" style={{ background: "var(--panel)" }}>
          <TabBar
            tabs={INNER_TABS}
            activeId={activeSection}
            onSelect={(id) => setActiveSection(id as RoicV2FundamentalDataset)}
            variant="company"
          />
        </div>

        {activeError ? (
          <p className="mb-3 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            {activeError}
          </p>
        ) : null}

        {pivoted ? (
          <RoicFundamentalPivotTable pivoted={pivoted} dataset={activeSection} />
        ) : loading ? (
          <p className="text-sm" style={{ color: "var(--muted2)" }}>Loading…</p>
        ) : !activeError && !activePayload ? (
          <p className="text-sm" style={{ color: "var(--muted2)" }}>No data.</p>
        ) : !loading && activePayload && !pivoted ? (
          <p className="text-sm" style={{ color: "var(--muted2)" }}>No rows for this section.</p>
        ) : null}
      </Card>
    </div>
  );
}

/** Tab ids for CompanyAnalysis (derived from labels). */
export const ROIC_ANNUAL_FINANCIAL_STATEMENTS_TAB_ID = tabLabelToId("Annual Financial Statements");
export const ROIC_QUARTERLY_FINANCIAL_STATEMENTS_TAB_ID = tabLabelToId("Quarterly Financial Statements");
