"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { ManualSubsidiaryEntryPanel } from "@/components/entityUniverse/ManualSubsidiaryEntryPanel";
import { OpenCorporatesAddressFinderPanel } from "@/components/entityUniverse/OpenCorporatesAddressFinderPanel";
import { usStateAbbrFromText } from "@/lib/usStates";
import { uccPortalUrlForState } from "@/lib/ucc/portals";
import { getStateCapability } from "@/lib/ucc/stateCapabilityRegistry";
import {
  readEntityUniverseBootstrapSessionCache,
  writeEntityUniverseBootstrapSessionCache,
} from "@/lib/entityUniverse/entityUniverseBootstrapSessionCache";
import type { TaxLienSourceMatrixRow } from "@/lib/taxLien/taxLienMatrixShared";
import { matrixUccSearchUrl, taxLienMatrixTripleLinkSlots } from "@/lib/taxLien/taxLienMatrixShared";

type Row = Record<string, unknown>;

/** Live Public Records Profile subsidiary inputs (same ticker) — avoids waiting for autosave before Exhibit 21 syncs server-side. */
export type EntityUniversePublicRecordsSubsidiaries = {
  subsidiaryExhibit21Snapshot: unknown;
  subsidiaryNames: string[];
  subsidiaryDomiciles: string[];
};

const base = (ticker: string) => `/api/companies/${encodeURIComponent(ticker.trim().toUpperCase())}/entity-universe`;

const AFFILIATE_SOURCE_PANELS = [
  { id: "ex21", label: "Exhibit 21 Subsidiaries" },
  { id: "ucc", label: "UCC Manual Search" },
  { id: "tax_liens", label: "Tax Liens & Releases" },
  { id: "manual_subsidiaries", label: "Add subsidiaries Manually" },
] as const;

type AffiliateTabId = (typeof AFFILIATE_SOURCE_PANELS)[number]["id"];

export function EntityUniverseAffiliateDiscoveryPage({
  ticker,
  companyName,
  publicRecordsProfileSubsidiaries,
  issuerStateOfIncorporation,
  initialTab,
  allowedTabs,
  cacheBootstrapAcrossTabs,
}: {
  ticker: string;
  companyName?: string;
  /** When embedded in Public Records Tab, mirrors the exhibit grid / subsidiary table from draft state. */
  publicRecordsProfileSubsidiaries?: EntityUniversePublicRecordsSubsidiaries | null;
  /** Public registrant / issuer state of incorporation (e.g. from Public Records profile) when entity intel is sparse. */
  issuerStateOfIncorporation?: string | null;
  /** Default selected panel (useful when embedding in category tabs). */
  initialTab?: AffiliateTabId;
  /** When provided, only show these source panels (in the default order). */
  allowedTabs?: AffiliateTabId[];
  /**
   * Public Records UCC / Tax Liens single-tab embeds: keep last bootstrap in session memory so leaving
   * and re-entering the category does not refetch until Refresh.
   */
  cacheBootstrapAcrossTabs?: boolean;
}) {
  const tk = ticker.trim().toUpperCase();
  const useBootstrapSessionCache = Boolean(cacheBootstrapAcrossTabs);
  const [busy, setBusy] = useState(false);
  const [affiliateTab, setAffiliateTab] = useState<AffiliateTabId>(initialTab ?? "ex21");
  const [data, setData] = useState<Record<string, Row[]>>({});
  const [entityIntelProfile, setEntityIntelProfile] = useState<Row | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taxLienStateSources, setTaxLienStateSources] = useState<TaxLienSourceMatrixRow[]>([]);

  const refreshBtnClass =
    "rounded border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold transition hover:border-[var(--accent)]/70 hover:bg-[rgba(0,212,170,0.06)] disabled:cursor-not-allowed disabled:opacity-45";
  const showUccTaxRefresh = affiliateTab === "ucc" || affiliateTab === "tax_liens";

  const load = useCallback(
    async (forceRefresh?: boolean) => {
      if (!tk) return;
      if (useBootstrapSessionCache && !forceRefresh) {
        const snap = readEntityUniverseBootstrapSessionCache(tk);
        if (snap) {
          setEntityIntelProfile((snap.entityIntelProfile as Row | null) ?? null);
          setTaxLienStateSources(snap.taxLienStateSources);
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
        setTaxLienStateSources(taxRows);
        setData(nextData);
        if (useBootstrapSessionCache) {
          writeEntityUniverseBootstrapSessionCache(tk, {
            entityIntelProfile: intelProfile,
            taxLienStateSources: taxRows,
            data: nextData as unknown as Record<string, unknown[]>,
          });
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load affiliate discovery data.");
      } finally {
        setBusy(false);
      }
    },
    [tk, useBootstrapSessionCache]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const userAddedMasterRows = useMemo(() => {
    const rows = data.masterRows ?? [];
    return rows.filter((r) => String(r.primarySourceCategory ?? "") === "user_added");
  }, [data.masterRows]);

  const uccStateAgg = data.uccStateAggregation ?? [];
  const ucc = data.uccDebtorCandidates ?? [];
  const uccResults = data.uccSearchResults ?? [];
  const uccManual = data.uccManualSearchTasks ?? [];
  const uccCdMatches = data.uccCreditDocumentMatches ?? [];
  const uccDiscovered = data.uccDiscoveredEntityCandidates ?? [];
  const taxLienSourcesByAbbr = useMemo(() => {
    const m = new Map<string, TaxLienSourceMatrixRow>();
    for (const r of taxLienStateSources) {
      const row = r as TaxLienSourceMatrixRow & { Abbrev?: string };
      const ab = String(row.abbr ?? row.Abbrev ?? "").trim().toUpperCase();
      if (ab) m.set(ab, r);
    }
    return m;
  }, [taxLienStateSources]);

  /** Exhibit 21 subsidiaries grouped by US formation state — shared by UCC & tax lien manual panels. */
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

  const visiblePanels = useMemo(() => {
    const allow = Array.isArray(allowedTabs) && allowedTabs.length ? new Set(allowedTabs) : null;
    const list = allow ? AFFILIATE_SOURCE_PANELS.filter((p) => allow.has(p.id)) : AFFILIATE_SOURCE_PANELS;
    // If current tab is filtered out, fall back to first visible tab.
    if (!list.some((p) => p.id === affiliateTab)) {
      const next = list[0]?.id ?? "ex21";
      setAffiliateTab(next);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedTabs, affiliateTab]);

  const pillBtn =
    "rounded border border-[var(--accent)]/45 bg-transparent px-2 py-1.5 text-left text-[11px] whitespace-nowrap text-[var(--muted)] hover:border-[var(--accent)]/80 hover:bg-[rgba(0,212,170,0.08)] hover:text-[var(--text)]";
  const pillActive = "border-[var(--accent)] bg-[rgba(0,212,170,0.14)] text-[var(--text)] font-medium";

  const showTabStrip = visiblePanels.length > 1;

  return (
    <div className="flex flex-col gap-3">
      {showTabStrip ? (
        <Card className="space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="tablist"
              aria-label="Affiliate discovery sources"
              className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto pb-px [scrollbar-width:thin]"
            >
              {visiblePanels.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={affiliateTab === id}
                  className={`shrink-0 ${pillBtn} ${affiliateTab === id ? pillActive : ""}`}
                  onClick={() => {
                    setAffiliateTab(id);
                    if (id === "ex21" || id === "manual_subsidiaries") void load();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-right">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {showUccTaxRefresh ? (
                  <button
                    type="button"
                    className={refreshBtnClass}
                    style={{ color: "var(--text)" }}
                    disabled={busy}
                    onClick={() => void load(true)}
                  >
                    Refresh
                  </button>
                ) : null}
                {busy ? <div className="text-[11px] text-[var(--muted)]">Working…</div> : null}
              </div>
              {loadError ? (
                <div className="max-w-[min(420px,70vw)] text-[10px] leading-snug text-[var(--danger)]">{loadError}</div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="space-y-2 p-3">
        {!showTabStrip && (showUccTaxRefresh || busy) ? (
          <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
            {showUccTaxRefresh ? (
              <button
                type="button"
                className={refreshBtnClass}
                style={{ color: "var(--text)" }}
                disabled={busy}
                onClick={() => void load(true)}
              >
                Refresh
              </button>
            ) : null}
            {busy ? <div className="text-[11px] text-[var(--muted)]">Working…</div> : null}
          </div>
        ) : null}
        {affiliateTab === "ex21" ? (
          <OpenCorporatesAddressFinderPanel ticker={tk} />
        ) : affiliateTab === "ucc" ? (
          <div className="space-y-4">
            {copyMsg ? <div className="text-xs" style={{ color: "var(--muted2)" }}>{copyMsg}</div> : null}

            {subsidiariesByUsState.length === 0 ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                No Exhibit 21 subsidiaries with a US state domicile yet.
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {subsidiariesByUsState.map((r) => {
                  const matrix = taxLienSourcesByAbbr.get(r.state);
                  const href = matrixUccSearchUrl(matrix) ?? uccPortalUrlForState(r.state);
                  const cap = getStateCapability(r.state);
                  const fullState = cap.state_name;
                  const n = r.names.length;
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
                      <div className="mt-2 flex flex-col gap-3 text-xs sm:flex-row sm:items-start sm:gap-x-6" style={{ color: "var(--muted)" }}>
                        <span className="min-w-0 flex-1">
                          UCC search for subsidiary debtors ({fullState}). Use <strong>Copy</strong> next to each name, then paste into
                          the portal’s debtor search where available.
                        </span>
                        <div className="flex w-full shrink-0 flex-col items-end text-right sm:w-auto sm:max-w-[min(100%,36rem)]">
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex rounded bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-fg)] transition hover:opacity-90"
                          >
                            Open Portal
                          </a>
                          <div className="mt-2 w-full max-w-full break-all text-right text-[11px] leading-snug" style={{ color: "var(--muted2)" }}>
                            {href}
                          </div>
                        </div>
                      </div>
                      <div className="mt-6 flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted2)" }}>
                          Entities
                        </p>
                      </div>
                      <div className="my-3 border-b border-dashed" style={{ borderColor: "var(--border)" }} aria-hidden />
                      <ul className="space-y-2">
                        {r.names.map((nm, i) => (
                          <li key={`${r.state}-${i}-${nm}`} className="flex items-start justify-between gap-6">
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
        ) : affiliateTab === "tax_liens" ? (
          <div className="space-y-4">
            {copyMsg ? <div className="text-xs" style={{ color: "var(--muted2)" }}>{copyMsg}</div> : null}

            {subsidiariesByUsState.length === 0 ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                No Exhibit 21 subsidiaries with a US state domicile yet.
              </div>
            ) : busy ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Loading tax lien sources…
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {subsidiariesByUsState.map((r) => {
                  const cap = getStateCapability(r.state);
                  const fullState = cap.state_name;
                  const n = r.names.length;
                  const matrix = taxLienSourcesByAbbr.get(r.state);
                  const tripleLinks = taxLienMatrixTripleLinkSlots(matrix ?? null);
                  const fiveSteps = matrix?.searchSteps?.length ? matrix.searchSteps : null;
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
                        {fiveSteps ? (
                          <div className="space-y-3">
                            <p className="font-medium" style={{ color: "var(--text)" }}>
                              Tax lien search — 4 steps
                            </p>
                            <ol className="list-decimal space-y-3 pl-5 [text-align:start]">
                              {fiveSteps.map((s) => (
                                <li key={`${r.state}-step-${s.step}`} className="pl-1 marker:font-semibold">
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
                            {matrix?.supplementalUrls?.length ? (
                              <div className="rounded border border-[var(--border)]/60 px-2.5 py-2 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
                                <span className="font-semibold" style={{ color: "var(--muted)" }}>
                                  Also check:{" "}
                                </span>
                                {matrix.supplementalUrls.map((u, i) => (
                                  <span key={`${r.state}-sup-${i}`}>
                                    {i > 0 ? " · " : null}
                                    <a href={u} target="_blank" rel="noreferrer" className="break-all underline decoration-[var(--border)] underline-offset-2 hover:text-[var(--text)]">
                                      {u}
                                    </a>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {matrix?.stateTaxLienRoute || matrix?.federalTaxLienRoute ? (
                              <div className="space-y-1 border-t border-[var(--border)]/50 pt-3 text-[11px] leading-snug" style={{ color: "var(--muted)" }}>
                                {matrix.stateTaxLienRoute ? (
                                  <p>
                                    <span className="font-semibold" style={{ color: "var(--text)" }}>
                                      State / local:{" "}
                                    </span>
                                    {matrix.stateTaxLienRoute}
                                  </p>
                                ) : null}
                                {matrix.federalTaxLienRoute ? (
                                  <p>
                                    <span className="font-semibold" style={{ color: "var(--text)" }}>
                                      Federal NFTL / release:{" "}
                                    </span>
                                    {matrix.federalTaxLienRoute}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            <p className="mb-2 font-medium" style={{ color: "var(--text)" }}>
                              Tax lien matrix — quick links
                            </p>
                            <div className="flex w-full flex-col items-end gap-3">
                              {tripleLinks.map((slot) => (
                                <div
                                  key={`${r.state}-${slot.label}`}
                                  className="flex w-full flex-col items-end sm:max-w-[min(100%,36rem)]"
                                >
                                  {slot.url.startsWith("http") ? (
                                    <>
                                      <a
                                        href={slot.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex rounded bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-fg)] transition hover:opacity-90"
                                      >
                                        {slot.label}
                                      </a>
                                      <div className="mt-2 w-full max-w-full break-all text-right text-[11px] leading-snug" style={{ color: "var(--muted2)" }}>
                                        {slot.url}
                                      </div>
                                    </>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      {matrix ? (
                        <div className="mt-4 space-y-2 text-[12px]" style={{ color: "var(--muted)" }}>
                          {!fiveSteps && matrix.stateTaxLienRoute ? (
                            <p>
                              <span className="font-semibold" style={{ color: "var(--text)" }}>
                                State lien route:{" "}
                              </span>
                              {matrix.stateTaxLienRoute}
                            </p>
                          ) : null}
                          {!fiveSteps && matrix.federalTaxLienRoute ? (
                            <p>
                              <span className="font-semibold" style={{ color: "var(--text)" }}>
                                Federal lien route:{" "}
                              </span>
                              {matrix.federalTaxLienRoute}
                            </p>
                          ) : null}
                          {!fiveSteps && matrix.implementationNotes ? (
                            <p>
                              <span className="font-semibold" style={{ color: "var(--text)" }}>
                                Notes:{" "}
                              </span>
                              {matrix.implementationNotes}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="mt-6 flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted2)" }}>
                          Entities
                        </p>
                      </div>
                      <div className="my-3 border-b border-dashed" style={{ borderColor: "var(--border)" }} aria-hidden />
                      <ul className="space-y-2">
                        {r.names.map((nm, i) => (
                          <li key={`${r.state}-tax-${i}-${nm}`} className="flex items-start justify-between gap-6">
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
        ) : (
          <ManualSubsidiaryEntryPanel ticker={tk} savedRows={userAddedMasterRows} onSaved={() => void load(true)} />
        )}
      </Card>
    </div>
  );
}
