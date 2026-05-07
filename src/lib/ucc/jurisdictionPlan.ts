import { allUsStateAbbreviations } from "@/lib/ucc/allUsStates";
import { UNKNOWN_JURISDICTION_CODE } from "@/lib/ucc/stateCapabilityRegistry";
import { usStateAbbrFromText } from "@/lib/usStates";

export type JurisdictionSearchPlan = {
  entity_name: string;
  primary_jurisdiction: string;
  secondary_jurisdictions: string[];
  reason: string;
  confidence: "High" | "Medium" | "Low";
};

export type IntelFootprint = {
  hqState: string | null;
  stateOfIncorporation: string | null;
  majorOperatingStates: string[];
};

function uniqStates(xs: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const ab = usStateAbbrFromText(x ?? "");
    if (!ab) continue;
    if (seen.has(ab)) continue;
    seen.add(ab);
    out.push(ab);
  }
  return out;
}

/**
 * Build primary + secondary US jurisdictions without default national sweep.
 */
export function buildJurisdictionSearchPlan(opts: {
  entityExactName: string;
  formationAbbr: string | null;
  formationRaw: string | null;
  intel: IntelFootprint | null;
  extraStatesFromAddresses: string[];
  nationalSweep: boolean;
}): JurisdictionSearchPlan {
  const { entityExactName, formationAbbr, formationRaw, intel, extraStatesFromAddresses, nationalSweep } = opts;

  const footprint = uniqStates([
    ...(intel?.hqState ? [intel.hqState] : []),
    ...(intel?.stateOfIncorporation ? [intel.stateOfIncorporation] : []),
    ...(intel?.majorOperatingStates ?? []),
    ...extraStatesFromAddresses,
  ]);

  let primary = formationAbbr && /^[A-Z]{2}$/.test(formationAbbr) ? formationAbbr : null;
  let confidence: JurisdictionSearchPlan["confidence"] = "High";
  const secondarySet = new Set<string>();

  if (primary) {
    for (const s of footprint) {
      if (s !== primary) secondarySet.add(s);
    }
  } else {
    /** Credit / unknown formation: use issuer footprint heuristics (no nationwide default). */
    primary = footprint[0] ?? null;
    for (let i = primary ? 1 : 0; i < footprint.length; i++) secondarySet.add(footprint[i]);
    confidence = primary ? "Medium" : "Low";
  }

  if (nationalSweep && primary && primary !== UNKNOWN_JURISDICTION_CODE) {
    for (const s of allUsStateAbbreviations()) {
      if (s !== primary) secondarySet.add(s);
    }
    confidence = "Low";
  }

  const secondary = [...secondarySet].sort();

  if (!primary) {
    return {
      entity_name: entityExactName,
      primary_jurisdiction: UNKNOWN_JURISDICTION_CODE,
      secondary_jurisdictions: [],
      reason: `No US formation or issuer footprint for (${formationRaw ?? "—"}). Placeholder jurisdiction "${UNKNOWN_JURISDICTION_CODE}" until SOS / charter / schedules resolve state.`,
      confidence: "Low",
    };
  }

  const reasonParts: string[] = [];
  if (formationAbbr) {
    reasonParts.push(`Primary filing jurisdiction assumed as US formation (${formationAbbr}).`);
  } else {
    reasonParts.push(
      `Formation jurisdiction missing or non-US (${formationRaw ?? "—"}); primary search state inferred from issuer HQ / operating footprint.`
    );
  }
  if (secondary.length) {
    reasonParts.push(`Secondary states: ${secondary.join(", ")} (HQ, operating footprint, address-cluster hints${nationalSweep ? ", national sweep" : ""}).`);
  } else {
    reasonParts.push("No secondary jurisdictions inferred (narrow search).");
  }

  return {
    entity_name: entityExactName,
    primary_jurisdiction: primary,
    secondary_jurisdictions: secondary,
    reason: reasonParts.join(" "),
    confidence,
  };
}
