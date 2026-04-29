import type { PublicRecordsCoverageQuality } from "@/generated/prisma/client";
import type { PublicRecordsProfileForRecommend } from "@/lib/recommendPublicRecordSources";
import { recommendPublicRecordSources } from "@/lib/recommendPublicRecordSources";

export type CoverageInputs = {
  profile: PublicRecordsProfileForRecommend & {
    borrowerNames?: string[];
    guarantorNames?: string[];
    subsidiaryNames?: string[];
    parentCompanyNames?: string[];
  };
  checklistCheckedCount: number;
  recommendedSourceCount: number;
  recordsHighRiskCount: number;
  unresolvedChecklistCount: number;
};

export function computeCoverageQuality(input: CoverageInputs): PublicRecordsCoverageQuality {
  const rec = recommendPublicRecordSources(input.profile);
  const recCount = Math.max(rec.length, input.recommendedSourceCount);
  const checkedRatio = recCount > 0 ? input.checklistCheckedCount / recCount : 0;

  const hasMultiEntity =
    (input.profile.borrowerNames?.length ?? 0) > 0 ||
    (input.profile.guarantorNames?.length ?? 0) > 0 ||
    (input.profile.subsidiaryNames?.length ?? 0) > 0;
  const hasGeo =
    Boolean(input.profile.hqState && input.profile.hqCounty) ||
    Boolean(input.profile.majorFacilityLocations) ||
    Boolean(input.profile.knownPropertyLocations);

  if (hasMultiEntity && hasGeo && checkedRatio >= 0.5 && input.unresolvedChecklistCount <= 3) {
    return "high";
  }
  if (checkedRatio >= 0.25 && (hasGeo || hasMultiEntity)) {
    return "medium";
  }
  return "low";
}
