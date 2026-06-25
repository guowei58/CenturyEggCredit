"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, DataTable } from "@/components/ui";
import { getRegulatorySource } from "@/lib/regulatory/registry";
import type { RegulatorySourceRegistryEntry, RegulatorySearchResult } from "@/lib/regulatory/types";
import { connectionBucketForSource } from "@/lib/regulatory/connectionBuckets";
import { SubsidiaryQuerySuggestionsCard } from "@/components/company/SubsidiaryQuerySuggestionsCard";
import { RegulatoryResultSourceLinks } from "@/components/company/RegulatoryResultSourceLinks";
import { RegulatorySearchNotes } from "@/components/company/RegulatorySearchNotes";
import { workspaceSearchCompanyName } from "@/lib/company-workspace-key";

type SearchResp =
  | {
      ok: true;
      source: RegulatorySourceRegistryEntry;
      config: unknown;
      retrievedAt: string;
      rawStoragePath?: string;
      adapter: {
        ok: boolean;
        requestUrl?: string;
        raw?: unknown;
        results?: RegulatorySearchResult[];
        warnings?: string[];
        error?: string;
        hint?: string;
      };
    }
  | { ok: false; error: string; hint?: string };

function confidenceBadge(c: string) {
  if (c === "High") return { bg: "rgba(34,197,94,0.14)", fg: "#86efac", border: "rgba(34,197,94,0.35)" };
  if (c === "Medium") return { bg: "rgba(234,179,8,0.14)", fg: "#fde68a", border: "rgba(234,179,8,0.35)" };
  return { bg: "rgba(239,68,68,0.10)", fg: "#fecaca", border: "rgba(239,68,68,0.28)" };
}

export function CompanyRegulatoryApiTab({
  ticker,
  companyName,
  sourceId,
  tabTitle,
  autoSearchOnMount = true,
  topNotice,
}: {
  ticker: string;
  companyName?: string;
  sourceId: string;
  tabTitle?: string;
  autoSearchOnMount?: boolean;
  topNotice?: string;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const source = useMemo(() => getRegulatorySource(sourceId), [sourceId]);
  const [queryDraft, setQueryDraft] = useState("");
  const [stateDraft, setStateDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SearchResp | null>(null);
  const [entityNameHints, setEntityNameHints] = useState<string[]>([]);
  const [subsidiaryCollapseSignal, setSubsidiaryCollapseSignal] = useState(0);
  const bootstrapKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const seed = workspaceSearchCompanyName(safeTicker, companyName);
    setQueryDraft(seed);
  }, [safeTicker, companyName]);

  const searchWithQuery = useCallback(
    async (q: string) => {
      if (!safeTicker || !source) return;
      const trimmed = q.trim();
      if (!trimmed) return;
      setSubsidiaryCollapseSignal((n) => n + 1);
      setLoading(true);
      setError(null);
      setPayload(null);
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(safeTicker)}/regulatory/search`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceId: source.source_id,
            params: {
              query: trimmed,
              companyName: (companyName ?? "").trim(),
              ticker: safeTicker,
              state: stateDraft.trim().toUpperCase() || undefined,
              entityNames: entityNameHints.slice(0, 12),
            },
          }),
        });
        const body = (await res.json()) as SearchResp;
        if (!res.ok || body.ok !== true) {
          const e = body as any;
          setError(e.error || `Request failed (HTTP ${res.status}).`);
          setPayload(body);
          return;
        }
        if (body.adapter?.ok === false) {
          setError(body.adapter?.error || "Search failed.");
          setPayload(body);
          return;
        }
        setPayload(body);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed.");
        setPayload(null);
      } finally {
        setLoading(false);
      }
    },
    [safeTicker, source, stateDraft, companyName, entityNameHints]
  );

  const runSearch = useCallback(() => {
    void searchWithQuery(queryDraft);
  }, [queryDraft, searchWithQuery]);

  /** FCC-style: run once when the tab opens / company or source changes (not when checkboxes toggle). */
  useEffect(() => {
    if (!autoSearchOnMount) return;
    if (!safeTicker || !source) return;
    const seed = workspaceSearchCompanyName(safeTicker, companyName);
    if (!seed.trim()) return;
    const aliasKey = entityNameHints.slice(0, 12).join("|");
    const key = `${safeTicker}|${sourceId}|${seed}|${aliasKey}`;
    if (bootstrapKeyRef.current === key) return;
    bootstrapKeyRef.current = key;
    void searchWithQuery(seed);
  }, [safeTicker, sourceId, companyName, source, searchWithQuery, autoSearchOnMount, entityNameHints]);

  if (!safeTicker) {
    return (
      <Card title={tabTitle ?? "Regulatory API Search"}>
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to search regulatory sources.
        </p>
      </Card>
    );
  }

  if (!source) {
    return (
      <Card title={tabTitle ?? "Regulatory API Search"}>
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Unknown source: <span className="font-mono">{sourceId}</span>
        </p>
      </Card>
    );
  }

  const connBucket = connectionBucketForSource(source.source_id);

  const results = (payload as any)?.adapter?.results as RegulatorySearchResult[] | undefined;
  const warnings = ((payload as any)?.adapter?.warnings ?? []) as string[];

  return (
    <div className="space-y-6">
      <SubsidiaryQuerySuggestionsCard
        ticker={safeTicker}
        companyName={companyName}
        disabled={loading}
        searchCollapseSignal={subsidiaryCollapseSignal}
        disclaimer="Subsidiaries from your saved Public Records profile (Exhibit 21 grid when present, otherwise the subsidiary name table). Use these as search queries. Verify matches in the underlying agency system."
        onNamesLoaded={setEntityNameHints}
        onPickName={(name) => {
          setQueryDraft(name);
          void searchWithQuery(name);
        }}
      />
      <Card title={`${tabTitle ?? source.display_name} — ${safeTicker}`}>
        {topNotice ? (
          <p className="mb-3 rounded-md border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: "var(--border2)", color: "var(--muted)" }}>
            {topNotice}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Search query
            </label>
            <input
              type="text"
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              placeholder="Company, entity, keyword, identifier…"
              className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
              style={{ borderColor: "var(--border2)" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
            />
          </div>
          <div className="w-full sm:w-28">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              State
            </label>
            <input
              type="text"
              value={stateDraft}
              onChange={(e) => setStateDraft(e.target.value)}
              placeholder="e.g. TX"
              className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
              style={{ borderColor: "var(--border2)" }}
            />
          </div>
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={loading || !queryDraft.trim()}
            className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {loading && !payload ? (
          <p className="text-sm py-6" style={{ color: "var(--muted)" }}>
            Loading results…
          </p>
        ) : null}

        <RegulatorySearchNotes notes={warnings} />

        {error ? (
          <div className="mt-4 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--danger)", background: "rgba(239,68,68,0.06)", color: "var(--danger)" }}>
            <p>{error}</p>
            {(payload as any)?.adapter?.hint ? (
              <p className="mt-2 text-xs" style={{ color: "var(--muted2)" }}>
                Hint: <span className="font-mono">{(payload as any).adapter.hint}</span>
              </p>
            ) : null}
            {source.requires_api_key && source.env_key_name ? (
              <p className="mt-2 text-xs" style={{ color: "var(--muted2)" }}>
                API key required: set <span className="font-mono">{source.env_key_name}</span> in <span className="font-mono">.env.local</span> and restart.
              </p>
            ) : null}
          </div>
        ) : null}

        {payload && (results?.length ?? 0) === 0 && !error ? (
          <p className="text-sm py-6" style={{ color: "var(--muted2)" }}>
            No records found for this query.
          </p>
        ) : null}

        {results && results.length > 0 ? (
          <div className="mt-4">
            <p className="text-[11px] mb-2" style={{ color: "var(--muted2)" }}>
              {results.length} results · Retrieved {new Date((payload as any)?.retrievedAt ?? Date.now()).toLocaleString()}
              {(payload as any)?.rawStoragePath ? <> · Raw saved: <span className="font-mono">{(payload as any).rawStoragePath}</span></> : null}
            </p>
            <DataTable>
              <thead>
                <tr>
                  <th>Matched entity</th>
                  <th>Record date</th>
                  <th>Type</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>State</th>
                  <th>Identifier</th>
                  <th>Source</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const cb = confidenceBadge(r.confidence);
                  return (
                    <tr key={r.result_id}>
                      <td>{r.matched_entity || "—"}</td>
                      <td>{r.filing_or_record_date || "—"}</td>
                      <td>{r.record_type || "—"}</td>
                      <td className="min-w-[340px]">
                        <div className="font-medium">{r.title || "—"}</div>
                        {r.description ? <div className="text-xs mt-1" style={{ color: "var(--muted2)" }}>{r.description}</div> : null}
                      </td>
                      <td>{r.status || "—"}</td>
                      <td>{r.state || "—"}</td>
                      <td>{r.agency_identifier || r.docket_number || r.permit_number || "—"}</td>
                      <td>
                        <RegulatoryResultSourceLinks ticker={safeTicker} row={r} />
                      </td>
                      <td>
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ background: cb.bg, color: cb.fg, borderColor: cb.border }}>
                          {r.confidence}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

