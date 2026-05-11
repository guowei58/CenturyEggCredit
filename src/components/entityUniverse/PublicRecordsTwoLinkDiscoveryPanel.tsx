"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  readEntityUniverseBootstrapSessionCache,
  writeEntityUniverseBootstrapSessionCache,
} from "@/lib/entityUniverse/entityUniverseBootstrapSessionCache";
import type { TaxLienSourceMatrixRow } from "@/lib/taxLien/taxLienMatrixShared";
import { usStateAbbrFromText } from "@/lib/usStates";
import { getStateCapability } from "@/lib/ucc/stateCapabilityRegistry";

type Row = Record<string, unknown>;

export type TwoLinkStep = { step: number; label: string; hint: string; url: string };
export type TwoLinkStatePayload = {
  stateName: string;
  primaryUrl: string;
  secondaryUrl: string;
  steps: TwoLinkStep[];
};

const base = (ticker: string) => `/api/companies/${encodeURIComponent(ticker.trim().toUpperCase())}/entity-universe`;

export function PublicRecordsTwoLinkDiscoveryPanel({
  ticker,
  companyName,
  issuerStateOfIncorporation,
  title,
  matrix,
}: {
  ticker: string;
  companyName?: string;
  issuerStateOfIncorporation?: string | null;
  title: string;
  matrix: Record<string, TwoLinkStatePayload>;
}) {
  const tk = ticker.trim().toUpperCase();
  const useBootstrapSessionCache = true;

  const matrixByAbbr = useMemo(() => {
    const m = new Map<string, TwoLinkStatePayload>();
    for (const [abbr, payload] of Object.entries(matrix)) {
      m.set(abbr.trim().toUpperCase(), payload);
    }
    return m;
  }, [matrix]);

  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Record<string, Row[]>>({});
  const [entityIntelProfile, setEntityIntelProfile] = useState<Row | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshBtnClass =
    "rounded border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold transition hover:border-[var(--accent)]/70 hover:bg-[rgba(0,212,170,0.06)] disabled:cursor-not-allowed disabled:opacity-45";

  const load = useCallback(
    async (forceRefresh?: boolean) => {
      if (!tk) return;
      if (useBootstrapSessionCache && !forceRefresh) {
        const snap = readEntityUniverseBootstrapSessionCache(tk);
        if (snap) {
          setEntityIntelProfile((snap.entityIntelProfile as Row | null) ?? null);
          setData(snap.data as Record<string, Row[]>);
          setLoadError(null);
          return;
        }
      }
      setBusy(true);
      try {
        const res = await fetch(`${base(tk)}/bootstrap`, { credentials: "same-origin" });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          let detail = t.trim().slice(0, 500);
          try {
            const ej = JSON.parse(t) as { error?: string; hint?: string };
            if (typeof ej.error === "string") {
              detail = ej.error + (typeof ej.hint === "string" ? ` — ${ej.hint}` : "");
            }
          } catch {
            /** keep raw snippet */
          }
          setLoadError(`Could not load affiliate discovery data (${res.status}). ${detail}`);
          return;
        }
        setLoadError(null);
        const j = (await res.json()) as Record<string, unknown>;
        const intel = j.entityIntelligenceProfile;
        const intelProfile =
          intel && typeof intel === "object" && !Array.isArray(intel) ? (intel as Row) : null;
        const taxRows = Array.isArray(j.taxLienStateSources) ? (j.taxLienStateSources as TaxLienSourceMatrixRow[]) : [];
        const nextData = {
          exhibit21Subsidiaries: (j.exhibit21Subsidiaries as Row[]) ?? [],
          uccStateAggregation: (j.uccStateAggregation as Row[]) ?? [],
          uccDebtorCandidates: (j.uccDebtorCandidates as Row[]) ?? [],
          uccSearchResults: (j.uccSearchResults as Row[]) ?? [],
          uccManualSearchTasks: (j.uccManualSearchTasks as Row[]) ?? [],
          uccCreditDocumentMatches: (j.uccCreditDocumentMatches as Row[]) ?? [],
          uccDiscoveredEntityCandidates: (j.uccDiscoveredEntityCandidates as Row[]) ?? [],
          masterRows: (j.masterRows as Row[]) ?? [],
        };
        setEntityIntelProfile(intelProfile);
        setData(nextData);
        writeEntityUniverseBootstrapSessionCache(tk, {
          entityIntelProfile: intelProfile,
          taxLienStateSources: taxRows,
          data: nextData as unknown as Record<string, unknown[]>,
        });
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load affiliate discovery data.");
      } finally {
        setBusy(false);
      }
    },
    [tk]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const subsidiariesByUsState = useMemo(() => {
    const rows = (data.exhibit21Subsidiaries ?? []) as Row[];
    const parent = String(companyName ?? "").trim();
    const intel = entityIntelProfile;
    const parentState =
      usStateAbbrFromText(String(intel?.stateOfIncorporation ?? "").trim()) ??
      usStateAbbrFromText(String(intel?.hqState ?? "").trim()) ??
      usStateAbbrFromText(String(issuerStateOfIncorporation ?? "").trim());
    const by = new Map<string, { state: string; names: string[] }>();
    for (const r of rows) {
      const name = String((r.entityName ?? r.exhibitLegalName ?? r.exhibit21Name ?? "")).trim();
      const rawJur = String(r.state ?? r.jurisdiction ?? r.exhibitJurisdiction ?? "").trim();
      const st = usStateAbbrFromText(rawJur) ?? "";
      if (!st) continue;
      const curr = by.get(st) ?? { state: st, names: [] };
      if (name) curr.names.push(name);
      by.set(st, curr);
    }
    if (parent && parentState && !by.has(parentState)) {
      by.set(parentState, { state: parentState, names: [] });
    }
    return [...by.values()]
      .map((v) => {
        const uniq = Array.from(new Set(v.names.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean)));
        uniq.sort((a, b) => a.localeCompare(b));
        let names = uniq;
        if (parent && parentState && v.state === parentState) {
          names = [parent, ...uniq.filter((n) => n !== parent)];
        }
        return { state: v.state, names, count: names.length };
      })
      .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
  }, [data.exhibit21Subsidiaries, entityIntelProfile, companyName, issuerStateOfIncorporation]);

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`Copied: ${text}`);
      window.setTimeout(() => setCopyMsg(null), 1200);
    } catch {
      setCopyMsg("Copy failed (clipboard blocked).");
      window.setTimeout(() => setCopyMsg(null), 1500);
    }
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className={refreshBtnClass} style={{ color: "var(--text)" }} disabled={busy} onClick={() => void load(true)}>
          Refresh
        </button>
        {busy ? <div className="text-[11px] text-[var(--muted)]">Working…</div> : null}
      </div>
      {loadError ? <div className="text-[10px] leading-snug text-[var(--danger)]">{loadError}</div> : null}

      <div className="space-y-2">
        {copyMsg ? (
          <div className="text-xs" style={{ color: "var(--muted2)" }}>
            {copyMsg}
          </div>
        ) : null}

        {subsidiariesByUsState.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            No Exhibit 21 subsidiaries with a US state domicile yet.
          </div>
        ) : busy ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Loading subsidiary data…
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {subsidiariesByUsState.map((r) => {
              const cap = getStateCapability(r.state);
              const fullState = cap.state_name;
              const n = r.names.length;
              const payload = matrixByAbbr.get(r.state);
              const steps = payload?.steps?.length ? payload.steps : null;
              return (
                <section
                  key={r.state}
                  className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-5 shadow-sm md:px-5 md:py-6 text-sm leading-relaxed"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                    <h3 className="text-base font-semibold tracking-tight" style={{ color: "var(--text)" }}>
                      {fullState}
                    </h3>
                    <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs" style={{ color: "var(--muted)" }}>
                      <span>
                        {n} {n === 1 ? "entity" : "entities"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                    {steps ? (
                      <div className="space-y-3">
                        <p className="font-medium" style={{ color: "var(--text)" }}>
                          {title} — {steps.length} steps
                        </p>
                        <ol className="list-decimal space-y-3 pl-5 [text-align:start]">
                          {steps.map((s) => (
                            <li key={`${r.state}-${title}-${s.step}`} className="pl-1 marker:font-semibold">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-x-4">
                                <div className="min-w-0 flex-1">
                                  <span className="font-semibold" style={{ color: "var(--text)" }}>
                                    {s.label}
                                  </span>
                                  {s.hint ? (
                                    <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--muted)" }}>
                                      {s.hint}
                                    </p>
                                  ) : null}
                                </div>
                                {s.url.startsWith("http") ? (
                                  <div className="flex w-full shrink-0 flex-col items-end sm:w-auto sm:max-w-[min(100%,36rem)]">
                                    <a
                                      href={s.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex shrink-0 rounded bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-fg)] transition hover:opacity-90"
                                    >
                                      Open
                                    </a>
                                    <div className="mt-1.5 w-full max-w-full break-all text-right text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
                                      {s.url}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : (
                      <div className="text-[11px]" style={{ color: "var(--muted2)" }}>
                        No matrix row for this state.
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted2)" }}>
                      Entities
                    </p>
                  </div>
                  <div className="my-3 border-b border-dashed" style={{ borderColor: "var(--border)" }} aria-hidden />
                  <ul className="space-y-2">
                    {r.names.map((nm, i) => (
                      <li key={`${r.state}-${title}-n-${i}-${nm}`} className="flex items-start justify-between gap-6">
                        <span className="min-w-0 flex-1 break-words" style={{ color: "var(--text)" }}>
                          {nm}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 rounded border px-2 py-1 text-[11px] font-semibold transition hover:opacity-90"
                          style={{
                            borderColor: "var(--border2)",
                            background: "color-mix(in srgb, var(--card2) 65%, var(--card))",
                            color: "var(--text)",
                          }}
                          onClick={() => void copyText(nm)}
                        >
                          Copy
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

