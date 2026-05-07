import { usStateAbbrFromText } from "@/lib/usStates";
import { UNKNOWN_JURISDICTION_CODE } from "@/lib/ucc/stateCapabilityRegistry";
import { allUsStateAbbreviations } from "@/lib/ucc/allUsStates";
import { guessUsStateFromAddressLine, statesMentionedInAddressBlock } from "@/lib/taxLien/addressHints";

export type TaxLienCountyHint = { stateAbbr: string; countyName: string | null };

export type TaxLienSearchPlanPayload = {
  searchStates: string[];
  countyHints: TaxLienCountyHint[];
  nationalSweep: boolean;
  webFallbackEnabled: boolean;
  deepNameVariants: boolean;
  reasonParts: string[];
};

function uniqStates(xs: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const t = (x ?? "").trim().toUpperCase();
    if (!t || t === UNKNOWN_JURISDICTION_CODE) continue;
    if (!/^[A-Z]{2}$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function extractStatesFromProfileJson(j: unknown): string[] {
  if (j == null) return [];
  if (!Array.isArray(j)) return [];
  const out: string[] = [];
  for (const item of j) {
    if (typeof item === "string") {
      const ab = usStateAbbrFromText(item) ?? guessUsStateFromAddressLine(item);
      if (ab) out.push(ab);
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const candidates = [o.state, o.State, o.jurisdiction, o.region, o.address, o.location];
      for (const c of candidates) {
        if (typeof c !== "string") continue;
        const ab = usStateAbbrFromText(c) ?? guessUsStateFromAddressLine(c);
        if (ab) out.push(ab);
      }
    }
  }
  return uniqStates(out);
}

/**
 * Build US states / DC to search for tax liens (formation, footprint, optional national sweep).
 * Does not search every state unless `nationalSweep` is true.
 */
export function buildTaxLienSearchPlan(opts: {
  formationJurisdictionRaw: string | null | undefined;
  principalOfficeAddress: string | null | undefined;
  mailingAddress: string | null | undefined;
  registeredOfficeAddress: string | null | undefined;
  uccDebtorAddress: string | null | undefined;
  hqStateRaw: string | null | undefined;
  hqCounty: string | null | undefined;
  principalExecutiveOfficeAddress: string | null | undefined;
  intelMajorOperatingStates: (string | null | undefined)[];
  intelFacilityAddresses: string[];
  intelPrincipalExecutiveOfficeAddress: string | null | undefined;
  profileFacilityLocationJson: unknown;
  profilePropertyLocationJson: unknown;
  profilePermitJurisdictionsJson: unknown;
  nationalSweep: boolean;
  webFallbackEnabled: boolean;
  deepNameVariants: boolean;
}): TaxLienSearchPlanPayload {
  const formationAbbr =
    usStateAbbrFromText(opts.formationJurisdictionRaw ?? "") ??
    (opts.formationJurisdictionRaw ? guessUsStateFromAddressLine(String(opts.formationJurisdictionRaw)) : null);

  const hqAbbr = usStateAbbrFromText(opts.hqStateRaw ?? "");

  const reasonParts: string[] = [];

  const fromAddresses = uniqStates([
    ...statesMentionedInAddressBlock(opts.principalOfficeAddress),
    ...statesMentionedInAddressBlock(opts.mailingAddress),
    ...statesMentionedInAddressBlock(opts.registeredOfficeAddress),
    ...statesMentionedInAddressBlock(opts.uccDebtorAddress),
    ...statesMentionedInAddressBlock(opts.principalExecutiveOfficeAddress),
  ]);

  const profileExtras = uniqStates([
    ...extractStatesFromProfileJson(opts.profileFacilityLocationJson),
    ...extractStatesFromProfileJson(opts.profilePropertyLocationJson),
    ...extractStatesFromProfileJson(opts.profilePermitJurisdictionsJson),
  ]);

  const intelStates = uniqStates((opts.intelMajorOperatingStates ?? []).map((s) => usStateAbbrFromText(s ?? "")));

  const intelAddrStates = uniqStates(
    (opts.intelFacilityAddresses ?? []).flatMap((line) => statesMentionedInAddressBlock(line))
  );

  const intelPeoStates = statesMentionedInAddressBlock(opts.intelPrincipalExecutiveOfficeAddress ?? "");

  let searchStates = uniqStates([
    ...(formationAbbr ? [formationAbbr] : []),
    ...(hqAbbr ? [hqAbbr] : []),
    ...fromAddresses,
    ...intelStates,
    ...intelAddrStates,
    ...intelPeoStates,
    ...profileExtras,
  ]);

  if (opts.nationalSweep) {
    searchStates = uniqStates([...searchStates, ...allUsStateAbbreviations()]);
    reasonParts.push("National sweep: all US jurisdictions included as search targets.");
  }

  if (formationAbbr) reasonParts.push(`Formation jurisdiction ${formationAbbr}.`);
  else reasonParts.push("Formation jurisdiction unknown — search footprint uses addresses and profile hints only.");

  if (hqAbbr) reasonParts.push(`HQ / profile state ${hqAbbr}.`);
  if (fromAddresses.length) reasonParts.push(`Address-derived states: ${fromAddresses.join(", ")}.`);
  if (intelStates.length) reasonParts.push(`Intel operating-state hints: ${intelStates.join(", ")}.`);
  if (intelAddrStates.length) reasonParts.push(`Intel facility address states: ${intelAddrStates.join(", ")}.`);
  if (profileExtras.length) reasonParts.push(`Profile location hints: ${profileExtras.join(", ")}.`);

  const countyHints: TaxLienCountyHint[] = [];
  const hqCounty = (opts.hqCounty ?? "").trim();
  if (hqAbbr && hqCounty) {
    countyHints.push({ stateAbbr: hqAbbr, countyName: hqCounty });
    reasonParts.push(`HQ county hint: ${hqCounty}, ${hqAbbr}.`);
  }

  return {
    searchStates,
    countyHints,
    nationalSweep: opts.nationalSweep,
    webFallbackEnabled: opts.webFallbackEnabled,
    deepNameVariants: opts.deepNameVariants,
    reasonParts,
  };
}
