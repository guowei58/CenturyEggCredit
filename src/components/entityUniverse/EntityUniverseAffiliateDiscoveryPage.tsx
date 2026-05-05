"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import {
  ENTITY_UNIVERSE_ADDRESS_NOTE,
  ENTITY_UNIVERSE_SOS_NOTE,
  ENTITY_UNIVERSE_UCC_NOTE,
} from "@/components/entityUniverse/entityUniverseCopy";
import { exhibit21UniverseMirrorFromProfileSubsidiaries } from "@/lib/entityUniverseExhibitMirror";
import { subsidiaryTableRowsFromSavedProfile } from "@/lib/publicRecordsSubsidiaryRows";
import { CreditDocEntityWorkflowPanel } from "@/components/entityUniverse/CreditDocEntityWorkflowPanel";

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
  { id: "credit", label: "Credit Document Subsidiaries" },
  { id: "ucc", label: "UCC Debtor Search Candidates" },
  { id: "sos", label: "Secretary of State Name-Family Searches" },
  { id: "addr", label: "Address-Cluster Searches" },
] as const;

type AffiliateTabId = (typeof AFFILIATE_SOURCE_PANELS)[number]["id"];

export function EntityUniverseAffiliateDiscoveryPage({
  ticker,
  companyName: _companyName,
  publicRecordsProfileSubsidiaries,
}: {
  ticker: string;
  companyName?: string;
  /** When embedded in Public Records Tab, mirrors the exhibit grid / subsidiary table from draft state. */
  publicRecordsProfileSubsidiaries?: EntityUniversePublicRecordsSubsidiaries | null;
}) {
  const tk = ticker.trim().toUpperCase();
  const [busy, setBusy] = useState(false);
  const [affiliateTab, setAffiliateTab] = useState<AffiliateTabId>("ex21");
  const [data, setData] = useState<Record<string, Row[]>>({});

  const load = useCallback(async () => {
    if (!tk) return;
    setBusy(true);
    try {
      const res = await fetch(`${base(tk)}/bootstrap`, { credentials: "same-origin" });
      if (!res.ok) return;
      const j = (await res.json()) as Record<string, unknown>;
      setData({
        exhibit21Subsidiaries: (j.exhibit21Subsidiaries as Row[]) ?? [],
        creditDocEntities: (j.creditDocEntities as Row[]) ?? [],
        uccDebtorCandidates: (j.uccDebtorCandidates as Row[]) ?? [],
        sosNameFamilyCandidates: (j.sosNameFamilyCandidates as Row[]) ?? [],
        addressClusterCandidates: (j.addressClusterCandidates as Row[]) ?? [],
      });
    } finally {
      setBusy(false);
    }
  }, [tk]);

  useEffect(() => {
    void load();
  }, [load]);

  const ex = useMemo(() => {
    const serverRows = data.exhibit21Subsidiaries ?? [];
    const cdNorm = new Set(
      (data.creditDocEntities ?? []).map((r) => String((r as { normalizedEntityName?: string }).normalizedEntityName ?? ""))
    );
    const uccNorm = new Set(
      (data.uccDebtorCandidates ?? []).map((r) => String((r as { normalizedDebtorName?: string }).normalizedDebtorName ?? ""))
    );

    if (publicRecordsProfileSubsidiaries) {
      const draftRows = subsidiaryTableRowsFromSavedProfile(
        publicRecordsProfileSubsidiaries.subsidiaryExhibit21Snapshot,
        publicRecordsProfileSubsidiaries.subsidiaryNames,
        publicRecordsProfileSubsidiaries.subsidiaryDomiciles
      );
      if (draftRows.length > 0) {
        return exhibit21UniverseMirrorFromProfileSubsidiaries(tk, draftRows, cdNorm, uccNorm) as Row[];
      }
    }
    return serverRows;
  }, [
    tk,
    data.creditDocEntities,
    data.uccDebtorCandidates,
    data.exhibit21Subsidiaries,
    publicRecordsProfileSubsidiaries,
  ]);

  const cd = data.creditDocEntities ?? [];
  const ucc = data.uccDebtorCandidates ?? [];
  const sos = data.sosNameFamilyCandidates ?? [];
  const addr = data.addressClusterCandidates ?? [];

  const tableShell = useMemo(
    () => "w-full border-collapse text-left text-[12px] text-[var(--text)]",
    []
  );

  const pillBtn =
    "rounded border border-[var(--accent)]/45 bg-transparent px-2 py-1.5 text-left text-[11px] whitespace-nowrap text-[var(--muted)] hover:border-[var(--accent)]/80 hover:bg-[rgba(0,212,170,0.08)] hover:text-[var(--text)]";
  const pillActive = "border-[var(--accent)] bg-[rgba(0,212,170,0.14)] text-[var(--text)] font-medium";

  return (
    <div className="flex flex-col gap-3">
      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Affiliate discovery sources"
            className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto pb-px [scrollbar-width:thin]"
          >
            {AFFILIATE_SOURCE_PANELS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={affiliateTab === id}
                className={`shrink-0 ${pillBtn} ${affiliateTab === id ? pillActive : ""}`}
                onClick={() => {
                  setAffiliateTab(id);
                  if (id === "ex21") void load();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {busy ? <div className="shrink-0 text-[11px] text-[var(--muted)]">Working…</div> : null}
        </div>
      </Card>

      <Card className="space-y-2 p-3">
        {affiliateTab === "ex21" ? (
          <div className="overflow-x-auto">
            <table className={tableShell}>
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
                  <th className="py-1 pr-2">Entity</th>
                  <th className="py-1 pr-2">Jurisdiction</th>
                  <th className="py-1 pr-2">Credit docs?</th>
                  <th className="py-1 pr-2">UCC?</th>
                </tr>
              </thead>
              <tbody>
                {ex.map((r) => (
                  <tr key={String(r.id)} className="border-b border-[var(--border)]/60">
                    <td className="py-1 pr-2">{String(r.entityName)}</td>
                    <td className="py-1 pr-2">{String(r.jurisdiction ?? "—")}</td>
                    <td className="py-1 pr-2">{r.appearsInCreditDocs ? "yes" : "—"}</td>
                    <td className="py-1 pr-2">{r.appearsInUccSearch ? "yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : affiliateTab === "credit" ? (
          <CreditDocEntityWorkflowPanel ticker={tk} />
        ) : affiliateTab === "ucc" ? (
          <>
            <p className="text-[11px] text-[var(--muted)]">{ENTITY_UNIVERSE_UCC_NOTE}</p>
            <div className="overflow-x-auto">
              <table className={tableShell}>
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
                    <th className="py-1 pr-2">Debtor</th>
                    <th className="py-1 pr-2">State</th>
                    <th className="py-1 pr-2">Filing id</th>
                    <th className="py-1 pr-2">Exhibit 21?</th>
                  </tr>
                </thead>
                <tbody>
                  {ucc.map((r) => (
                    <tr key={String(r.id)} className="border-b border-[var(--border)]/60">
                      <td className="py-1 pr-2">{String(r.debtorName)}</td>
                      <td className="py-1 pr-2">{String(r.state)}</td>
                      <td className="py-1 pr-2">{String(r.filingNumber ?? "—")}</td>
                      <td className="py-1 pr-2">{r.listedInExhibit21 ? "yes" : "not listed in Exhibit 21"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : affiliateTab === "sos" ? (
          <>
            <p className="text-[11px] text-[var(--muted)]">{ENTITY_UNIVERSE_SOS_NOTE}</p>
            <div className="overflow-x-auto">
              <table className={tableShell}>
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
                    <th className="py-1 pr-2">Candidate</th>
                    <th className="py-1 pr-2">State</th>
                    <th className="py-1 pr-2">Match term</th>
                    <th className="py-1 pr-2">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {sos.map((r) => (
                    <tr key={String(r.id)} className="border-b border-[var(--border)]/60">
                      <td className="py-1 pr-2">{String(r.candidateEntityName)}</td>
                      <td className="py-1 pr-2">{String(r.state)}</td>
                      <td className="py-1 pr-2">{String(r.matchedSearchTerm ?? "—")}</td>
                      <td className="py-1 pr-2">{String(r.reviewStatus).replace(/_/g, " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] text-[var(--muted)]">{ENTITY_UNIVERSE_ADDRESS_NOTE}</p>
            <div className="overflow-x-auto">
              <table className={tableShell}>
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
                    <th className="py-1 pr-2">Candidate</th>
                    <th className="py-1 pr-2">Address</th>
                    <th className="py-1 pr-2">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {addr.map((r) => (
                    <tr key={String(r.id)} className="border-b border-[var(--border)]/60">
                      <td className="py-1 pr-2">{String(r.candidateEntityName)}</td>
                      <td className="py-1 pr-2 max-w-[220px] whitespace-pre-wrap">{String(r.matchedAddress)}</td>
                      <td className="py-1 pr-2">{String(r.addressType).replace(/_/g, " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
