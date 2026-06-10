import type {
  PresentationReviewStatus,
  PresentationSourceType,
  PresentationValidationResult,
  RawPresentationLink,
} from "./types";
import { periodsMatch, parseFiscalPeriodToken } from "./period";

const SOURCE_WEIGHT: Record<PresentationSourceType, number> = {
  sec_exhibit: 22,
  q4_ir: 24,
  live_ir: 18,
  wayback: 14,
  web_search: 10,
};

const DOC_TYPE_WEIGHT: Record<PresentationValidationResult["document_type"], number> = {
  investor_presentation: 28,
  earnings_deck: 24,
  press_release: -15,
  earnings_transcript: -35,
  other: -8,
  unknown: 0,
};

export function reviewStatusForConfidence(confidence: number): PresentationReviewStatus {
  if (confidence >= 85) return "auto_accept";
  if (confidence >= 65) return "review";
  return "reject";
}

export function computeFinalConfidence(
  raw: RawPresentationLink,
  validation: PresentationValidationResult,
  expectedPeriod: string
): number {
  let score = Math.min(40, raw.pre_score * 0.45);
  score += SOURCE_WEIGHT[raw.source_type] ?? 0;

  if (validation.downloaded) score += 8;
  if (validation.company_name_match) score += 18;
  else score -= 40;

  score += DOC_TYPE_WEIGHT[validation.document_type] ?? 0;

  const fp = parseFiscalPeriodToken(expectedPeriod);
  if (validation.period_match && fp) score += 22;
  else if (validation.inferred_period && fp && periodsMatch(fp, validation.inferred_period)) score += 18;

  if (validation.keyword_hits.length >= 3) score += 8;
  if (validation.llm) {
    if (validation.llm.is_presentation) {
      score += validation.llm.confidence_adjustment;
    } else {
      score += Math.min(-10, validation.llm.confidence_adjustment);
    }
  }

  if (validation.reject_reason) score -= 40;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function pickBestCandidate<
  T extends {
    confidence: number;
    review_status: PresentationReviewStatus;
    source_type?: string;
    validation?: { period_match?: boolean };
  },
>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const ar = a.review_status === "reject" ? 1 : 0;
    const br = b.review_status === "reject" ? 1 : 0;
    if (ar !== br) return ar - br;
    const ap = a.validation?.period_match ? 1 : 0;
    const bp = b.validation?.period_match ? 1 : 0;
    if (bp !== ap) return bp - ap;
    const aq = a.source_type === "q4_ir" ? 1 : 0;
    const bq = b.source_type === "q4_ir" ? 1 : 0;
    if (bq !== aq) return bq - aq;
    return b.confidence - a.confidence;
  });
  return sorted.find((c) => c.review_status !== "reject") ?? null;
}
