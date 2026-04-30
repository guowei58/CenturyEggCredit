import type { PublicRecordsSecPrefill } from "@/lib/publicRecordsSecPrefillTypes";
import { mergeSubsidiaryRows } from "@/lib/exhibit21SubsidiaryRows";

type ProfileLike = {
  companyName?: string | null;
  legalNames?: string[];
  formerNames?: string[];
  dbaNames?: string[];
  subsidiaryNames?: string[];
  subsidiaryDomiciles?: string[];
  subsidiaryExhibit21Snapshot?: unknown;
  borrowerNames?: string[];
  guarantorNames?: string[];
  issuerNames?: string[];
  parentCompanyNames?: string[];
  operatingCompanyNames?: string[];
  restrictedSubsidiaryNames?: string[];
  unrestrictedSubsidiaryNames?: string[];
  hqState?: string | null;
  hqCounty?: string | null;
  hqCity?: string | null;
  principalExecutiveOfficeAddress?: string | null;
  stateOfIncorporation?: string | null;
  cik?: string | null;
  irsEmployerIdentificationNumber?: string | null;
  fiscalYearEnd?: string | null;
  notes?: string | null;
};

const empty = (s: string | null | undefined) => !s || !String(s).trim();

function mergeStringArr(prev: string[] | undefined, incoming: string[] | undefined): string[] {
  const cur = prev ?? [];
  const seen = new Set(cur.map((x) => x.toLowerCase()));
  const out = [...cur];
  for (const x of incoming ?? []) {
    const t = x.replace(/\s+/g, " ").trim();
    if (t.length < 2) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Fills empty scalar fields and merges name lists (deduped).
 * When `secIngest` is true (explicit “Ingest from SEC”), scalar fields from SEC **overwrite** existing values when SEC provides them.
 * When `replaceListsFromSec` is true (refresh), list fields are taken entirely from the SEC prefill instead of merged with prior rows.
 */
export function mergePublicRecordsSecPrefill(
  prev: ProfileLike,
  prefill: PublicRecordsSecPrefill,
  options?: { secIngest?: boolean; replaceListsFromSec?: boolean }
): ProfileLike {
  const secIngest = options?.secIngest === true;
  const replaceLists = options?.replaceListsFromSec === true;
  const next: ProfileLike = { ...prev };

  if (secIngest) {
    if (prefill.companyName?.trim()) next.companyName = prefill.companyName;
    if (prefill.hqState?.trim()) next.hqState = prefill.hqState;
    if (prefill.hqCounty?.trim()) next.hqCounty = prefill.hqCounty;
    if (prefill.hqCity?.trim()) next.hqCity = prefill.hqCity;
    if (prefill.stateOfIncorporation?.trim()) next.stateOfIncorporation = prefill.stateOfIncorporation;
    if (prefill.principalExecutiveOfficeAddress?.trim()) next.principalExecutiveOfficeAddress = prefill.principalExecutiveOfficeAddress;
    if (prefill.cik?.trim()) next.cik = prefill.cik.trim();
    if (prefill.fiscalYearEnd?.trim()) next.fiscalYearEnd = prefill.fiscalYearEnd.trim();
    if (prefill.irsEmployerIdentificationNumber?.trim()) next.irsEmployerIdentificationNumber = prefill.irsEmployerIdentificationNumber.trim();
  } else {
    if (empty(prev.companyName) && prefill.companyName) {
      next.companyName = prefill.companyName;
    }
    if (empty(prev.hqState) && prefill.hqState) {
      next.hqState = prefill.hqState;
    }
    if (empty(prev.hqCounty) && prefill.hqCounty) {
      next.hqCounty = prefill.hqCounty;
    }
    if (empty(prev.hqCity) && prefill.hqCity) {
      next.hqCity = prefill.hqCity;
    }
    if (empty(prev.stateOfIncorporation) && prefill.stateOfIncorporation) {
      next.stateOfIncorporation = prefill.stateOfIncorporation;
    }
    if (empty(prev.principalExecutiveOfficeAddress) && prefill.principalExecutiveOfficeAddress) {
      next.principalExecutiveOfficeAddress = prefill.principalExecutiveOfficeAddress;
    }
    if (empty(prev.cik) && prefill.cik?.trim()) {
      next.cik = prefill.cik.trim();
    }
    if (empty(prev.fiscalYearEnd) && prefill.fiscalYearEnd?.trim()) {
      next.fiscalYearEnd = prefill.fiscalYearEnd.trim();
    }
    if (empty(prev.irsEmployerIdentificationNumber) && prefill.irsEmployerIdentificationNumber?.trim()) {
      next.irsEmployerIdentificationNumber = prefill.irsEmployerIdentificationNumber.trim();
    }
  }

  if (secIngest && replaceLists) {
    next.legalNames = [...(prefill.legalNames ?? [])];
    next.formerNames = [...(prefill.formerNames ?? [])];
    next.subsidiaryNames = [...(prefill.subsidiaryNames ?? [])];
    next.subsidiaryDomiciles = [...(prefill.subsidiaryDomiciles ?? [])];
    next.subsidiaryExhibit21Snapshot = prefill.subsidiaryExhibit21Snapshot ?? null;
    next.issuerNames = [...(prefill.issuerNames ?? [])];
  } else {
    next.legalNames = mergeStringArr(prev.legalNames, prefill.legalNames);
    next.formerNames = mergeStringArr(prev.formerNames, prefill.formerNames);
    const sub = mergeSubsidiaryRows(
      prev.subsidiaryNames ?? [],
      prev.subsidiaryDomiciles ?? [],
      prefill.subsidiaryNames ?? [],
      prefill.subsidiaryDomiciles ?? []
    );
    next.subsidiaryNames = sub.subsidiaryNames;
    next.subsidiaryDomiciles = sub.subsidiaryDomiciles;
    next.issuerNames = mergeStringArr(prev.issuerNames, prefill.issuerNames);
    if (
      prefill.subsidiaryExhibit21Snapshot &&
      (prev.subsidiaryExhibit21Snapshot === null || prev.subsidiaryExhibit21Snapshot === undefined)
    ) {
      next.subsidiaryExhibit21Snapshot = prefill.subsidiaryExhibit21Snapshot;
    }
  }

  return next;
}
