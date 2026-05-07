"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildOpenCorporatesWebUrl } from "@/lib/opencorporates/buildOpenCorporatesWebUrl";
import { buildStateSosSearchUrl } from "@/lib/sos/buildStateSosSearchUrl";

type Row = Record<string, unknown>;

function registeredAddressStrength(r: Row): number {
  const raw = r.registeredAddress;
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s || s === "—") return 0;
  return s.length;
}

function matchConfidenceRank(r: Row): number {
  const c = String(r.matchConfidence ?? "").toLowerCase();
  if (c === "high") return 3;
  if (c === "medium") return 2;
  if (c === "low") return 1;
  return 0;
}

function sortRowsForDisplay(rows: Row[]): Row[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    const addrA = registeredAddressStrength(a);
    const addrB = registeredAddressStrength(b);
    const hasA = addrA > 0;
    const hasB = addrB > 0;
    if (hasA !== hasB) return hasA ? -1 : 1;
    if (addrA !== addrB) return addrB - addrA;
    const mc = matchConfidenceRank(b) - matchConfidenceRank(a);
    if (mc !== 0) return mc;
    const ia = Number(a.subsidiaryRowIndex ?? 0);
    const ib = Number(b.subsidiaryRowIndex ?? 0);
    return ia - ib;
  });
  return copy;
}

export function OpenCorporatesAddressFinderPanel({ ticker }: { ticker: string }) {
  const tk = ticker.trim().toUpperCase();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgIsError, setMsgIsError] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const apiBase = useMemo(
    () => `/api/companies/${encodeURIComponent(tk)}/opencorporates-address-finder`,
    [tk]
  );

  const load = useCallback(async () => {
    if (!tk) return;
    try {
      const res = await fetch(apiBase, { credentials: "same-origin" });
      const j = (await res.json().catch(() => ({}))) as { results?: Row[] };
      if (res.ok && Array.isArray(j.results)) setRows(j.results);
    } catch {
      /** ignore — GET errors surfaced when user runs POST */
    }
  }, [tk, apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (forceRefresh: boolean) => {
      if (!tk) return;
      setBusy(true);
      setMsg(null);
      setMsgIsError(false);
      try {
        const res = await fetch(apiBase, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forceRefresh, maxCacheAgeDays: 7 }),
        });
        const rawText = await res.text();
        let j: {
          ok?: boolean;
          error?: string;
          stats?: { subsidiaries?: number; source?: string };
          results?: Row[];
        } = {};
        try {
          j = JSON.parse(rawText) as typeof j;
        } catch {
          throw new Error(rawText.trim().slice(0, 300) || `HTTP ${res.status} (non-JSON response)`);
        }
        if (!res.ok || j.ok !== true) {
          throw new Error(j.error || `Request failed (${res.status})`);
        }
        setMsg(`Processed ${j.stats?.subsidiaries ?? "—"} subsidiaries via GLEIF API (LEI search).`);
        setMsgIsError(false);
        if (Array.isArray(j.results)) setRows(j.results);
        await load();
      } catch (e) {
        const text = e instanceof Error ? e.message : "Run failed";
        setMsg(text);
        setMsgIsError(true);
      } finally {
        setBusy(false);
      }
    },
    [tk, apiBase, load]
  );

  /** Fixed layout keeps column proportions stable across tickers (same % regardless of cell content). */
  const tableShell =
    "w-full min-w-[820px] table-fixed border-collapse text-left text-[11px] text-[var(--text)]";

  const displayRows = useMemo(() => sortRowsForDisplay(rows), [rows]);

  return (
    <div className="space-y-3 border-b border-[var(--border)]/60 pb-4 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted2)]">
          GLEIF / LEI Address Results
        </span>
      </div>
      <p className="text-[10px] text-[var(--muted)]">
        Reads Exhibit 21 from your Public Records profile and queries the public{" "}
        <a className="underline" href="https://www.gleif.org/en/lei-data/gleif-lei-look-up-api/access-the-api" target="_blank" rel="noreferrer">
          GLEIF API
        </a>{" "}
        for LEIs and legal addresses (~80% match after normalizing names).         Rows with an address sort first;
        entities without an LEI are skipped. Rate limits apply. Long lists may
        take several minutes; leave this tab open. For U.S. domiciles, State SoS opens that state&apos;s
        business search (Delaware and Florida include the entity name in the URL; others use the official
        portal—hover for details).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !tk}
          onClick={() => void run(false)}
          className="rounded border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
          style={{ borderColor: "var(--accent)", background: "var(--accent)", color: "var(--bg)" }}
        >
          {busy ? "Running…" : "Find Addresses with GLEIF"}
        </button>
        <button
          type="button"
          disabled={busy || !tk}
          onClick={() => void run(true)}
          className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-[11px] font-semibold text-[var(--muted)] disabled:opacity-50"
        >
          Force refresh (ignore cache)
        </button>
        {msg ? (
          <span
            className={`max-w-[min(520px,85vw)] text-[11px] leading-snug ${msgIsError ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}
          >
            {msg}
          </span>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--card)]/40">
          <table className={tableShell}>
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[8%]" />
              <col className="w-[21%]" />
              <col className="w-[33%]" />
              <col className="w-[6%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--border)] text-[9px] uppercase text-[var(--muted2)]">
                <th className="min-w-0 py-1 pr-2 pl-2">Exhibit 21 name</th>
                <th className="min-w-0 px-1 py-1 text-center">Exhibit jur.</th>
                <th className="min-w-0 py-1 pl-2 pr-2">GLEIF name</th>
                <th className="min-w-0 py-1 pr-2">Registered address</th>
                <th className="min-w-0 py-1 pr-5 text-center">OpenCorporates</th>
                <th className="min-w-0 py-1 pl-3 pr-2 text-center">State SoS</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r) => {
                const ocHref = buildOpenCorporatesWebUrl(r);
                const sos = buildStateSosSearchUrl(r);
                return (
                  <tr key={String(r.id ?? r.subsidiaryRowIndex)} className="border-b border-[var(--border)]/60 align-top">
                    <td className="min-w-0 py-1 pr-2 pl-2 break-words whitespace-pre-wrap">
                      {String(r.exhibitLegalName ?? "")}
                    </td>
                    <td className="min-w-0 px-1 py-1 pr-3 text-center align-top text-[10px] leading-tight">
                      <span className="inline-block max-w-full truncate align-middle" title={String(r.exhibitJurisdiction ?? "")}>
                        {String(r.exhibitJurisdiction ?? "—")}
                      </span>
                    </td>
                    <td className="min-w-0 py-1 pl-1 pr-2 break-words whitespace-pre-wrap">{String(r.matchedName ?? "—")}</td>
                    <td className="min-w-0 py-1 pr-2 text-[10px] leading-snug break-words whitespace-pre-wrap">
                      {String(r.registeredAddress ?? "—")}
                    </td>
                    <td className="min-w-0 py-1 pr-5 text-center align-top">
                      {ocHref ? (
                        <a className="underline" href={ocHref} target="_blank" rel="noreferrer">
                          link
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="min-w-0 py-1 pl-3 pr-2 text-center align-top">
                      {sos ? (
                        <a className="underline" href={sos.href} target="_blank" rel="noreferrer" title={sos.label}>
                          link
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[10px] text-[var(--muted)]">No GLEIF results yet — run the finder after saving Exhibit 21 on the profile.</p>
      )}
    </div>
  );
}
