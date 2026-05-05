import type { EntityUniverseConfidenceKind } from "@/generated/prisma/client";

/** Confidence is orthogonal to relevance (§11). Returns Prisma-compatible enum bucket. */
export type ScoreConfidenceInputs = {
  /** Official exhibit 21 or registry-exact name captured */
  inOfficialSubsidiaryList?: boolean;
  exactNameRegistry?: boolean;
  sourceUrlCaptured?: boolean;
  inCreditDocsWithExcerpt?: boolean;
  /** strong UCC excerpt / filing number */
  strongUccEvidence?: boolean;
  nameRootPlusAddress?: boolean;
  nameRootPlusOfficerManager?: boolean;
  nameRootPlusFinancingPattern?: boolean;
  nameSimilarityOnly?: boolean;
  addressOnly?: boolean;
  noOfficialSource?: boolean;
  genericRegisteredAgentOnly?: boolean;
};

export function scoreEntityConfidence(i: ScoreConfidenceInputs): EntityUniverseConfidenceKind {
  if (i.genericRegisteredAgentOnly && !i.inCreditDocsWithExcerpt && !i.strongUccEvidence) return "low";

  if (
    i.inOfficialSubsidiaryList ||
    (i.exactNameRegistry && i.sourceUrlCaptured) ||
    i.inCreditDocsWithExcerpt ||
    i.strongUccEvidence
  ) {
    return "high";
  }

  if (i.nameRootPlusAddress || i.nameRootPlusOfficerManager || i.nameRootPlusFinancingPattern) {
    return "medium";
  }

  if (i.nameSimilarityOnly || i.addressOnly || i.noOfficialSource) return "low";

  return "unknown";
}
