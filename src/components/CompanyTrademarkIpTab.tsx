"use client";

import { useCallback, useEffect, useState } from "react";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import { Card, DataTable } from "@/components/ui";

type Links = {
  odpSignup: string;
  patentsViewSignup: string;
  tsdrSignup: string;
  trademarkSearchUi: string;
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
  odpPatents: OdpPatentRow[];
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

type TsdrOk = { ok: true; trademark: Record<string, string | null> };
type TsdrErr = { ok: false; error: string; tsdrSignup?: string };

type SubsidiaryHintsApi =
  | { ok: true; companyName: string; names: string[]; sources: string[]; disclaimer: string }
  | { ok: false; message: string };

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
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ApiOk | null>(null);

  const [tmSerial, setTmSerial] = useState("");
  const [tmLoading, setTmLoading] = useState(false);
  const [tmError, setTmError] = useState<string | null>(null);
  const [tmResult, setTmResult] = useState<Record<string, string | null> | null>(null);

  const [hintsPayload, setHintsPayload] = useState<Extract<SubsidiaryHintsApi, { ok: true }> | null>(null);
  const [hintsLoading, setHintsLoading] = useState(false);
  const [hintsMessage, setHintsMessage] = useState<string | null>(null);

  const runPatentSearch = useCallback(
    async (qParam: string | undefined) => {
      if (!safeTicker) return;
      setLoading(true);
      setError(null);
      try {
        const u = new URL(`/api/uspto-ip/${encodeURIComponent(safeTicker)}`, window.location.origin);
        if (qParam?.trim()) u.searchParams.set("q", qParam.trim());
        const res = await fetch(u.toString());
        const body = (await res.json()) as ApiOk | ApiErr;
        if (!res.ok || body.ok !== true) {
          const e = body as ApiErr;
          setPayload(null);
          setError(e.error || `Request failed (HTTP ${res.status}).`);
          return;
        }
        setPayload(body);
        setQueryDraft(body.queryUsed);
        setActiveQuery(body.queryUsed);
      } catch (e) {
        setPayload(null);
        setError(e instanceof Error ? e.message : "Failed to load USPTO data.");
      } finally {
        setLoading(false);
      }
    },
    [safeTicker]
  );

  useEffect(() => {
    if (!safeTicker) return;
    const seed = (companyName ?? "").trim() || safeTicker;
    setQueryDraft(seed);
    void runPatentSearch(undefined);
  }, [safeTicker, companyName, runPatentSearch]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    setHintsLoading(true);
    setHintsMessage(null);
    setHintsPayload(null);
    fetch(`/api/subsidiary-hints/${encodeURIComponent(safeTicker)}`)
      .then((res) => res.json() as Promise<SubsidiaryHintsApi>)
      .then((body) => {
        if (cancelled) return;
        if (body.ok) {
          setHintsPayload(body);
          setHintsMessage(null);
        } else {
          setHintsPayload(null);
          setHintsMessage(body.message);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHintsPayload(null);
          setHintsMessage("Could not load subsidiary name ideas.");
        }
      })
      .finally(() => {
        if (!cancelled) setHintsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  const runTsdr = useCallback(async () => {
    setTmLoading(true);
    setTmError(null);
    setTmResult(null);
    try {
      const res = await fetch("/api/uspto-ip/tsdr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: tmSerial.trim() }),
      });
      const body = (await res.json()) as TsdrOk | TsdrErr;
      if (!res.ok || body.ok !== true) {
        const e = body as TsdrErr;
        setTmError(e.error || `TSDR failed (${res.status}).`);
        return;
      }
      setTmResult(body.trademark as Record<string, string | null>);
    } catch (e) {
      setTmError(e instanceof Error ? e.message : "TSDR request failed.");
    } finally {
      setTmLoading(false);
    }
  }, [tmSerial]);

  if (!safeTicker) {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Select a company to search USPTO patent and trademark records.
      </p>
    );
  }

  const links = payload?.links;
  const odpSignupUrl = links?.odpSignup ?? "https://data.uspto.gov/apis/getting-started";
  const trademarkSearchUrl = links?.trademarkSearchUi ?? "https://www.uspto.gov/trademarks/search";
  const tsdrSignupUrl = links?.tsdrSignup ?? "https://developer.uspto.gov";

  return (
    <div className="space-y-6">
      <Card title="Search query">
        <p className="mb-3 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Patent applications use the{" "}
          <span className="inline-flex flex-wrap items-center gap-x-0.5 align-middle">
            <a href={odpSignupUrl} className="underline" target="_blank" rel="noreferrer">
              USPTO Open Data Portal
            </a>
            <SaveFilingLinkButton ticker={safeTicker} url={odpSignupUrl} />
          </span>{" "}
          (<code className="text-[10px]">USPTO_API_KEY</code>). Default text is the SEC-registered company name (or ticker). Trademark{" "}
          <em>owner</em> search is not exposed as a single USPTO REST query; use the official search site below or look up a mark by serial via TSDR.
        </p>

        {hintsLoading && (
          <p className="mb-3 text-[11px]" style={{ color: "var(--muted)" }}>
            Loading registrant / subsidiary name ideas from SEC filings and your saved Subsidiary List…
          </p>
        )}
        {hintsMessage && !hintsLoading && (
          <p className="mb-3 text-[11px]" style={{ color: "var(--muted)" }}>
            {hintsMessage}{" "}
            <span style={{ color: "var(--muted2)" }}>
              (Tip: run the Subsidiary List tab and save a response—those names will appear here.)
            </span>
          </p>
        )}
        {hintsPayload && hintsPayload.names.length > 0 && (
          <div className="mb-4 rounded border border-[var(--border)] bg-[var(--card2)]/30 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
              Names to try in the query box
            </div>
            <p className="mt-1 text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
              {hintsPayload.disclaimer}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hintsPayload.names.map((n) => (
                <button
                  key={n}
                  type="button"
                  title={n}
                  disabled={loading}
                  onClick={() => {
                    setQueryDraft(n);
                    void runPatentSearch(n);
                  }}
                  className="max-w-full rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-left text-[11px] leading-snug transition hover:bg-[var(--card2)] disabled:opacity-50"
                  style={{ color: "var(--text)" }}
                >
                  {ellipsize(n, 52)}
                </button>
              ))}
            </div>
            {hintsPayload.sources.length > 0 && (
              <p className="mt-2 text-[10px]" style={{ color: "var(--muted2)" }}>
                From: {hintsPayload.sources.join(" · ")}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Query
            <input
              type="text"
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-sans text-sm text-[var(--text)]"
              placeholder="Company legal name or keywords"
              disabled={loading}
            />
          </label>
          <button
            type="button"
            onClick={() => void runPatentSearch(queryDraft)}
            disabled={loading}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-fg)] disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search USPTO"}
          </button>
        </div>
        {activeQuery && (
          <p className="mt-2 text-[10px]" style={{ color: "var(--muted)" }}>
            Last query: <span className="font-mono">{activeQuery}</span>
          </p>
        )}
      </Card>

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
          {payload.notices.map((n) => (
            <p key={n} className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
              {n}
            </p>
          ))}
        </Card>
      )}

      {payload?.odpConfigured && payload.notices.length > 0 && (
        <div className="rounded border border-[var(--border)] bg-[var(--card2)]/40 px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
          {payload.notices.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      {payload?.odpConfigured && (
        <Card title={`Patent applications (ODP) — ${payload.totalOdp} reported match(es)`}>
          {payload.odpPatents.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {payload.odpPatents.map((r, i) => (
                  <tr key={`${r.applicationNumberText ?? i}-${i}`}>
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
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          <p className="mt-3 text-[10px]" style={{ color: "var(--muted)" }}>
            Prosecution and file history:{" "}
            <span className="inline-flex flex-wrap items-center gap-x-0.5 align-middle">
              <a href={payload.links.patentCenter} className="underline" target="_blank" rel="noreferrer">
                Patent Center
              </a>
              <SaveFilingLinkButton ticker={safeTicker} url={payload.links.patentCenter} />
            </span>
            . ODP search is keyword-style; results may include unrelated filings if the name is generic.
          </p>
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
              </tr>
            </thead>
            <tbody>
              {block.patents.map((p) => (
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
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      ))}

      <Card title="Trademarks">
        <p className="mb-3 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
          USPTO{" "}
          <span className="inline-flex flex-wrap items-center gap-x-0.5 align-middle">
            <a href={trademarkSearchUrl} className="underline" target="_blank" rel="noreferrer">
              Trademark search (TESS / replacement tools)
            </a>
            <SaveFilingLinkButton ticker={safeTicker} url={trademarkSearchUrl} />
          </span>{" "}
          is the supported way to search by owner or word mark. For a known serial number, TSDR returns structured status (
          <code className="text-[10px]">USPTO_TSDR_API_KEY</code> —{" "}
          <span className="inline-flex flex-wrap items-center gap-x-0.5 align-middle">
            <a href={tsdrSignupUrl} className="underline" target="_blank" rel="noreferrer">
              developer.uspto.gov
            </a>
            <SaveFilingLinkButton ticker={safeTicker} url={tsdrSignupUrl} />
          </span>
          ).
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[180px] flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Serial number
            <input
              type="text"
              value={tmSerial}
              onChange={(e) => setTmSerial(e.target.value)}
              className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-sm text-[var(--text)]"
              placeholder="e.g. 97123456"
              disabled={tmLoading}
            />
          </label>
          <button
            type="button"
            onClick={() => void runTsdr()}
            disabled={tmLoading || !tmSerial.trim()}
            className="rounded border border-[var(--border)] bg-[var(--card2)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] disabled:opacity-50"
          >
            {tmLoading ? "Looking up…" : "TSDR lookup"}
          </button>
        </div>
        {tmError && (
          <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>
            {tmError}
          </p>
        )}
        {tmResult && (
          <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
            {(
              [
                ["Serial", tmResult.serialNumber],
                ["Registration", tmResult.registrationNumber],
                ["Mark", tmResult.mark],
                ["Status", tmResult.status],
                ["Status date", tmResult.statusDate],
                ["Filing date", tmResult.filingDate],
                ["Registration date", tmResult.registrationDate],
                ["Owner", tmResult.owner],
                ["Goods & services", tmResult.goodsAndServices],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="rounded bg-[var(--card2)]/50 px-2 py-1.5">
                <dt className="font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
                  {label}
                </dt>
                <dd className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap" style={{ color: "var(--text)" }}>
                  {v && String(v).trim() ? String(v) : "—"}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}
