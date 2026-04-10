"use client";

import type { SubstackSearchResponse } from "@/lib/substack/types";

export function SubstackCoveragePanel({ data }: { data: SubstackSearchResponse | null }) {
  if (!data) {
    return (
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Run a search to see coverage.
      </p>
    );
  }

  return (
    <div className="rounded-lg border p-3 text-[11px]" style={{ borderColor: "var(--border2)", background: "var(--sb)" }}>
      <div className="font-semibold" style={{ color: "var(--text)" }}>
        Coverage
      </div>
      <ul className="mt-2 space-y-1" style={{ color: "var(--muted2)" }}>
        <li>Registry publications: {data.stats.registryPublications}</li>
        <li>Publications RSS-ingested (this run): {data.stats.rssIngestedPublications}</li>
        <li>Indexed matches: {data.stats.indexedMatches}</li>
        <li>Live discovery matches: {data.stats.liveDiscoveryMatches}</li>
        <li>New publications found: {data.stats.newPublicationsFound}</li>
        <li>Returned results: {data.results.length}</li>
      </ul>
      <div className="mt-2 rounded border border-dashed p-2" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
        Serper (Google search API) discovers new publications/posts. RSS ingestion builds a durable local index over time. No paywall bypassing.
      </div>
    </div>
  );
}

