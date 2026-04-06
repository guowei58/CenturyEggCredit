import type {
  DisclosureRow,
  EnvRiskSnapshot,
  ResolvedFacility,
  RiskScoreResult,
} from "@/lib/env-risk/types";

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

export function computeEnvironmentalRiskScores(params: {
  disclosures: DisclosureRow[];
  facilities: ResolvedFacility[];
  facilityCount: number;
  echoQueryErrors: number;
}): RiskScoreResult {
  const { disclosures, facilities, facilityCount, echoQueryErrors } = params;

  const vague = disclosures.filter((d) => d.topic === "other").length;
  const strong = disclosures.length - vague;
  const disclosure_risk = clamp(
    Math.min(100, strong * 4 + vague * 1.5 + (disclosures.some((d) => d.extracted_amount) ? 12 : 0))
  );

  let compPts = 0;
  for (const f of facilities) {
    for (const c of f.compliance_flags) {
      if (/significant|violation|failure|noncompliance/i.test(c)) compPts += 14;
      else compPts += 5;
    }
  }
  const compliance_risk = clamp(compPts + Math.min(40, facilityCount * 2));

  let enfPts = 0;
  for (const f of facilities) {
    enfPts += f.enforcement_flags.length * 12;
  }
  const enforcement_risk = clamp(enfPts);

  let emPts = 0;
  for (const f of facilities) {
    emPts += f.emissions_flags.length * 10;
  }
  const emissions_release_risk = clamp(emPts + (facilities.some((f) => f.emissions_flags.length > 0) ? 8 : 0));

  let wastePts = 0;
  for (const f of facilities) {
    wastePts += f.waste_flags.length * 9;
  }
  const waste_cleanup_risk = clamp(wastePts + disclosures.filter((d) => /superfund|cercla|remediation/i.test(d.extracted_text)).length * 6);

  const permit_operational_risk = clamp(
    facilityCount * 3 +
      facilities.filter((f) => f.compliance_flags.length > 2).length * 10 +
      facilities.filter((f) => (f.raw_echo?.FacInspectionCount || "") !== "0").length * 2
  );

  const matchedHigh = facilities.filter((f) => f.match_confidence === "high").length;
  const matchedLow = facilities.filter((f) => f.match_confidence === "low" || f.match_confidence === "unresolved").length;
  const data_confidence = clamp(
    100 -
      echoQueryErrors * 8 -
      matchedLow * 3 -
      (facilityCount === 0 ? 35 : 0) +
      matchedHigh * 2
  );

  const overall =
    disclosure_risk * 0.2 +
    compliance_risk * 0.18 +
    enforcement_risk * 0.17 +
    emissions_release_risk * 0.12 +
    waste_cleanup_risk * 0.13 +
    permit_operational_risk * 0.1 +
    (100 - data_confidence) * 0.1;

  const rationale: string[] = [
    `Disclosure scan: ${disclosures.length} extracted windows (${strong} tagged to a topic, ${vague} generic/other).`,
    `Federal facility index: ${facilityCount} registry rows after merge (ECHO + FRS).`,
    `Data confidence blends match quality and provider errors (${echoQueryErrors} provider messages).`,
  ];

  return {
    disclosure_risk: Math.round(disclosure_risk),
    compliance_risk: Math.round(compliance_risk),
    enforcement_risk: Math.round(enforcement_risk),
    emissions_release_risk: Math.round(emissions_release_risk),
    waste_cleanup_risk: Math.round(waste_cleanup_risk),
    permit_operational_risk: Math.round(permit_operational_risk),
    data_confidence: Math.round(data_confidence),
    overall_environmental_risk: Math.round(clamp(overall)),
    rationale,
  };
}

export function buildHotspots(snapshot: Pick<EnvRiskSnapshot, "facilities" | "disclosure_rows" | "scores">) {
  const { facilities, disclosure_rows, scores } = snapshot;
  const hotspots: EnvRiskSnapshot["hotspots"] = [];

  const topEnf = [...facilities].sort((a, b) => b.enforcement_flags.length - a.enforcement_flags.length)[0];
  if (topEnf?.enforcement_flags.length) {
    hotspots.push({
      risk_area: "Enforcement / penalties",
      evidence: topEnf.enforcement_flags.join("; "),
      affected_facilities_or_entities: topEnf.facility_name,
      severity: "high",
      what_to_monitor: "ECHO detailed facility report; docketed orders; payment timelines.",
    });
  }

  const topComp = [...facilities].sort((a, b) => b.compliance_flags.length - a.compliance_flags.length)[0];
  if (topComp?.compliance_flags.length) {
    hotspots.push({
      risk_area: "Compliance status",
      evidence: topComp.compliance_flags.join("; "),
      affected_facilities_or_entities: topComp.facility_name,
      severity: /significant|failure/i.test(topComp.compliance_flags.join(" ")) ? "high" : "medium",
      what_to_monitor: "Permit renewals, consent decree milestones, repeat violations.",
    });
  }

  const legalRows = disclosure_rows.filter((d) => d.topic === "legal_environmental" || /litigation|proceeding/i.test(d.extracted_text));
  if (legalRows.length) {
    hotspots.push({
      risk_area: "Filings — legal / proceedings language",
      evidence: legalRows[0].extracted_text.slice(0, 280),
      affected_facilities_or_entities: legalRows[0].facility_reference || "—",
      severity: "medium",
      what_to_monitor: "10-Q legal footers; insurance recoveries; case captions.",
    });
  }

  if (scores.waste_cleanup_risk >= 50) {
    hotspots.push({
      risk_area: "Waste / cleanup exposure (scored)",
      evidence: `Model waste/cleanup sub-score ${scores.waste_cleanup_risk}/100 driven by RCRA/ECHO flags and remediation keywords in filings.`,
      affected_facilities_or_entities: facilities
        .filter((f) => f.waste_flags.length)
        .slice(0, 3)
        .map((f) => f.facility_name)
        .join("; ") || "—",
      severity: "high",
      what_to_monitor: "RCRA corrective action; trust funds; indemnities in credit docs.",
    });
  }

  return hotspots.slice(0, 12);
}
