"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";

type Point = {
  fiscalYear: number;
  netIncome: number | null;
  reportedCurrency: string | null;
  filingUrl: string | null;
};

type ApiOk = {
  ok: true;
  symbol: string;
  cik: string | null;
  currency: string;
  points: Point[];
  filingUrls: string[];
  sources: Array<{ label: string; url: string }>;
  disclaimer: string;
};

type ApiErr = { ok: false; error: string };

function formatNetIncome(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function CompanyTwentyYearNetIncomeTab({ ticker }: { ticker: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const [data, setData] = useState<ApiOk | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!safeTicker) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/fmp-net-income-20y/${encodeURIComponent(safeTicker)}`)
      .then(async (res) => {
        const body = (await res.json()) as ApiOk | ApiErr;
        if (!res.ok || body.ok !== true) {
          const err = body as ApiErr;
          throw new Error(err.error || `Request failed (${res.status})`);
        }
        if (!cancelled) setData(body);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  const chart = useMemo(() => {
    if (!data?.points.length) return null;
    const values = data.points.map((p) => p.netIncome).filter((v): v is number => v !== null && Number.isFinite(v));
    if (values.length === 0) {
      return { minVal: 0, maxVal: 1, range: 1, points: data.points };
    }
    const minRaw = Math.min(0, ...values);
    const maxRaw = Math.max(0, ...values);
    const pad = Math.max(Math.abs(maxRaw - minRaw) * 0.06, 1);
    const minVal = minRaw - pad;
    const maxVal = maxRaw + pad;
    const range = maxVal - minVal || 1;
    return { minVal, maxVal, range, points: data.points };
  }, [data]);

  if (!safeTicker) {
    return (
      <Card title="20 year GAAP Net Income">
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Select a ticker to load data.
        </p>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card title={`20 year GAAP Net Income — ${safeTicker}`}>
        <p className="text-sm animate-pulse" style={{ color: "var(--muted2)" }}>
          Loading annual net income…
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title={`20 year GAAP Net Income — ${safeTicker}`}>
        <p className="text-sm" style={{ color: "var(--warn)" }}>
          {error}
        </p>
      </Card>
    );
  }

  if (!data || !chart) {
    return (
      <Card title={`20 year GAAP Net Income — ${safeTicker}`}>
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No annual income statement rows returned.
        </p>
      </Card>
    );
  }

  const { minVal, maxVal, range, points } = chart;
  const chartHeight = 220;

  return (
    <div className="space-y-6">
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
        Up to 20 fiscal years of consolidated net income as reported under GAAP (income statement bottom line), in{" "}
        <span className="font-mono">{data.currency}</span> as returned by the data provider. Bar heights map linearly from
        the lowest to the highest value in the window (padding applied).
      </p>

      <Card title={`Annual net income — ${data.symbol} (${points.length} years)`}>
        <div className="overflow-x-auto pb-2">
          <div className="inline-block min-w-full">
            <div
              className="flex items-end gap-1 sm:gap-1.5 px-1"
              style={{ height: chartHeight, minWidth: Math.max(360, points.length * 28) }}
              role="img"
              aria-label="Bar chart of annual net income by fiscal year"
            >
              {points.map((p) => {
                const v = p.netIncome;
                const hasVal = v !== null && Number.isFinite(v);
                const hPx = hasVal ? Math.max(2, ((v! - minVal) / range) * chartHeight) : 2;
                const negative = hasVal && v! < 0;
                return (
                  <div
                    key={p.fiscalYear}
                    className="flex min-w-[22px] flex-1 flex-col items-center justify-end"
                    title={
                      hasVal
                        ? `FY ${p.fiscalYear}: ${formatNetIncome(v!)}`
                        : `FY ${p.fiscalYear}: no net income value`
                    }
                  >
                    <div
                      className="w-full max-w-[36px] rounded-t-sm transition-opacity hover:opacity-90"
                      style={{
                        height: hPx,
                        background: hasVal
                          ? negative
                            ? "var(--warn)"
                            : "var(--accent)"
                          : "var(--border)",
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div
              className="mt-2 flex gap-1 sm:gap-1.5 px-1 font-mono text-[9px] sm:text-[10px]"
              style={{ color: "var(--muted)", minWidth: Math.max(360, points.length * 28) }}
            >
              {points.map((p) => (
                <div key={p.fiscalYear} className="min-w-[22px] flex-1 text-center">
                  {p.fiscalYear}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-1 border-t border-[var(--border)] pt-3 text-[10px] font-mono sm:grid-cols-2 lg:grid-cols-3">
          {points.map((p) => (
            <div key={p.fiscalYear} className="flex justify-between gap-2 border-b border-[var(--border)] py-1 last:border-0 sm:border-0">
              <span style={{ color: "var(--muted2)" }}>FY {p.fiscalYear}</span>
              <span className="text-right">
                {p.netIncome !== null && Number.isFinite(p.netIncome) ? (
                  <span style={{ color: p.netIncome < 0 ? "var(--warn)" : "var(--text)" }}>{formatNetIncome(p.netIncome)}</span>
                ) : (
                  <span style={{ color: "var(--muted)" }}>—</span>
                )}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Axis: {formatNetIncome(minVal)} … {formatNetIncome(maxVal)} (padded range).
        </p>
      </Card>

      <Card title="Sources">
        <p className="mb-3 text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
          {data.disclaimer}
        </p>
        <ul className="space-y-2 text-[11px]">
          {data.sources.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--accent)]"
                style={{ color: "var(--accent)" }}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        {data.filingUrls.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Underlying SEC filing links (from FMP)
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-[10px]">
              {data.filingUrls.map((url) => (
                <li key={url} className="truncate">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[var(--accent)] underline decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--accent)]"
                    title={url}
                  >
                    {url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 96)}
                    {url.length > 96 ? "…" : ""}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
