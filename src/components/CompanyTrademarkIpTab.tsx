"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import { SubsidiaryQuerySuggestionsCard } from "@/components/company/SubsidiaryQuerySuggestionsCard";
import { RegulatorySearchNotes } from "@/components/company/RegulatorySearchNotes";
import { Card, DataTable } from "@/components/ui";
import { formatOdpPatentQueryString } from "@/lib/uspto-ip";
import { confidenceLevelColors, matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";

type Links = {
  odpSignup: string;
  patentsViewSignup: string;
  patentCenter: string;
};

type OdpPatentRow = {
  applicationNumberText: string | null;
  inventionTitle: string | null;
  filingDate: string | null;
  patentNumber: string | null;
  applicationStatusCategory: string | null;
  assigneeEntityName: string | null;
  inventorNames: string[];
  googlePatentsUrl: string | null;
};

type ApiOk = {
  ok: true;
  ticker: string;
  companyName: string | null;
  queryUsed: string;
  odpConfigured: boolean;
  patentsViewConfigured: boolean;
  patentsViewError?: string;
  totalOdp: number;
  odpOffset?: number;
  odpLimit?: number;
  totalTrademarkOdp: number;
  odpTrademarkOffset?: number;
  odpTrademarkLimit?: number;
  odpPatents: OdpPatentRow[];
  /** Present on API responses; unused while trademark UI is hidden. */
  odpTrademarks?: unknown[];
  assigneeCandidates: Array<{
    assigneeId: string | null;
    organization: string | null;
    totalPatents: number | null;
  }>;
  patentsViewBlocks: Array<{
    assigneeOrganization: string;
    totalPatentsReported: number | null;
    patents: Array<{
      patentId: string | null;
      title: string | null;
      patentDate: string | null;
      assignees: string[];
      googlePatentsUrl: string | null;
    }>;
  }>;
  links: Links;
  notices: string[];
};

type ApiErr = {
  ok: false;
  error: string;
  queryAttempted?: string;
  odpSignup?: string;
};

const ODP_PAGE_LIMIT = 50;

function ellipsize(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function CompanyTrademarkIpTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const [queryDraft, setQueryDraft] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMoreOdp, setLoadingMoreOdp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ApiOk | null>(null);
  /** Rows accumulated across ODP pages (Load more). Replaced on each new Search. */
  const [odpPatentRows, setOdpPatentRows] = useState<OdpPatentRow[]>([]);
  /** Raw `q` sent to the API for the current result set (`null` = server uses company name / ticker). */
  const [pagingQ, setPagingQ] = useState<string | null>(null);
  const [subsidiaryCollapseSignal, setSubsidiaryCollapseSignal] = useState(0);

  const runPatentSearch = useCallback(
    async (qParam: string | undefined) => {
      if (!safeTicker) return;
      setSubsidiaryCollapseSignal((n) => n + 1);
      setLoading(true);
      setError(null);
      try {
        const u = new URL(`/api/uspto-ip/${encodeURIComponent(safeTicker)}`, window.location.origin);
        if (qParam?.trim()) u.searchParams.set("q", qParam.trim());
        u.searchParams.set("offset", "0");
        u.searchParams.set("limit", String(ODP_PAGE_LIMIT));
        const res = await fetch(u.toString(), { cache: "no-store" });
        const body = (await res.json()) as ApiOk | ApiErr;
        if (!res.ok || body.ok !== true) {
          const e = body as ApiErr;
          setPayload(null);
          setOdpPatentRows([]);
          setPagingQ(null);
          setError(e.error || `Request failed (HTTP ${res.status}).`);
          return;
        }
        setPayload(body);
        setOdpPatentRows(body.odpPatents);
        setPagingQ(qParam?.trim() ? qParam.trim() : null);
        setQueryDraft(body.queryUsed);
        setActiveQuery(body.queryUsed);
      } catch (e) {
        setPayload(null);
        setOdpPatentRows([]);
        setPagingQ(null);
        setError(e instanceof Error ? e.message : "Failed to load USPTO data.");
      } finally {
        setLoading(false);
      }
    },
    [safeTicker]
  );

  const loadMoreOdp = useCallback(async () => {
    if (!safeTicker || !payload?.odpConfigured) return;
    if (odpPatentRows.length >= payload.totalOdp) return;
    setLoadingMoreOdp(true);
    try {
      const u = new URL(`/api/uspto-ip/${encodeURIComponent(safeTicker)}`, window.location.origin);
      if (pagingQ) u.searchParams.set("q", pagingQ);
      u.searchParams.set("offset", String(odpPatentRows.length));
      u.searchParams.set("limit", String(ODP_PAGE_LIMIT));
      const res = await fetch(u.toString(), { cache: "no-store" });
      const body = (await res.json()) as ApiOk | ApiErr;
      if (!res.ok || body.ok !== true) {
        const e = body as ApiErr;
        setError(e.error || `Request failed (HTTP ${res.status}).`);
        return;
      }
      setOdpPatentRows((prev) => [...prev, ...body.odpPatents]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more.");
    } finally {
      setLoadingMoreOdp(false);
    }
  }, [safeTicker, payload?.odpConfigured, payload?.totalOdp, pagingQ, odpPatentRows.length]);

  useEffect(() => {
    if (!safeTicker) return;
    const seed = (companyName ?? "").trim() || safeTicker;
    setQueryDraft(formatOdpPatentQueryString(seed));
    void runPatentSearch(undefined);
  }, [safeTicker, companyName, runPatentSearch]);

  const searchNotes = useMemo(() => {
    if (!payload) return [];
    const notes = [...payload.notices];
    notes.unshift(`Query: "${payload.queryUsed}".`);
    if (payload.odpConfigured) {
      notes.push(
        `ODP patent applications: ${odpPatentRows.length.toLocaleString()} loaded of ${payload.totalOdp.toLocaleString()} match(es) in index.`,
      );
      if (payload.patentsViewConfigured) {
        notes.push(
          `PatentsView enrichment: ${payload.assigneeCandidates.length} assignee name match(es); ${payload.patentsViewBlocks.length} granted-patent block(s) shown.`,
        );
      } else {
        notes.push("PatentsView enrichment not configured (optional).");
      }
    }
    return notes;
  }, [payload, odpPatentRows.length]);

  if (!safeTicker) {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Select a company to search USPTO patent applications.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <SubsidiaryQuerySuggestionsCard
        ticker={safeTicker}
        companyName={companyName}
        disabled={loading || loadingMoreOdp}
        searchCollapseSignal={subsidiaryCollapseSignal}
        disclaimer="Subsidiaries from your saved Public Records profile (Exhibit 21 grid when present, otherwise the subsidiary name table). Use these as search queries. Verify matches on USPTO."
        onPickName={(name) => {
          setQueryDraft(formatOdpPatentQueryString(name));
          void runPatentSearch(name);
        }}
      />
      <Card title="Search query">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Query
            <input
              type="text"
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-sm text-[var(--text)]"
              placeholder='"Company Name, Inc." or assigneeNameText:...'
              disabled={loading || loadingMoreOdp}
            />
          </label>
          <button
            type="button"
            onClick={() => void runPatentSearch(queryDraft)}
            disabled={loading || loadingMoreOdp}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-fg)] disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search USPTO"}
          </button>
        </div>
      </Card>

      <RegulatorySearchNotes notes={searchNotes} className="" />

      {error && (
        <div className="rounded border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {payload && !payload.odpConfigured && (
        <Card title="Setup">
          <p className="text-sm" style={{ color: "var(--text)" }}>
            Add <code className="rounded bg-[var(--card2)] px-1 text-xs">USPTO_API_KEY</code> to{" "}
            <code className="text-xs">.env.local</code> and restart the dev server.
          </p>
          <span className="mt-2 inline-flex flex-wrap items-center gap-x-0.5">
            <a
              href={payload.links.odpSignup}
              className="inline-block text-sm underline"
              target="_blank"
              rel="noreferrer"
            >
              Get a free USPTO Open Data Portal API key
            </a>
            <SaveFilingLinkButton ticker={safeTicker} url={payload.links.odpSignup} />
          </span>
        </Card>
      )}

      {payload?.odpConfigured && (
        <Card
          title={`Patent applications (ODP) — ${payload.totalOdp.toLocaleString()} match(es) in index`}
        >
          {odpPatentRows.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              No application rows returned for this query. Try the full legal name, a subsidiary, or a distinct keyword.
            </p>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Title</th>
                  <th>Filing</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Patent</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {odpPatentRows.map((r, i) => {
                  const q = activeQuery ?? payload?.queryUsed ?? "";
                  const inv = Array.isArray(r.inventorNames) ? r.inventorNames.join(" ") : "";
                  const conf = matchConfidenceFromQuery(q, [r.assigneeEntityName, r.inventionTitle, inv]);
                  const cb = confidenceLevelColors(conf);
                  return (
                  <tr key={`${r.applicationNumberText ?? "row"}-${i}`}>
                    <td className="align-top font-mono text-[11px]" style={{ color: "var(--muted2)" }}>
                      {r.applicationNumberText ?? "—"}
                    </td>
                    <td className="align-top text-[11px]" style={{ color: "var(--text)" }}>
                      {ellipsize(r.inventionTitle ?? "—", 140)}
                    </td>
                    <td className="align-top font-mono text-[11px]" style={{ color: "var(--muted2)" }}>
                      {r.filingDate?.slice(0, 10) ?? "—"}
                    </td>
                    <td className="align-top text-[11px]" style={{ color: "var(--muted)" }}>
                      {ellipsize(r.applicationStatusCategory ?? "—", 48)}
                    </td>
                    <td className="align-top text-[11px]" style={{ color: "var(--muted)" }}>
                      {ellipsize(r.assigneeEntityName ?? "—", 80)}
                    </td>
                    <td className="align-top">
                      {r.patentNumber && r.googlePatentsUrl ? (
                        <span className="inline-flex flex-wrap items-center gap-x-0.5">
                          <a href={r.googlePatentsUrl} className="font-mono text-[11px] underline" target="_blank" rel="noreferrer">
                            {r.patentNumber}
                          </a>
                          <SaveFilingLinkButton ticker={safeTicker} url={r.googlePatentsUrl} />
                        </span>
                      ) : (
                        <span className="text-[11px]" style={{ color: "var(--muted2)" }}>
                          —
                        </span>
                      )}
                    </td>
                    <td className="align-top">
                      <span
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                        style={{ background: cb.bg, color: cb.fg, borderColor: cb.border }}
                      >
                        {conf}
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
          {odpPatentRows.length > 0 && odpPatentRows.length < payload.totalOdp && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void loadMoreOdp()}
                disabled={loading || loadingMoreOdp}
                className="rounded border border-[var(--border)] bg-[var(--card2)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] disabled:opacity-50"
              >
                {loadingMoreOdp
                  ? "Loading…"
                  : `Load more (${odpPatentRows.length.toLocaleString()} of ${payload.totalOdp.toLocaleString()} loaded)`}
              </button>
            </div>
          )}
        </Card>
      )}

      {payload?.odpConfigured && payload.assigneeCandidates.length > 0 && (
        <Card title="Assignee name matches (PatentsView)">
          <p className="mb-2 text-[11px]" style={{ color: "var(--muted)" }}>
            USPTO-derived granted-patent index. Use to sanity-check which legal entity name drives the portfolio.
          </p>
          <DataTable>
            <thead>
              <tr>
                <th>Organization</th>
                <th className="text-right">Patents (index)</th>
              </tr>
            </thead>
            <tbody>
              {payload.assigneeCandidates.map((a) => (
                <tr key={a.assigneeId ?? a.organization ?? ""}>
                  <td style={{ color: "var(--text)" }}>{a.organization ?? "—"}</td>
                  <td className="text-right font-mono text-[11px]">{a.totalPatents ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}

      {payload?.patentsViewBlocks?.map((block) => (
        <Card key={block.assigneeOrganization} title={`Granted patents — ${block.assigneeOrganization}`}>
          <p className="mb-2 text-[10px]" style={{ color: "var(--muted)" }}>
            {block.totalPatentsReported != null ? `PatentsView total for assignee (index): ${block.totalPatentsReported}.` : null} Showing recent rows only.
          </p>
          <DataTable>
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Date</th>
                <th>Link</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {block.patents.map((p) => {
                const q = activeQuery ?? payload?.queryUsed ?? "";
                const assigneeLine = (p.assignees ?? []).join(" ");
                const conf = matchConfidenceFromQuery(q, [p.title, assigneeLine, block.assigneeOrganization]);
                const cb = confidenceLevelColors(conf);
                return (
                <tr key={p.patentId ?? p.title ?? ""}>
                  <td className="font-mono text-[11px]" style={{ color: "var(--muted2)" }}>
                    {p.patentId ?? "—"}
                  </td>
                  <td className="text-[11px]" style={{ color: "var(--text)" }}>
                    {ellipsize(p.title ?? "—", 120)}
                  </td>
                  <td className="font-mono text-[11px]" style={{ color: "var(--muted2)" }}>
                    {p.patentDate ?? "—"}
                  </td>
                  <td>
                    {p.googlePatentsUrl ? (
                      <span className="inline-flex flex-wrap items-center gap-x-0.5">
                        <a href={p.googlePatentsUrl} className="text-[11px] underline" target="_blank" rel="noreferrer">
                          View
                        </a>
                        <SaveFilingLinkButton ticker={safeTicker} url={p.googlePatentsUrl} />
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span
                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                      style={{ background: cb.bg, color: cb.fg, borderColor: cb.border }}
                    >
                      {conf}
                    </span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Card>
      ))}

    </div>
  );
}
