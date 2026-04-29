import type { PublicRecordsSecPrefill } from "@/lib/publicRecordsSecPrefillTypes";

type ProfileLike = {
  companyName?: string | null;
  legalNames?: string[];
  formerNames?: string[];
  dbaNames?: string[];
  subsidiaryNames?: string[];
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
  notes?: string | null;
};

const empty = (s: string | null | undefined) => !s || !String(s).trim();

function mergeStringArr(prev: string[] | undefined, incoming: string[]): string[] {
  const cur = prev ?? [];
  const seen = new Set(cur.map((x) => x.toLowerCase()));
  const out = [...cur];
  for (const x of incoming) {
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
 * Fills only empty scalar fields; appends new names to list fields (deduped, case-insensitive).
 */
export function mergePublicRecordsSecPrefill(
  prev: ProfileLike,
  prefill: PublicRecordsSecPrefill
): ProfileLike {
  const next: ProfileLike = { ...prev };

  if (empty(prev.companyName) && prefill.companyName) {
    next.companyName = prefill.companyName;
  }
  if (empty(prev.hqState) && prefill.hqState) {
    next.hqState = prefill.hqState;
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

  next.legalNames = mergeStringArr(prev.legalNames, prefill.legalNames);
  next.formerNames = mergeStringArr(prev.formerNames, prefill.formerNames);
  next.subsidiaryNames = mergeStringArr(prev.subsidiaryNames, prefill.subsidiaryNames);
  next.issuerNames = mergeStringArr(prev.issuerNames, prefill.issuerNames);

  return next;
}
