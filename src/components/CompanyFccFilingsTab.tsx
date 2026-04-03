"use client";

import { useCallback, useEffect, useState } from "react";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import { Card, DataTable } from "@/components/ui";

type EcfsFilingRow = {
  id_submission: string;
  date_received: string | null;
  date_disseminated: string | null;
  submission_type: string;
  filer_names: string;
  proceedings: string;
  preview_text: string | null;
  view_url: string;
};

type ApiOk = {
  ok: true;
  ticker: string;
  company_name: string | null;
  query_used: string;
  filings: EcfsFilingRow[];
  count: number;
  ecfs_search_note: string;
};

type ApiErr = {
  ok: false;
  error: string;
  query_attempted?: string;
  ecfs_help_url?: string;
  signup_url?: string;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso.slice(0, 10);
  return new Date(d).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function CompanyFccFilingsTab({ ticker }: { ticker: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const [queryDraft, setQueryDraft] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpLinks, setHelpLinks] = useState<{ ecfs?: string; signup?: string } | null>(null);
  const [payload, setPayload] = useState<ApiOk | null>(null);

  const runFetch = useCallback(
    async (qParam: string | undefined) => {
      if (!safeTicker) return;
      setLoading(true);
      setError(null);
      setHelpLinks(null);
      try {
        const u = new URL(`/api/fcc-ecfs/${encodeURIComponent(safeTicker)}`, window.location.origin);
        if (qParam && qParam.trim()) u.searchParams.set("q", qParam.trim());
        const res = await fetch(u.toString());
        const body = (await res.json()) as ApiOk | ApiErr;
        if (!res.ok || body.ok !== true) {
          const e = body as ApiErr;
          setPayload(null);
          setError(e.error || `Request failed (HTTP ${res.status}).`);
          if (e.ecfs_help_url || e.signup_url) {
            setHelpLinks({ ecfs: e.ecfs_help_url, signup: e.signup_url });
          }
          return;
        }
        setPayload(body);
        setQueryDraft(body.query_used);
        setActiveQuery(body.query_used);
      } catch (e) {
        setPayload(null);
        setError(e instanceof Error ? e.message : "Failed to load FCC ECFS data.");
      } finally {
        setLoading(false);
      }
    },
    [safeTicker]
  );

  useEffect(() => {
    if (!safeTicker) return;
    void runFetch(undefined);
  }, [safeTicker, runFetch]);

  if (!safeTicker) {
    return (
      <Card title="FCC Filings">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to search the FCC ECFS database.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card title={`FCC Filings (ECFS) — ${safeTicker}`}>
        <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--muted2)" }}>
          Searches the{" "}
          <span className="inline-flex flex-wrap items-center gap-x-0.5 align-middle">
            <a
              href="https://www.fcc.gov/ecfs"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--accent)" }}
            >
              FCC Electronic Comment Filing System (ECFS)
            </a>
            <SaveFilingLinkButton ticker={safeTicker} url="https://www.fcc.gov/ecfs" />
          </span>{" "}
          via the official public API (
          <span className="inline-flex flex-wrap items-center gap-x-0.5 align-middle">
            <a
              href="https://www.fcc.gov/ecfs/help/public_api"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--accent)" }}
            >
              documentation
            </a>
            <SaveFilingLinkButton ticker={safeTicker} url="https://www.fcc.gov/ecfs/help/public_api" />
          </span>
          ). By default the search uses the SEC-registered company name for this ticker. You can override the search
          string below (e.g. a subsidiary or prior legal name).
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              ECFS keyword search
            </label>
            <input
              type="text"
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              placeholder="Company or keyword…"
              className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
              style={{ borderColor: "var(--border2)" }}
            />
          </div>
          <button
            type="button"
            onClick={() => void runFetch(queryDraft)}
            disabled={loading || !queryDraft.trim()}
            className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            {loading ? "Searching…" : "Search ECFS"}
          </button>
        </div>

        {payload?.company_name && (
          <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>
            SEC name: <span style={{ color: "var(--text)" }}>{payload.company_name}</span>
            {activeQuery ? (
              <>
                {" "}
                · Query: <span className="font-mono">{activeQuery}</span>
              </>
            ) : null}
          </p>
        )}

        {loading && !payload && (
          <p className="text-sm py-6" style={{ color: "var(--muted)" }}>
            Loading ECFS results…
          </p>
        )}

        {error && (
          <div
            className="mt-4 rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: "var(--danger)", background: "rgba(239,68,68,0.06)", color: "var(--danger)" }}
          >
            <p>{error}</p>
            {helpLinks?.signup && (
              <p className="mt-2 text-xs" style={{ color: "var(--muted2)" }}>
                Request a free API key:{" "}
                <span className="inline-flex flex-wrap items-center gap-x-0.5 align-middle">
                  <a href={helpLinks.signup} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>
                    api.data.gov signup
                  </a>
                  <SaveFilingLinkButton ticker={safeTicker} url={helpLinks.signup} />
                </span>
                , then set <span className="font-mono">FCC_API_KEY</span> (or <span className="font-mono">DATA_GOV_API_KEY</span>) in{" "}
                <span className="font-mono">.env.local</span> and restart the dev server.
              </p>
            )}
            {helpLinks?.ecfs && !helpLinks?.signup && (
              <p className="mt-2 text-xs">
                <span className="inline-flex flex-wrap items-center gap-x-0.5 align-middle">
                  <a href={helpLinks.ecfs} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>
                    FCC ECFS API help
                  </a>
                  <SaveFilingLinkButton ticker={safeTicker} url={helpLinks.ecfs} />
                </span>
              </p>
            )}
          </div>
        )}

        {payload && (
          <>
            <p className="text-[11px] mt-4 leading-relaxed" style={{ color: "var(--muted2)" }}>
              {payload.ecfs_search_note}
            </p>
            {payload.filings.length === 0 ? (
              <p className="text-sm py-6" style={{ color: "var(--muted2)" }}>
                No filings returned for this query. Try a shorter keyword, a subsidiary name, or confirm the company files
                in FCC proceedings.
              </p>
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <th>Disseminated</th>
                    <th>Filers</th>
                    <th>Type</th>
                    <th>Proceeding(s)</th>
                    <th>Submission</th>
                    <th>ECFS</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.filings.map((f) => (
                    <tr key={f.id_submission}>
                      <td className="whitespace-nowrap font-mono text-[11px]" style={{ color: "var(--muted2)" }}>
                        {formatWhen(f.date_disseminated || f.date_received)}
                      </td>
                      <td className="max-w-[200px] text-xs" style={{ color: "var(--text)" }}>
                        {f.filer_names}
                      </td>
                      <td className="text-xs" style={{ color: "var(--muted2)" }}>
                        {f.submission_type}
                      </td>
                      <td className="max-w-[220px] text-xs" style={{ color: "var(--muted2)" }}>
                        {f.proceedings}
                      </td>
                      <td className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>
                        {f.id_submission}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex flex-wrap items-center gap-x-0.5">
                          <a
                            href={f.view_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium underline"
                            style={{ color: "var(--accent)" }}
                          >
                            Open
                          </a>
                          <SaveFilingLinkButton ticker={safeTicker} url={f.view_url} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
            {payload.filings.some((f) => f.preview_text) && (
              <div className="mt-4 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                  Text previews (subset)
                </div>
                <ul className="space-y-2 text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
                  {payload.filings
                    .filter((f) => f.preview_text)
                    .slice(0, 8)
                    .map((f) => (
                      <li key={`${f.id_submission}-prev`} className="rounded border px-2 py-1.5" style={{ borderColor: "var(--border2)" }}>
                        <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>
                          {f.id_submission}
                        </span>
                        : {f.preview_text}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
