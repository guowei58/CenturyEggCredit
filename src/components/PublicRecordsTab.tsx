"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Card } from "@/components/ui";
import {
  PUBLIC_RECORD_CATEGORY_DESCRIPTIONS,
  PUBLIC_RECORD_CATEGORY_LABELS,
  PUBLIC_RECORD_CATEGORIES_ORDER,
  TAX_LIEN_DISCLAIMER,
  UCC_DISCLAIMER,
  REAL_ESTATE_DISCLAIMER,
} from "@/lib/publicRecordsConstants";
import { generatePublicRecordsSearchTerms } from "@/lib/generatePublicRecordsSearchTerms";
import { mergePublicRecordsSecPrefill } from "@/lib/mergePublicRecordsSecPrefill";
import type { PublicRecordsSecPrefill } from "@/lib/publicRecordsSecPrefillTypes";
import {
  deriveSubsidiarySearchNamesFromGrid,
  normalizeExhibit21MisalignedEntityColumn,
  parseExhibit21GridSnapshot,
  type Exhibit21GridSnapshotV1,
} from "@/lib/exhibit21GridSnapshot";
import { splitSubsidiaryLine } from "@/lib/exhibit21SubsidiaryRows";
import { subsidiaryRowsFromProfileArrays } from "@/lib/publicRecordsSubsidiaryRows";
import type { PublicRecordCategory } from "@/generated/prisma/client";
import { EntityUniverseAffiliateDiscoveryPage, type EntityUniversePublicRecordsSubsidiaries } from "@/components/entityUniverse/EntityUniverseAffiliateDiscoveryPage";

const AUTOSAVE_DEBOUNCE_MS = 900;

async function responseErrorDetail(res: Response): Promise<string> {
  try {
    const data = (await res.clone().json()) as { error?: string };
    if (typeof data?.error === "string" && data.error.trim()) return data.error.trim();
  } catch {
    try {
      const text = await res.text();
      if (text.length > 0 && text.length < 240) return text;
    } catch {
      /* noop */
    }
  }
  return `${res.status} ${res.statusText || "Error"}`;
}

function serializeProfileBody(draft: Partial<Profile>): string {
  return JSON.stringify({
    ...draft,
    legalNames: draft.legalNames ?? [],
    formerNames: draft.formerNames ?? [],
    subsidiaryNames: draft.subsidiaryNames ?? [],
    subsidiaryDomiciles: draft.subsidiaryDomiciles ?? [],
    subsidiaryExhibit21Snapshot: draft.subsidiaryExhibit21Snapshot ?? null,
  });
}

/**
 * When Exhibit 21 body rows have empty entity column but names/jurisdictions drifted right, shift into standard columns
 * and rebuild subsidiaryNames (matches server-side persist normalization).
 */
function withNormalizedExhibit21Snapshot(draft: Partial<Profile>): Partial<Profile> {
  const grid = parseExhibit21GridSnapshot(draft.subsidiaryExhibit21Snapshot ?? null);
  if (!grid) return draft;
  const aligned = normalizeExhibit21MisalignedEntityColumn(grid);
  if (JSON.stringify(aligned.rows) === JSON.stringify(grid.rows)) return draft;
  return {
    ...draft,
    subsidiaryExhibit21Snapshot: aligned,
    subsidiaryNames: deriveSubsidiarySearchNamesFromGrid(aligned),
    subsidiaryDomiciles: [],
  };
}

type Profile = {
  id: string;
  ticker: string;
  companyName: string | null;
  legalNames: string[];
  formerNames: string[];
  dbaNames: string[];
  subsidiaryNames: string[];
  subsidiaryDomiciles: string[];
  borrowerNames: string[];
  guarantorNames: string[];
  issuerNames: string[];
  restrictedSubsidiaryNames: string[];
  unrestrictedSubsidiaryNames: string[];
  parentCompanyNames: string[];
  operatingCompanyNames: string[];
  hqState: string | null;
  hqCounty: string | null;
  hqCity: string | null;
  principalExecutiveOfficeAddress: string | null;
  cik: string | null;
  irsEmployerIdentificationNumber: string | null;
  fiscalYearEnd: string | null;
  stateOfIncorporation: string | null;
  majorFacilityLocations: unknown;
  knownPropertyLocations: unknown;
  knownPermitJurisdictions: unknown;
  knownRegulatoryJurisdictions: unknown;
  subsidiaryExhibit21Snapshot?: unknown;
  notes: string | null;
};

type PublicRecordRow = {
  id: string;
  category: PublicRecordCategory;
  sourceKey: string | null;
  recordType: string | null;
  status: string;
  searchedEntityName: string | null;
  matchedEntityName: string | null;
  filingDate: string | null;
  amount: string | null;
  jurisdictionState: string | null;
  jurisdictionCounty: string | null;
  recordingNumber: string | null;
  caseNumber: string | null;
  permitNumber: string | null;
  riskLevel: string;
  confidence: string;
  documentUrl: string | null;
  notes: string | null;
};

type ChecklistRow = {
  id: string;
  sourceKey: string;
  category: PublicRecordCategory;
  status: string;
  notes: string | null;
  checkedAt: string | null;
};

type RegistryEntry = {
  id: string;
  category: PublicRecordCategory;
  sourceName: string;
  sourceUrl: string;
  jurisdictionName: string;
  state?: string;
  requiresLogin: boolean;
  hasFees: boolean;
  sourceKey: string;
};

type Recommended = {
  source: RegistryEntry;
  sourceKey: string;
  reason: string;
  priority: string;
  checklist: ChecklistRow | null;
};

function profileLikeForMerge(p: Profile | Partial<Profile> | null) {
  return {
    companyName: p?.companyName ?? null,
    legalNames: p?.legalNames ?? [],
    formerNames: p?.formerNames ?? [],
    subsidiaryNames: p?.subsidiaryNames ?? [],
    subsidiaryDomiciles: p?.subsidiaryDomiciles ?? [],
    subsidiaryExhibit21Snapshot: p?.subsidiaryExhibit21Snapshot ?? null,
    issuerNames: p?.issuerNames ?? [],
    hqState: p?.hqState ?? null,
    hqCounty: p?.hqCounty ?? null,
    hqCity: p?.hqCity ?? null,
    principalExecutiveOfficeAddress: p?.principalExecutiveOfficeAddress ?? null,
    cik: p?.cik ?? null,
    irsEmployerIdentificationNumber: p?.irsEmployerIdentificationNumber ?? null,
    fiscalYearEnd: p?.fiscalYearEnd ?? null,
    stateOfIncorporation: p?.stateOfIncorporation ?? null,
    notes: p?.notes ?? null,
  };
}

/** True when SEC-ingest fields are still blank — safe to auto-run ingest once on load. */
function isProfileSecEmpty(p: Profile | Partial<Profile> | null): boolean {
  if (!p) return true;
  const grid = parseExhibit21GridSnapshot(p.subsidiaryExhibit21Snapshot);
  if (grid?.rows.some((row) => row.some((cell) => cell.replace(/\s+/g, " ").trim().length >= 2))) return false;
  const hasSubs = (p.subsidiaryNames ?? []).some((s) => splitSubsidiaryLine(s).name.replace(/\s+/g, " ").trim().length >= 2);
  if (hasSubs) return false;
  if ((p.principalExecutiveOfficeAddress ?? "").trim()) return false;
  if ((p.hqState ?? "").trim()) return false;
  if ((p.stateOfIncorporation ?? "").trim()) return false;
  return true;
}

function applyMergeToProfile(merged: ReturnType<typeof mergePublicRecordsSecPrefill>, base: Profile | null, tickerSym: string): Profile {
  if (base) {
    return {
      ...base,
      companyName: merged.companyName ?? base.companyName,
      legalNames: merged.legalNames ?? base.legalNames,
      formerNames: merged.formerNames ?? base.formerNames,
      subsidiaryNames: merged.subsidiaryNames ?? base.subsidiaryNames,
      subsidiaryDomiciles: merged.subsidiaryDomiciles ?? base.subsidiaryDomiciles,
      subsidiaryExhibit21Snapshot:
        merged.subsidiaryExhibit21Snapshot !== undefined ? merged.subsidiaryExhibit21Snapshot : base.subsidiaryExhibit21Snapshot,
      issuerNames: merged.issuerNames ?? base.issuerNames,
      hqState: merged.hqState ?? base.hqState,
      hqCounty: merged.hqCounty ?? base.hqCounty,
      hqCity: merged.hqCity ?? base.hqCity,
      principalExecutiveOfficeAddress: merged.principalExecutiveOfficeAddress ?? base.principalExecutiveOfficeAddress,
      cik: merged.cik ?? base.cik ?? null,
      irsEmployerIdentificationNumber:
        merged.irsEmployerIdentificationNumber ?? base.irsEmployerIdentificationNumber ?? null,
      fiscalYearEnd: merged.fiscalYearEnd ?? base.fiscalYearEnd ?? null,
      stateOfIncorporation: merged.stateOfIncorporation ?? base.stateOfIncorporation,
      notes: merged.notes ?? base.notes,
    };
  }
  return {
    id: "",
    ticker: tickerSym,
    companyName: merged.companyName ?? null,
    legalNames: merged.legalNames ?? [],
    formerNames: merged.formerNames ?? [],
    dbaNames: [],
    subsidiaryNames: merged.subsidiaryNames ?? [],
    subsidiaryDomiciles: merged.subsidiaryDomiciles ?? [],
    subsidiaryExhibit21Snapshot:
      merged.subsidiaryExhibit21Snapshot !== undefined ? merged.subsidiaryExhibit21Snapshot : null,
    borrowerNames: [],
    guarantorNames: [],
    issuerNames: merged.issuerNames ?? [],
    restrictedSubsidiaryNames: [],
    unrestrictedSubsidiaryNames: [],
    parentCompanyNames: [],
    operatingCompanyNames: [],
    hqState: merged.hqState ?? null,
    hqCounty: merged.hqCounty ?? null,
    hqCity: merged.hqCity ?? null,
    principalExecutiveOfficeAddress: merged.principalExecutiveOfficeAddress ?? null,
    cik: merged.cik ?? null,
    irsEmployerIdentificationNumber: merged.irsEmployerIdentificationNumber ?? null,
    fiscalYearEnd: merged.fiscalYearEnd ?? null,
    stateOfIncorporation: merged.stateOfIncorporation ?? null,
    majorFacilityLocations: null,
    knownPropertyLocations: null,
    knownPermitJurisdictions: null,
    knownRegulatoryJurisdictions: null,
    notes: merged.notes ?? null,
  };
}

function subsidiaryRowsFromDraft(draft: Partial<Profile>): { name: string; domicile: string }[] {
  return subsidiaryRowsFromProfileArrays(draft.subsidiaryNames, draft.subsidiaryDomiciles);
}

function subsidiaryRowsToArrays(rows: { name: string; domicile: string }[]) {
  const subsidiaryNames: string[] = [];
  const subsidiaryDomiciles: string[] = [];
  for (const r of rows) {
    const nm = r.name.replace(/\s+/g, " ").trim();
    const dm = r.domicile.replace(/\s+/g, " ").trim();
    if (!nm && !dm) continue;
    subsidiaryNames.push(nm);
    subsidiaryDomiciles.push(dm);
  }
  return { subsidiaryNames, subsidiaryDomiciles };
}

function PublicRecordsProfileCard({
  loading,
  secBusy,
  profileDraft,
  setProfileDraft,
  onRefreshSec,
  ingestFeedback,
}: {
  loading: boolean;
  secBusy: boolean;
  profileDraft: Partial<Profile>;
  setProfileDraft: Dispatch<SetStateAction<Partial<Profile>>>;
  onRefreshSec: () => void;
  ingestFeedback: { kind: "ok" | "err"; text: string } | null;
}) {
  const exhibitGrid = useMemo(
    () => parseExhibit21GridSnapshot(profileDraft.subsidiaryExhibit21Snapshot),
    [profileDraft.subsidiaryExhibit21Snapshot]
  );

  const persistExhibitGrid = (snap: Exhibit21GridSnapshotV1) => {
    const aligned = normalizeExhibit21MisalignedEntityColumn(snap);
    setProfileDraft((p) => ({
      ...p,
      subsidiaryExhibit21Snapshot: aligned,
      subsidiaryNames: deriveSubsidiarySearchNamesFromGrid(aligned),
      subsidiaryDomiciles: [],
    }));
  };

  const updateGridCell = (rowIndex: number, colIndex: number, value: string) => {
    if (!exhibitGrid || rowIndex < 0 || rowIndex >= exhibitGrid.rows.length) return;
    const rows = exhibitGrid.rows.map((r, i) =>
      i === rowIndex ? r.map((c, j) => (j === colIndex ? value : c)) : [...r]
    );
    persistExhibitGrid({ ...exhibitGrid, rows });
  };

  const addGridRow = () => {
    const fallback: Exhibit21GridSnapshotV1 = {
      v: 1,
      hasHeaderRow: false,
      rows: [
        ["", ""],
        ["", ""],
      ],
      source: "text_lines",
    };
    const base = exhibitGrid ?? fallback;
    const w = Math.max(...base.rows.map((r) => r.length), 1);
    const normalized = base.rows.map((r) => {
      const o = [...r];
      while (o.length < w) o.push("");
      return o;
    });
    persistExhibitGrid({
      ...base,
      rows: [...normalized, Array.from({ length: w }, () => "")],
    });
  };

  const addGridColumn = () => {
    if (!exhibitGrid) {
      persistExhibitGrid({
        v: 1,
        hasHeaderRow: false,
        rows: [
          ["", ""],
          ["", ""],
        ],
        source: "text_lines",
      });
      return;
    }
    persistExhibitGrid({
      ...exhibitGrid,
      rows: exhibitGrid.rows.map((r) => [...r, ""]),
    });
  };

  const removeGridRow = (globalRowIndex: number) => {
    if (!exhibitGrid || exhibitGrid.rows.length < 2) return;
    if (exhibitGrid.hasHeaderRow && globalRowIndex === 0) return;
    persistExhibitGrid({
      ...exhibitGrid,
      rows: exhibitGrid.rows.filter((_, i) => i !== globalRowIndex),
    });
  };

  const updateSubRow = (i: number, field: "name" | "domicile", value: string) => {
    setProfileDraft((p) => {
      const rows = subsidiaryRowsFromDraft(p);
      while (rows.length <= i) rows.push({ name: "", domicile: "" });
      const next = rows.map((r, j) => (j === i ? { ...r, [field]: value } : r));
      return { ...p, ...subsidiaryRowsToArrays(next) };
    });
  };
  const addSubRow = () => {
    setProfileDraft((p) => {
      const names = [...(p.subsidiaryNames ?? [])];
      const doms = [...(p.subsidiaryDomiciles ?? [])];
      const len = Math.max(names.length, doms.length);
      while (names.length < len) names.push("");
      while (doms.length < len) doms.push("");
      names.push("");
      doms.push("");
      return { ...p, subsidiaryNames: names, subsidiaryDomiciles: doms };
    });
  };
  const removeSubRow = (i: number) => {
    setProfileDraft((p) => {
      let rows = subsidiaryRowsFromDraft(p);
      rows.splice(i, 1);
      if (rows.length === 0) rows = [{ name: "", domicile: "" }];
      return { ...p, ...subsidiaryRowsToArrays(rows) };
    });
  };

  return (
    <Card
      title="Public Records Profile"
      titleAside={
        <button
          type="button"
          disabled={loading || secBusy}
          onClick={onRefreshSec}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold normal-case tracking-normal text-[var(--accent-fg)] transition hover:opacity-90 disabled:opacity-50"
        >
          {secBusy ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      {ingestFeedback ? (
        <p
          className="mb-3 text-[10px] leading-snug"
          style={{ color: ingestFeedback.kind === "err" ? "var(--danger)" : "var(--muted)" }}
          role={ingestFeedback.kind === "err" ? "alert" : "status"}
        >
          {ingestFeedback.text}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[720px] text-[11px]" style={{ color: "var(--muted)" }}>
          Edit legal names, subsidiaries, and HQ geography. Arrays are one entry per line. Changes save automatically.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          Display / legal name
          <input
            className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-white placeholder:text-white/55 caret-white"
            value={profileDraft.companyName ?? ""}
            onChange={(e) => setProfileDraft((p) => ({ ...p, companyName: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          HQ state (2-letter)
          <input
            className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-sm uppercase text-white placeholder:text-white/55 caret-white"
            maxLength={2}
            value={profileDraft.hqState ?? ""}
            onChange={(e) => setProfileDraft((p) => ({ ...p, hqState: e.target.value.toUpperCase() }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          HQ county
          <input
            className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-white placeholder:text-white/55 caret-white"
            value={profileDraft.hqCounty ?? ""}
            onChange={(e) => setProfileDraft((p) => ({ ...p, hqCounty: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          State of incorporation
          <input
            className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-sm uppercase text-white placeholder:text-white/55 caret-white"
            maxLength={2}
            value={profileDraft.stateOfIncorporation ?? ""}
            onChange={(e) => setProfileDraft((p) => ({ ...p, stateOfIncorporation: e.target.value.toUpperCase() }))}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          CIK (SEC)
          <input
            className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-white/55 caret-white"
            inputMode="numeric"
            maxLength={14}
            placeholder="10-digit CIK"
            value={profileDraft.cik ?? ""}
            onChange={(e) =>
              setProfileDraft((p) => ({ ...p, cik: e.target.value.replace(/[^\d\s]/g, "").replace(/\s+/g, "").trim() }))
            }
            onBlur={() =>
              setProfileDraft((p) => {
                const d = (p.cik ?? "").replace(/\D/g, "");
                if (d.length === 0) return { ...p, cik: null };
                return { ...p, cik: d.padStart(10, "0").slice(-10) };
              })
            }
            aria-label="SEC Central Index Key"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          EIN (IRS taxpayer ID)
          <input
            className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-white/55 caret-white"
            placeholder="XX-XXXXXXX"
            autoComplete="off"
            value={profileDraft.irsEmployerIdentificationNumber ?? ""}
            onChange={(e) => setProfileDraft((p) => ({ ...p, irsEmployerIdentificationNumber: e.target.value }))}
            onBlur={() =>
              setProfileDraft((p) => {
                const d = (p.irsEmployerIdentificationNumber ?? "").replace(/\D/g, "");
                if (d.length === 0) return { ...p, irsEmployerIdentificationNumber: null };
                if (d.length !== 9) return p;
                return { ...p, irsEmployerIdentificationNumber: `${d.slice(0, 2)}-${d.slice(2)}` };
              })
            }
            aria-label="IRS employer identification number"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          Fiscal year end
          <input
            className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-white/55 caret-white"
            placeholder="e.g. 12/31 or month-day from SEC"
            value={profileDraft.fiscalYearEnd ?? ""}
            onChange={(e) =>
              setProfileDraft((p) => ({ ...p, fiscalYearEnd: e.target.value.replace(/\s+/g, " ").trim() || null }))
            }
            aria-label="Fiscal year end"
          />
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
        Principal executive office / address
        <textarea
          rows={4}
          className="resize-y rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-white placeholder:text-white/55 caret-white"
          value={profileDraft.principalExecutiveOfficeAddress ?? ""}
          onChange={(e) => setProfileDraft((p) => ({ ...p, principalExecutiveOfficeAddress: e.target.value }))}
        />
      </label>

      <div className="mt-4 space-y-2">
        <label className="mb-1 flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          Subsidiaries (Exhibit 21)
          <span className="text-[9px] font-normal normal-case leading-snug" style={{ color: "var(--muted2)" }}>
            {exhibitGrid
              ? "Full subsidiary schedule captured from SEC Exhibit 21 (all columns as filed). Edits autosave — search hints still derive from the subsidiary / legal-name column when possible."
              : "Until a full Exhibit 21 grid is loaded from SEC, subsidiaries are edited as name + domicile below. Refresh pulls the exhibit when it is available from SEC."}
          </span>
        </label>
        {exhibitGrid && exhibitGrid.rows.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2 pb-2">
              <button
                type="button"
                className="rounded border border-[var(--border)] px-2 py-1 text-[10px] font-medium uppercase tracking-wide hover:border-[var(--accent)]"
                style={{ color: "var(--muted2)" }}
                onClick={() => addGridRow()}
              >
                Add schedule row
              </button>
              <button
                type="button"
                className="rounded border border-[var(--border)] px-2 py-1 text-[10px] font-medium uppercase tracking-wide hover:border-[var(--accent)]"
                style={{ color: "var(--muted2)" }}
                onClick={() => addGridColumn()}
              >
                Add column
              </button>
            </div>
            <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--card)]">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead>
                  <tr style={{ color: "var(--muted2)" }}>
                    {(() => {
                      const cols = Math.max(...exhibitGrid.rows.map((r) => r.length), 1);
                      const hdr = exhibitGrid.hasHeaderRow ? exhibitGrid.rows[0] : null;
                      return Array.from({ length: cols }, (_, ci) => (
                        <th
                          key={ci}
                          className="border-b border-[var(--border)] bg-[var(--card2)]/50 px-2 py-2 font-semibold"
                          scope="col"
                        >
                          {(hdr?.[ci] ?? "").trim() || `Column ${ci + 1}`}
                        </th>
                      ));
                    })()}
                    <th
                      className="border-b border-[var(--border)] bg-[var(--card2)]/50 px-1 py-2 w-10"
                      aria-label="Remove row"
                      scope="col"
                    />
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const bodySlice = exhibitGrid.hasHeaderRow ? exhibitGrid.rows.slice(1) : exhibitGrid.rows;
                    const cols = Math.max(...exhibitGrid.rows.map((r) => r.length), 1);
                    return bodySlice.map((cells, ri) => {
                      const rowIndexGlobal = exhibitGrid.hasHeaderRow ? ri + 1 : ri;
                      const padded =
                        cells.length < cols ? [...cells, ...Array.from({ length: cols - cells.length }, () => "")] : [...cells];
                      return (
                        <tr key={rowIndexGlobal} style={{ color: "var(--text)" }}>
                          {padded.slice(0, cols).map((cell, ci) => (
                            <td key={ci} className="border-b border-[var(--border)] p-0 align-top">
                              <input
                                className="w-full min-w-[7rem] border-0 bg-transparent px-2 py-1.5 font-mono text-[11px] text-white placeholder:text-white/55 caret-white outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--accent)]"
                                value={cell}
                                onChange={(e) => updateGridCell(rowIndexGlobal, ci, e.target.value)}
                                aria-label={`Exhibit row ${rowIndexGlobal + 1} column ${ci + 1}`}
                              />
                            </td>
                          ))}
                          <td className="border-b border-[var(--border)] px-1 py-1 align-top text-center">
                            <button
                              type="button"
                              className="rounded px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:bg-[var(--card2)] hover:text-[var(--danger)]"
                              onClick={() => removeGridRow(rowIndexGlobal)}
                              aria-label="Remove exhibit row"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {!exhibitGrid || exhibitGrid.rows.length === 0 ? (
          <>
            <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--card)]">
              <table className="w-full min-w-[520px] border-collapse text-left text-[11px]">
                <thead>
                  <tr style={{ color: "var(--muted2)" }}>
                    <th className="border-b border-[var(--border)] bg-[var(--card2)]/50 px-2 py-2 font-semibold">Subsidiary name</th>
                    <th className="border-b border-[var(--border)] bg-[var(--card2)]/50 px-2 py-2 font-semibold">
                      State / country of domicile
                    </th>
                    <th className="border-b border-[var(--border)] bg-[var(--card2)]/50 px-1 py-2 w-12" aria-label="Remove row" />
                  </tr>
                </thead>
                <tbody>
                  {subsidiaryRowsFromDraft(profileDraft).map((row, i) => (
                    <tr key={i} style={{ color: "var(--text)" }}>
                      <td className="border-b border-[var(--border)] p-0 align-top">
                        <input
                          className="w-full min-w-[12rem] border-0 bg-transparent px-2 py-1.5 font-mono text-[11px] text-white placeholder:text-white/55 caret-white outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--accent)]"
                          value={row.name}
                          onChange={(e) => updateSubRow(i, "name", e.target.value)}
                          placeholder="e.g. Example Holdings LLC"
                          aria-label={`Subsidiary ${i + 1} name`}
                        />
                      </td>
                      <td className="border-b border-[var(--border)] p-0 align-top">
                        <input
                          className="w-full min-w-[10rem] border-0 bg-transparent px-2 py-1.5 font-mono text-[11px] text-white placeholder:text-white/55 caret-white outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--accent)]"
                          value={row.domicile}
                          onChange={(e) => updateSubRow(i, "domicile", e.target.value)}
                          placeholder="e.g. DE, France"
                          aria-label={`Subsidiary ${i + 1} domicile`}
                        />
                      </td>
                      <td className="border-b border-[var(--border)] px-1 py-1 align-top text-center">
                        <button
                          type="button"
                          className="rounded px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:bg-[var(--card2)] hover:text-[var(--danger)]"
                          onClick={() => removeSubRow(i)}
                          aria-label="Remove subsidiary row"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addSubRow}
              className="mt-2 rounded border border-[var(--border)] px-2 py-1 text-[10px] font-medium uppercase tracking-wide hover:border-[var(--accent)]"
              style={{ color: "var(--muted2)" }}
            >
              Add subsidiary row
            </button>
          </>
        ) : null}
      </div>
    </Card>
  );
}

export function PublicRecordsTab({
  ticker,
  companyName,
  profileOnly = false,
}: {
  ticker: string;
  companyName?: string;
  /** When true, show only the profile editor (Overview). Otherwise the full diligence view (Documents tab). */
  profileOnly?: boolean;
}) {
  const tk = ticker.trim().toUpperCase();
  const base = `/api/companies/${encodeURIComponent(tk)}/public-records`;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [records, setRecords] = useState<PublicRecordRow[]>([]);
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);
  const [recommended, setRecommended] = useState<Recommended[]>([]);

  const [activeCategory, setActiveCategory] = useState<PublicRecordCategory>(() => PUBLIC_RECORD_CATEGORIES_ORDER[0]);
  const [profileDraft, setProfileDraft] = useState<Partial<Profile>>({});

  const [secBusy, setSecBusy] = useState(false);
  const [ingestFeedback, setIngestFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const autoSecIngestAttemptedForTickerRef = useRef<string | null>(null);

  const lastSavedProfileBodyRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** At most one client-side SEC identity prefill (CIK/EIN/FYE) merge per ticker + profile row; avoids noisy SEC calls. */
  const identityPrefillRanKeyRef = useRef<string | null>(null);

  useEffect(() => {
    identityPrefillRanKeyRef.current = null;
  }, [tk]);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setLoading(true);

    try {
      /** Overview → Public Records Profile only needs saved profile—not findings/registry APIs. */
      if (profileOnly) {
        const pRes = await fetch(`${base}/profile?companyName=${encodeURIComponent(companyName ?? "")}`, {
          credentials: "same-origin",
        });
        if (!pRes.ok) {
          throw new Error(`Could not load profile: ${await responseErrorDetail(pRes)}`);
        }
        const pJson = (await pRes.json()) as { profile: Profile };
        setProfile(pJson.profile);
        setProfileDraft(withNormalizedExhibit21Snapshot(pJson.profile));
        lastSavedProfileBodyRef.current = serializeProfileBody(pJson.profile);
        return;
      }

      const [pRes, rRes, cRes, sRes] = await Promise.all([
        fetch(`${base}/profile?companyName=${encodeURIComponent(companyName ?? "")}`, { credentials: "same-origin" }),
        fetch(`${base}/records`, { credentials: "same-origin" }),
        fetch(`${base}/checklist`, { credentials: "same-origin" }),
        fetch(`${base}/sources`, { credentials: "same-origin" }),
      ]);
      if (!pRes.ok || !rRes.ok || !cRes.ok || !sRes.ok) {
        const parts: string[] = [];
        if (!pRes.ok) parts.push(`profile: ${await responseErrorDetail(pRes)}`);
        if (!rRes.ok) parts.push(`records: ${await responseErrorDetail(rRes)}`);
        if (!cRes.ok) parts.push(`checklist: ${await responseErrorDetail(cRes)}`);
        if (!sRes.ok) parts.push(`sources: ${await responseErrorDetail(sRes)}`);
        throw new Error(`Failed to load public records data (${parts.join("; ")}).`);
      }
      const pJson = (await pRes.json()) as { profile: Profile };
      const rJson = (await rRes.json()) as { records: PublicRecordRow[] };
      const cJson = (await cRes.json()) as { items: ChecklistRow[] };
      const sJson = (await sRes.json()) as { registry: RegistryEntry[]; recommended: Recommended[] };

      setProfile(pJson.profile);
      setProfileDraft(withNormalizedExhibit21Snapshot(pJson.profile));
      lastSavedProfileBodyRef.current = serializeProfileBody(pJson.profile);
      setRecords(rJson.records);
      setChecklist(cJson.items);
      setRecommended(sJson.recommended);
    } catch {
      // Load failures are intentionally silent (no error banner).
    } finally {
      if (!silent) setLoading(false);
    }
  }, [base, companyName, profileOnly]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Fill CIK / EIN / FYE when missing (SEC submissions + 10‑K cover in prefill-from-SEC). Saves via debounced autosave. */
  useEffect(() => {
    if (loading || !profile?.id) return undefined;

    const bootstrapKey = `${tk}:${profile.id}`;
    if (identityPrefillRanKeyRef.current === bootstrapKey) return undefined;

    const needIdentity =
      !(profile.cik ?? "").trim() ||
      !(profile.fiscalYearEnd ?? "").trim() ||
      !(profile.irsEmployerIdentificationNumber ?? "").trim();

    if (!needIdentity) {
      identityPrefillRanKeyRef.current = bootstrapKey;
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`${base}/profile/prefill-from-sec`, { credentials: "same-origin" });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as { prefill?: PublicRecordsSecPrefill };
        if (!j.prefill || cancelled) return;
        const mergedLike = mergePublicRecordsSecPrefill(profileLikeForMerge(profile), j.prefill, {});
        const full = applyMergeToProfile(mergedLike, profile, tk);
        if (cancelled) return;
        identityPrefillRanKeyRef.current = bootstrapKey;
        setProfile(full);
        setProfileDraft(withNormalizedExhibit21Snapshot(full));
      } catch {
        /* ignore — user can Refresh from SEC */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, profile?.id, profile?.cik, profile?.fiscalYearEnd, profile?.irsEmployerIdentificationNumber, base, tk, profile]);

  /** Debounced persist of profile fields to the server (same payload as the old Save button). */
  useEffect(() => {
    if (loading || !profile) return;
    const body = serializeProfileBody(profileDraft);
    if (body === lastSavedProfileBodyRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void (async () => {
        try {
          const res = await fetch(`${base}/profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            credentials: "same-origin",
          });
          if (!res.ok) {
            return;
          }
          const j = (await res.json()) as { profile: Profile };
          setProfile(j.profile);
          lastSavedProfileBodyRef.current = body;
        } catch {
          // Autosave failure is silent.
        }
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [profileDraft, loading, profile, base]);

  const terms = useMemo(() => {
    return generatePublicRecordsSearchTerms({
      companyName: profileDraft.companyName ?? companyName,
      ticker: tk,
      legalNames: profileDraft.legalNames ?? [],
      formerNames: profileDraft.formerNames ?? [],
      dbaNames: profileDraft.dbaNames ?? [],
      subsidiaryNames: profileDraft.subsidiaryNames ?? [],
      borrowerNames: profileDraft.borrowerNames ?? [],
      guarantorNames: profileDraft.guarantorNames ?? [],
      issuerNames: profileDraft.issuerNames ?? [],
      parentCompanyNames: profileDraft.parentCompanyNames ?? [],
      operatingCompanyNames: profileDraft.operatingCompanyNames ?? [],
      restrictedSubsidiaryNames: profileDraft.restrictedSubsidiaryNames ?? [],
      unrestrictedSubsidiaryNames: profileDraft.unrestrictedSubsidiaryNames ?? [],
    });
  }, [profileDraft, companyName, tk]);

  const entityUniverseProfileSubsidiaries = useMemo<EntityUniversePublicRecordsSubsidiaries>(() => ({
    subsidiaryExhibit21Snapshot: profileDraft.subsidiaryExhibit21Snapshot ?? null,
    subsidiaryNames: profileDraft.subsidiaryNames ?? [],
    subsidiaryDomiciles: profileDraft.subsidiaryDomiciles ?? [],
  }), [
    profileDraft.subsidiaryExhibit21Snapshot,
    (profileDraft.subsidiaryNames ?? []).join("\u0001"),
    (profileDraft.subsidiaryDomiciles ?? []).join("\u0001"),
  ]);

  const categoryCounts = useMemo(() => {
    const m = new Map<PublicRecordCategory, { findings: number; unchecked: number }>();
    for (const c of PUBLIC_RECORD_CATEGORIES_ORDER) {
      m.set(c, { findings: 0, unchecked: 0 });
    }
    for (const r of records) {
      const x = m.get(r.category);
      if (x) x.findings++;
    }
    for (const rec of recommended) {
      const cat = rec.source.category;
      const entry = m.get(cat);
      if (!entry) continue;
      if (!rec.checklist || rec.checklist.status === "not_started") entry.unchecked++;
    }
    return m;
  }, [records, recommended]);

  const runSecIngest = useCallback(
    async (opts: { refresh: boolean }) => {
      setSecBusy(true);
      setIngestFeedback(null);
      try {
        const res = await fetch(`${base}/ingest-10k`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: opts.refresh }),
          credentials: "same-origin",
        });
        const raw = await res.text();
        let j: {
          profile?: Profile;
          prefill?: PublicRecordsSecPrefill;
          error?: string;
          savedDocuments?: { errors?: string[] };
        } = {};
        try {
          j = raw
            ? (JSON.parse(raw) as {
                profile?: Profile;
                prefill?: PublicRecordsSecPrefill;
                error?: string;
                savedDocuments?: { errors?: string[] };
              })
            : {};
        } catch {
          setIngestFeedback({
            kind: "err",
            text: !res.ok ? `${res.status} ${res.statusText || "Error"}` : "Server returned invalid JSON.",
          });
          return;
        }
        if (!res.ok) {
          const detail =
            typeof j.error === "string" && j.error.trim()
              ? j.error.trim()
              : `${res.status} ${res.statusText || "Error"}`;
          setIngestFeedback({ kind: "err", text: detail });
          return;
        }
        const saveNote =
          j.savedDocuments?.errors?.length ? ` ${j.savedDocuments.errors.join(" ")}` : "";
        if (j.profile) {
          setProfile(j.profile);
          setProfileDraft(withNormalizedExhibit21Snapshot(j.profile));
          lastSavedProfileBodyRef.current = serializeProfileBody(j.profile);
          setIngestFeedback({
            kind: "ok",
            text: `Profile updated from SEC and saved. Filing copies are in Saved Documents.${saveNote}`.trim(),
          });
        } else if (j.prefill) {
          const mergedLike = mergePublicRecordsSecPrefill(profileLikeForMerge(profile ?? profileDraft), j.prefill, {
            secIngest: true,
            replaceListsFromSec: opts.refresh,
          });
          const full = applyMergeToProfile(mergedLike, profile, tk);
          setProfile(full);
          setProfileDraft(withNormalizedExhibit21Snapshot(full));
          lastSavedProfileBodyRef.current = serializeProfileBody(full);
          setIngestFeedback({
            kind: "ok",
            text: `SEC data merged into the form (response had no full profile row).${saveNote}`.trim(),
          });
        } else {
          setIngestFeedback({
            kind: "err",
            text: "Unexpected response: no profile or prefill. Try again or check server logs.",
          });
          return;
        }
        await refresh({ silent: profileOnly });
      } catch {
        setIngestFeedback({ kind: "err", text: "Network error while ingesting from SEC." });
      } finally {
        setSecBusy(false);
      }
    },
    [base, profile, profileDraft, profileOnly, refresh, tk]
  );

  useEffect(() => {
    autoSecIngestAttemptedForTickerRef.current = null;
  }, [tk]);

  useEffect(() => {
    if (!profileOnly) return;
    if (loading || !profile) return;
    if (!isProfileSecEmpty(profile)) return;
    if (autoSecIngestAttemptedForTickerRef.current === tk) return;
    autoSecIngestAttemptedForTickerRef.current = tk;
    void runSecIngest({ refresh: false });
  }, [profileOnly, loading, profile, tk, runSecIngest]);

  async function upsertCheck(rec: Recommended, status: string) {
    const res = await fetch(`${base}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceKey: rec.sourceKey,
        category: rec.source.category,
        status,
        notes: rec.checklist?.notes ?? "",
        entityName: profileDraft.companyName ?? "",
        jurisdictionName: rec.source.jurisdictionName,
      }),
    });
    if (res.ok) void refresh();
  }

  const catDisclaimer =
    activeCategory === "tax_liens_releases"
      ? TAX_LIEN_DISCLAIMER
      : activeCategory === "ucc_secured_debt"
        ? UCC_DISCLAIMER
        : activeCategory === "real_estate_recorder"
          ? REAL_ESTATE_DISCLAIMER
          : null;

  if (!tk) return <p className="text-sm text-[var(--muted)]">Select a company.</p>;

  if (profileOnly) {
    return (
      <div className="space-y-6">
        <PublicRecordsProfileCard
          loading={loading}
          secBusy={secBusy}
          profileDraft={profileDraft}
          setProfileDraft={setProfileDraft}
          onRefreshSec={() => void runSecIngest({ refresh: true })}
          ingestFeedback={ingestFeedback}
        />

        {loading && <p className="text-[11px] text-[var(--muted)]">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(15.5rem,20rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <aside
          className="order-first shrink-0 lg:sticky lg:top-3 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
          aria-label="Public records navigation"
        >
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Categories
          </p>
          <nav className="flex flex-col gap-1" aria-label="Record categories">
            {PUBLIC_RECORD_CATEGORIES_ORDER.map((cat) => {
              const cc = categoryCounts.get(cat) ?? { findings: 0, unchecked: 0 };
              const selected = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`w-full rounded-md border px-2.5 py-2 text-left text-[11px] font-medium leading-snug transition ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--card2)] shadow-sm"
                      : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted2)]"
                  }`}
                >
                  <span className="block" style={{ color: "var(--text)" }}>
                    {PUBLIC_RECORD_CATEGORY_LABELS[cat]}
                  </span>
                  <span className="mt-1 block text-[10px] font-normal" style={{ color: "var(--muted)" }}>
                    Findings: {cc.findings} · Open checks: {cc.unchecked}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          <Card title={PUBLIC_RECORD_CATEGORY_LABELS[activeCategory]}>
            {activeCategory !== "entity_sos" ? (
              <p className="mb-3 text-[11px]" style={{ color: "var(--muted)" }}>
                Choose a category in the sidebar for diligence notes, recommended sources, and checklist actions. Use{" "}
                <strong style={{ color: "var(--text)" }}>Overview → Public Records Profile</strong> to edit entity names and geography.
              </p>
            ) : null}
            <div
              role="tabpanel"
              aria-label={PUBLIC_RECORD_CATEGORY_LABELS[activeCategory]}
              className="rounded border border-[var(--border)] bg-[var(--card)]/40 px-3 py-3"
            >
              {activeCategory === "entity_sos" ? (
                <div className="mb-6">
                  <EntityUniverseAffiliateDiscoveryPage
                    ticker={tk}
                    companyName={profileDraft.companyName ?? companyName}
                    publicRecordsProfileSubsidiaries={entityUniverseProfileSubsidiaries}
                  />
                </div>
              ) : null}
              {activeCategory !== "entity_sos" ? (
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  {PUBLIC_RECORD_CATEGORY_DESCRIPTIONS[activeCategory]}
                </p>
              ) : null}
              {catDisclaimer && activeCategory !== "entity_sos" ? (
                <p className="mt-3 rounded border border-[var(--border)] px-2 py-1.5 text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
                  {catDisclaimer}
                </p>
              ) : null}
              {activeCategory !== "entity_sos" ? (
                <>
                  <h5 className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
                    Recommended sources
                  </h5>
                  <ul className="space-y-2 text-[11px]">
                    {recommended
                      .filter((r) => r.source.category === activeCategory)
                      .map((r) => (
                        <li key={r.sourceKey} className="rounded border border-[var(--border)] px-2 py-2" style={{ color: "var(--text)" }}>
                          <div className="font-medium">{r.source.sourceName}</div>
                          <div style={{ color: "var(--muted)" }}>{r.reason}</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <a className="underline" href={r.source.sourceUrl} target="_blank" rel="noreferrer">
                              Open source
                            </a>
                            <button
                              type="button"
                              className="underline"
                              onClick={() => void navigator.clipboard.writeText(terms.categoryTerms[activeCategory].join(", "))}
                            >
                              Copy search terms
                            </button>
                            <button type="button" className="underline" onClick={() => void upsertCheck(r, "searched_no_result")}>
                              Mark checked (no result)
                            </button>
                            <button type="button" className="underline" onClick={() => void upsertCheck(r, "confirmed_result")}>
                              Mark match found
                            </button>
                          </div>
                          {r.checklist && (
                            <div className="mt-1 text-[10px]" style={{ color: "var(--muted2)" }}>
                              Status: {r.checklist.status}
                              {r.checklist.checkedAt ? ` · ${r.checklist.checkedAt.slice(0, 10)}` : ""}
                            </div>
                          )}
                        </li>
                      ))}
                    {recommended.filter((r) => r.source.category === activeCategory).length === 0 && (
                      <li style={{ color: "var(--muted)" }}>
                        No MVP registry entries for this category yet—add a custom source from the API or extend the registry.
                      </li>
                    )}
                  </ul>
                </>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      {loading && <p className="text-[11px] text-[var(--muted)]">Loading…</p>}
    </div>
  );
}
