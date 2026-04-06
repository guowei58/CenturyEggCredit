import type { SubsidiaryHintsResult } from "@/lib/subsidiary-hints";
import type { SecCompanyProfile } from "@/lib/sec-edgar";
import type { CanonicalEnvProfile } from "@/lib/env-risk/types";

function distinctPush(arr: string[], seen: Set<string>, s: string) {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 140) return;
  const k = t.toLowerCase();
  if (seen.has(k)) return;
  seen.add(k);
  arr.push(t);
}

export function buildCanonicalEnvProfile(params: {
  ticker: string;
  secProfile: SecCompanyProfile | null;
  subsidiaryHints: SubsidiaryHintsResult | null;
  extractedFacilityHints: string[];
}): CanonicalEnvProfile {
  const ticker = params.ticker.trim().toUpperCase();
  const legal_entity_names: string[] = [];
  const subsidiary_names: string[] = [];
  const trade_name_hints: string[] = [];
  const facility_name_hints: string[] = [];
  const sources: string[] = [];
  const seen = new Set<string>();

  const parent = params.secProfile?.name?.trim() || ticker;
  distinctPush(legal_entity_names, seen, parent);

  if (params.secProfile) {
    sources.push("SEC submissions (company name, CIK, SIC)");
  }

  if (params.subsidiaryHints?.ok) {
    for (const n of params.subsidiaryHints.names) distinctPush(subsidiary_names, seen, n);
    sources.push(...params.subsidiaryHints.sources);
  }

  for (const f of params.extractedFacilityHints) distinctPush(facility_name_hints, seen, f);

  const operating_states_hint: string[] = [];

  return {
    ticker,
    parent_name: parent,
    cik: params.secProfile?.cik ?? null,
    sic_description: params.secProfile?.sicDescription ?? null,
    state_of_incorporation: params.secProfile?.stateOfIncorporation ?? null,
    legal_entity_names,
    subsidiary_names,
    trade_name_hints,
    facility_name_hints,
    operating_states_hint,
    sources,
  };
}

/** Search strings for FRS/ECHO (longest / most specific first). */
export function buildAliasQueries(profile: CanonicalEnvProfile, maxAliases: number): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  function push(s: string) {
    const t = s.replace(/\s+/g, " ").trim();
    if (t.length < 4) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push(t);
  }

  push(profile.parent_name);
  for (const s of profile.subsidiary_names) push(s);
  for (const s of profile.legal_entity_names) push(s);
  for (const s of profile.facility_name_hints) push(s);

  candidates.sort((a, b) => b.length - a.length);
  return candidates.slice(0, maxAliases);
}
