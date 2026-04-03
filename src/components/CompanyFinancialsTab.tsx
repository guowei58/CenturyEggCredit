"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui";
import { HistoricalFinancialsAiWorkflow } from "@/components/HistoricalFinancialsAiWorkflow";

type TableBlock = {
  title: string;
  periodLabels: string[];
  lineItems: Array<{ key: string; label: string; values: string[] }>;
};

type FmpPayload = {
  symbol: string;
  incomeStatement: { annual: TableBlock; quarterly: TableBlock };
  balanceSheet: { annual: TableBlock; quarterly: TableBlock };
  cashFlow: { annual: TableBlock; quarterly: TableBlock };
  meta: { annualYears: string; quarterlyYears: string; source: string };
};

function StatementTable({ block }: { block: TableBlock }) {
  const { periodLabels, lineItems } = block;
  if (periodLabels.length === 0) {
    return (
      <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
        No rows returned for this period range.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <DataTable>
        <thead>
          <tr>
            <th className="text-left" style={{ minWidth: 200 }}>
              Line item
            </th>
            {periodLabels.map((p) => (
              <th key={p} className="text-right whitespace-nowrap font-mono text-[10px] font-semibold">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lineItems.map((row) => (
            <tr key={row.key}>
              <td style={{ color: "var(--muted2)" }}>{row.label}</td>
              {row.values.map((v, i) => (
                <td key={`${row.key}-${i}`} className="text-right font-mono text-[11px]">
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}

export function CompanyFinancialsTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string | null;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const [data, setData] = useState<FmpPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!safeTicker) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/fmp-financials/${encodeURIComponent(safeTicker)}`)
      .then(async (res) => {
        const body = (await res.json()) as FmpPayload | { error?: string };
        if (!res.ok) throw new Error("error" in body ? String(body.error) : "Failed to load financials");
        return body as FmpPayload;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load financials");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  return (
    <div className="space-y-8">
      <HistoricalFinancialsAiWorkflow ticker={safeTicker} companyName={companyName} />

      {safeTicker && (
        <>
          {loading && (
            <Card title={`FMP statement extract — ${safeTicker}`}>
              <div className="flex items-center gap-2 py-8" style={{ color: "var(--muted)" }}>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
                Loading statements from Financial Modeling Prep…
              </div>
            </Card>
          )}

          {!loading && error && (
            <Card title={`FMP statement extract — ${safeTicker}`}>
              <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--danger)", background: "rgba(239,68,68,0.06)" }}>
                <p style={{ color: "var(--danger)" }}>{error}</p>
                <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  Confirm the ticker is valid on FMP, set <span className="font-mono">FMP_API_KEY</span> in{" "}
                  <span className="font-mono">.env.local</span>, and restart the dev server. This app uses FMP&apos;s current{" "}
                  <span className="font-mono">/stable/</span> endpoints (legacy <span className="font-mono">/api/v3/</span> is blocked for new keys).
                </p>
              </div>
            </Card>
          )}

          {!loading && !error && data && (
            <>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
                Third-party quick reference via {data.meta.source}: annual FY {data.meta.annualYears} and quarterly {data.meta.quarterlyYears}. Values are
                as reported by FMP (USD where applicable)—not filing-presentation faithful.
              </p>

              <Card title="Income statement">
                <div className="mb-6 space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                    Annual — FY 2017–2019
                  </h3>
                  <StatementTable block={data.incomeStatement.annual} />
                </div>
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                    Quarterly — 2020–2025
                  </h3>
                  <StatementTable block={data.incomeStatement.quarterly} />
                </div>
              </Card>

              <Card title="Balance sheet">
                <div className="mb-6 space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                    Annual — FY 2017–2019
                  </h3>
                  <StatementTable block={data.balanceSheet.annual} />
                </div>
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                    Quarterly — 2020–2025
                  </h3>
                  <StatementTable block={data.balanceSheet.quarterly} />
                </div>
              </Card>

              <Card title="Cash flow statement">
                <div className="mb-6 space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                    Annual — FY 2017–2019
                  </h3>
                  <StatementTable block={data.cashFlow.annual} />
                </div>
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                    Quarterly — 2020–2025
                  </h3>
                  <StatementTable block={data.cashFlow.quarterly} />
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
