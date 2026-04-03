"use client";

import type { XSearchResponse } from "@/lib/xSearch/types";

export function XSearchStats({ data }: { data: XSearchResponse | null }) {
  if (!data) {
    return (
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Run a search to see stats.
      </p>
    );
  }
  return (
    <div className="rounded-lg border p-3 text-[11px]" style={{ borderColor: "var(--border2)", background: "var(--sb)" }}>
      <div className="font-semibold" style={{ color: "var(--text)" }}>
        Search summary
      </div>
      <ul className="mt-2 space-y-1" style={{ color: "var(--muted2)" }}>
        <li>Provider used: {data.providerUsed ?? "—"}</li>
        <li>Count estimate: {data.countEstimate ?? "—"}</li>
        <li>Raw / final: {data.rawCount} / {data.finalCount}</li>
        {data.query ? <li className="break-words font-mono">Query: {data.query}</li> : null}
        {data.queryExplanation ? <li>Why: {data.queryExplanation}</li> : null}
      </ul>
      {data.warnings.length > 0 && (
        <div className="mt-2 rounded border border-dashed p-2" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
          {data.warnings.join(" ")}
        </div>
      )}
    </div>
  );
}

