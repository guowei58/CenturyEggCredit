"use client";

import type { BrokerResearchResponse } from "@/lib/brokerResearch/types";

export function BrokerResearchStats({ data }: { data: BrokerResearchResponse | null }) {
  if (!data) {
    return (
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Run a search to see stats.
      </p>
    );
  }

  return (
    <div
      className="rounded-lg border p-3 text-[11px] leading-relaxed"
      style={{ borderColor: "var(--border2)", background: "var(--sb)" }}
    >
      <div className="font-semibold" style={{ color: "var(--text)" }}>
        Run summary
      </div>
      <ul className="mt-2 space-y-1" style={{ color: "var(--muted2)" }}>
        <li>Queries executed: {data.queryCount}</li>
        <li>Results (raw / deduped): {data.resultsBeforeDedupe} / {data.resultsAfterDedupe}</li>
        <li>Returned: {data.reports.length}</li>
        <li>Brokers searched: {data.activeBrokers.length}</li>
        {data.skippedBrokers.length > 0 && (
          <li>Skipped (config / filter): {data.skippedBrokers.join(", ")}</li>
        )}
      </ul>
      <div className="mt-3 font-semibold" style={{ color: "var(--text)" }}>
        Per broker
      </div>
      <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto" style={{ color: "var(--muted2)" }}>
        {Object.entries(data.brokerStats).map(([id, s]) => (
          <li key={id}>
            {id}: {s.success ? "ok" : "issues"} — {s.resultCount} hits / {s.queryCount} queries
            {s.error ? ` — ${s.error}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
