"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";

type Point = {
  fy: number;
  periodEnd: string;
  netIncome: number | null;
  revenue: number | null;
  shares: number | null;
  operatingIncomeExImpairment: number | null;
  ocfLessCapex: number | null;
  totalDebt: number | null;
  taxAdjustedEbitToTangibleAssets: number | null;
};

type ApiOk = {
  ok: true;
  ticker: string;
  cik: string;
  entityName: string | null;
  fetchedAt: string;
  points: Point[];
};

function fmtUsdMillions(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const m = v / 1_000_000;
  const sign = m < 0 ? "−" : "";
  const abs = Math.abs(m);
  const s = abs.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  return `${sign}$${s}M`;
}

function fmtShares(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B sh`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M sh`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K sh`;
  return `${v.toLocaleString()} sh`;
}

function fmtRatioPercent(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function MetricBarChart({
  title,
  labels,
  values,
  formatLabel,
}: {
  title: string;
  labels: string[];
  values: Array<number | null>;
  /** On-chart value text and column hover tooltip. */
  formatLabel: (v: number | null) => string;
}) {
  const numeric = values.map((v) => (v != null && Number.isFinite(v) ? v : null));
  const finite = numeric.filter((v): v is number => v !== null);
  const maxPos = finite.length ? Math.max(0, ...finite.map((x) => Math.max(0, x))) : 0;
  const maxNegAbs = finite.length ? Math.max(0, ...finite.map((x) => Math.max(0, -x))) : 0;
  const hasPos = maxPos > 0;
  const hasNeg = maxNegAbs > 0;
  /** Flex weights align the pos/neg split across columns (no baseline rule — bars only). */
  let posFlex = 1;
  let negFlex = 0;
  if (hasPos && hasNeg) {
    posFlex = maxPos;
    negFlex = maxNegAbs;
  } else if (hasNeg) {
    posFlex = 0;
    negFlex = 1;
  } else {
    posFlex = 1;
    negFlex = 0;
  }

  const trackH = "clamp(7rem, 28vh, 13rem)";

  return (
    <Card title={title}>
      <div className="w-full min-w-0">
        <div className="flex w-full min-w-0 items-end gap-0.5 pb-1 sm:gap-1">
          {numeric.map((v, i) => {
            const shown = formatLabel(v);
            const tip =
              v === null ? `${labels[i]}: (no value)` : `${labels[i]} · ${shown}`;
            const posHpct = v != null && v > 0 && maxPos > 0 ? (v / maxPos) * 100 : 0;
            const negHpct = v != null && v < 0 && maxNegAbs > 0 ? (Math.abs(v) / maxNegAbs) * 100 : 0;
            return (
              <div
                key={`${labels[i]}-${i}`}
                className="flex min-w-0 flex-1 flex-col items-stretch justify-end"
                title={tip}
              >
                <div
                  className="mb-1.5 flex min-h-[2.75rem] w-full min-w-0 items-end justify-center px-0.5"
                  style={{ color: "var(--muted2)" }}
                >
                  <span className="block w-full min-w-0 truncate text-center font-mono text-[11px] tabular-nums leading-snug sm:text-xs md:text-[13px]">
                    {shown}
                  </span>
                </div>
                <div
                  className="flex w-full min-w-0 flex-col"
                  style={{ height: trackH }}
                >
                  <div
                    className="flex min-h-0 w-full min-w-0 flex-col justify-end"
                    style={{ flex: `${posFlex} 1 0` }}
                  >
                    {posHpct > 0 ? (
                      <div
                        className="w-full min-w-0 rounded-t-sm transition-all"
                        style={{
                          height: `${posHpct}%`,
                          minHeight: posHpct > 0 ? 3 : 0,
                          background: "var(--accent)",
                        }}
                      />
                    ) : null}
                  </div>
                  <div
                    className="flex min-h-0 w-full min-w-0 flex-col justify-start"
                    style={{ flex: `${negFlex} 1 0` }}
                  >
                    {negHpct > 0 ? (
                      <div
                        className="w-full min-w-0 rounded-b-sm transition-all"
                        style={{
                          height: `${negHpct}%`,
                          minHeight: negHpct > 0 ? 3 : 0,
                          background: "var(--danger, #c45c5c)",
                        }}
                      />
                    ) : null}
                  </div>
                </div>
                <div
                  className="mt-1.5 w-full min-w-0 truncate text-center text-[10px] font-medium tabular-nums sm:text-[11px]"
                  style={{ color: "var(--muted)" }}
                  title={labels[i]}
                >
                  {labels[i]}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

export function CompanyTwentyYearLookbackTab({ ticker }: { ticker: string }) {
  const [data, setData] = useState<ApiOk | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/sec/xbrl/twenty-year-lookback/${encodeURIComponent(ticker)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : res.statusText);
        if (!body?.ok || !Array.isArray(body.points)) throw new Error("Unexpected response");
        return body as ApiOk;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (loading) {
    return (
      <div className="text-sm" style={{ color: "var(--muted2)" }}>
        Loading SEC company facts (data.sec.gov)…
      </div>
    );
  }

  if (err) {
    return (
      <div className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--danger, #c45c5c)" }}>
        {err}
      </div>
    );
  }

  const points = data?.points ?? [];
  const labels = points.map((p) => String(p.fy));
  const head = data ? (
    <div className="mb-6 text-sm" style={{ color: "var(--muted2)" }}>
      {data.entityName ? <span className="font-medium" style={{ color: "var(--text)" }}>{data.entityName}</span> : null}
      {data.entityName ? " · " : null}
      CIK {data.cik} · Up to 20 fiscal years from SEC company facts: P&L / cash flow use FY (~12-month) rows; balance sheet
      and debt use fiscal year-end snapshots from annual reports (FY or Q4 on 10-K / 20-F / 40-F when point-in-time). Axis = calendar
      year of period-end date.
    </div>
  ) : null;

  if (points.length === 0) {
    return (
      <>
        {head}
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No annual FY data found in company facts for this ticker.
        </p>
      </>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {head}
      <MetricBarChart
        title="Net income"
        labels={labels}
        values={points.map((p) => p.netIncome)}
        formatLabel={fmtUsdMillions}
      />
      <MetricBarChart
        title="Diluted weighted-average share count"
        labels={labels}
        values={points.map((p) => p.shares)}
        formatLabel={fmtShares}
      />
      <MetricBarChart
        title="Revenue"
        labels={labels}
        values={points.map((p) => p.revenue)}
        formatLabel={fmtUsdMillions}
      />
      <MetricBarChart
        title="Operating income (impairment add-backs)"
        labels={labels}
        values={points.map((p) => p.operatingIncomeExImpairment)}
        formatLabel={fmtUsdMillions}
      />
      <MetricBarChart
        title="OCF − CapEx"
        labels={labels}
        values={points.map((p) => p.ocfLessCapex)}
        formatLabel={fmtUsdMillions}
      />
      <MetricBarChart
        title="Total debt"
        labels={labels}
        values={points.map((p) => p.totalDebt)}
        formatLabel={fmtUsdMillions}
      />
      <MetricBarChart
        title="Tax-adjusted EBIT / tangible assets"
        labels={labels}
        values={points.map((p) => p.taxAdjustedEbitToTangibleAssets)}
        formatLabel={fmtRatioPercent}
      />
    </div>
  );
}
