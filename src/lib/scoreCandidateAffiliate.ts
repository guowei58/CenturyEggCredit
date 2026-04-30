import type { EntityConfidenceLevel } from "@/generated/prisma/client";
import { isGenericRegisteredAgent } from "@/lib/entityNormalize";

export type AffiliateEvidenceSignals = {
  exactRootMatch?: boolean;
  strongNameSimilarity?: boolean;
  weakNameSimilarity?: boolean;
  hqOrPeoExact?: boolean;
  mailingExact?: boolean;
  facilityExact?: boolean;
  cityStateOnly?: boolean;
  officerMatch?: boolean;
  managerMemberMatch?: boolean;
  execNameFromFilings?: boolean;
  registeredAgentSameNonGeneric?: boolean;
  registeredAgentSameGeneric?: boolean;
  inCreditAgreement?: boolean;
  secFilingReference?: boolean;
  officialSosFilingLinked?: boolean;
  uccOrCountyTie?: boolean;
  financeReceivablesPattern?: boolean;
  ipRealEstatePattern?: boolean;
  mgmtOpcoPattern?: boolean;
  unrelatedIndustryWords?: boolean;
  unrelatedGeographyOnly?: boolean;
  onlySimilarNameEvidence?: boolean;
  onlyGenericAgentEvidence?: boolean;
  lacksOfficialLink?: boolean;
};

function clampScore(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function confidenceFromScore(score: number): EntityConfidenceLevel {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

/** Scores candidate affiliate 0–100; never confirms affiliation automatically. */
export function scoreCandidateAffiliate(
  signals: AffiliateEvidenceSignals,
  _extraGenericAgentMatchers: RegExp[] = [],
): { score: number; confidence: EntityConfidenceLevel } {
  let score = 0;

  if (signals.exactRootMatch) score += 25;
  else if (signals.strongNameSimilarity) score += 15;
  else if (signals.weakNameSimilarity) score += 5;

  if (signals.hqOrPeoExact) score += 30;
  else if (signals.mailingExact) score += 20;
  else if (signals.facilityExact) score += 20;
  else if (signals.cityStateOnly) score += 3;

  if (signals.officerMatch) score += 30;
  else if (signals.managerMemberMatch) score += 25;
  else if (signals.execNameFromFilings) score += 20;

  if (signals.registeredAgentSameNonGeneric) score += 10;

  if (signals.inCreditAgreement) score += 35;
  else if (signals.secFilingReference) score += 30;
  else if (signals.officialSosFilingLinked) score += 25;
  else if (signals.uccOrCountyTie) score += 20;

  if (signals.financeReceivablesPattern) score += 10;
  if (signals.ipRealEstatePattern) score += 10;
  if (signals.mgmtOpcoPattern) score += 8;

  if (signals.unrelatedIndustryWords) score -= 20;
  if (signals.unrelatedGeographyOnly) score -= 10;

  let cap = 100;

  if (signals.onlyGenericAgentEvidence || (signals.registeredAgentSameGeneric && score <= 10)) {
    score = clampScore(score, 0, 10);
    cap = Math.min(cap, 10);
  }

  if (signals.onlySimilarNameEvidence) {
    score = clampScore(score, 0, 25);
    cap = Math.min(cap, 25);
  }

  score = clampScore(score, 0, cap);

  if (signals.lacksOfficialLink === true && score >= 55) score = clampScore(score, 0, 44);

  return {
    score: Math.round(score),
    confidence: confidenceFromScore(score),
  };
}

export function classifyRegisteredAgent(agentName: string | null | undefined, extras: RegExp[] = []) {
  const generic = isGenericRegisteredAgent(agentName ?? "", extras);
  return { genericAgent: generic, nonGeneric: !generic };
}
