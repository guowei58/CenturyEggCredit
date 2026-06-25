import type {
  DataConfidenceLabel,
  RiskAnswerLabel,
  RiskClassification,
  RiskVelocityStatus,
} from "./types";

export const ANSWER_VALUE_MAP: Record<RiskAnswerLabel, number> = {
  no: 0,
  mixed: 0.5,
  yes: 1,
  unknown: 0.5,
  not_applicable: 0,
};

export function answerLabelToValue(label: RiskAnswerLabel | null | undefined): number {
  if (!label) return ANSWER_VALUE_MAP.unknown;
  return ANSWER_VALUE_MAP[label];
}

export function isAnswerExcludedFromScoring(label: RiskAnswerLabel | null | undefined): boolean {
  return label === "not_applicable";
}

export function isUnknownAnswer(label: RiskAnswerLabel | null | undefined): boolean {
  return !label || label === "unknown";
}

export function calculateQuestionPoints(maxPoints: number, label: RiskAnswerLabel | null | undefined): number {
  if (isAnswerExcludedFromScoring(label)) return 0;
  return maxPoints * answerLabelToValue(label);
}

export function classifyRiskScore(score: number): RiskClassification {
  const s = clampScore(score);
  if (s <= 20) return "Low Risk";
  if (s <= 35) return "Moderate Risk";
  if (s <= 50) return "Elevated Risk";
  if (s <= 65) return "High Risk";
  if (s <= 80) return "Very High Risk";
  return "Critical Risk";
}

export function classificationFloorScore(classification: RiskClassification): number {
  switch (classification) {
    case "Low Risk":
      return 0;
    case "Moderate Risk":
      return 21;
    case "Elevated Risk":
      return 36;
    case "High Risk":
      return 51;
    case "Very High Risk":
      return 66;
    case "Critical Risk":
      return 81;
    default:
      return 0;
  }
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

export function roundDisplayScore(score: number): number {
  return Math.round(clampScore(score));
}

export function calculateDataConfidence(
  questions: Array<{ maxPoints: number; answerLabel: RiskAnswerLabel | null | undefined }>
): { percent: number; label: DataConfidenceLabel } {
  let totalApplicable = 0;
  let nonUnknownApplicable = 0;

  for (const q of questions) {
    if (isAnswerExcludedFromScoring(q.answerLabel)) continue;
    totalApplicable += q.maxPoints;
    if (!isUnknownAnswer(q.answerLabel)) {
      nonUnknownApplicable += q.maxPoints;
    }
  }

  if (totalApplicable <= 0) {
    return { percent: 0, label: "Low Confidence" };
  }

  const percent = (nonUnknownApplicable / totalApplicable) * 100;
  let label: DataConfidenceLabel = "Low Confidence";
  if (percent >= 85) label = "High Confidence";
  else if (percent >= 60) label = "Medium Confidence";

  return { percent, label };
}

export function isDag03QualifyingEvent(flag: {
  daggerCode: string;
  isActive: boolean;
  analystComment?: string | null;
}): boolean {
  if (!flag.isActive || flag.daggerCode !== "DAG-03") return false;
  const text = (flag.analystComment ?? "").toLowerCase();
  if (!text.trim()) return true;
  return (
    text.includes("payment default") ||
    text.includes("covenant breach") ||
    text.includes("going-concern") ||
    text.includes("going concern") ||
    text.includes("restructuring adviser") ||
    text.includes("restructuring advisor") ||
    text.includes("missed payment")
  );
}

export function applyDaggerOverrides(params: {
  rawScore: number;
  activeDaggers: Array<{ daggerCode: string; isActive: boolean; analystComment?: string | null }>;
}): { effectiveScore: number; overrideReason: string | null; classification: RiskClassification } {
  const raw = clampScore(params.rawScore);
  let effective = raw;
  const reasons: string[] = [];
  const active = params.activeDaggers.filter((d) => d.isActive);

  if (active.length >= 2) {
    const floor = classificationFloorScore("Very High Risk");
    if (effective < floor) {
      effective = floor;
      reasons.push("Two or more active Dagger Flags");
    }
  } else if (active.length === 1) {
    const floor = classificationFloorScore("High Risk");
    if (effective < floor) {
      effective = floor;
      reasons.push("One active Dagger Flag");
    }
  }

  if (active.some(isDag03QualifyingEvent)) {
    if (effective < 85) {
      effective = 85;
      reasons.push("Active DAG-03 qualifying event");
    }
  }

  const classification = classifyRiskScore(effective);
  return {
    effectiveScore: effective,
    overrideReason: reasons.length ? reasons.join("; ") : null,
    classification,
  };
}

export function calculateOverallCreditRiskScore(
  effectiveIssuerScore: number,
  securityScore: number,
  weights: { issuerWeightPercent: number; securityWeightPercent: number }
): number {
  const total = weights.issuerWeightPercent + weights.securityWeightPercent;
  if (total !== 100) {
    throw new Error("Issuer and security weights must sum to 100");
  }
  const issuerW = weights.issuerWeightPercent / 100;
  const securityW = weights.securityWeightPercent / 100;
  return clampScore(effectiveIssuerScore * issuerW + securityScore * securityW);
}

export function classifyRiskVelocity(delta: number | null): RiskVelocityStatus {
  if (delta == null || !Number.isFinite(delta)) return "Insufficient History";
  if (delta <= -10) return "Material Improvement";
  if (delta <= -5) return "Improving";
  if (delta <= 4) return "Stable";
  if (delta <= 9) return "Deteriorating";
  return "Rapid Deterioration";
}

export function defaultReviewDaysForClassification(classification: RiskClassification): number {
  switch (classification) {
    case "Low Risk":
      return 180;
    case "Moderate Risk":
      return 120;
    case "Elevated Risk":
      return 90;
    case "High Risk":
      return 60;
    case "Very High Risk":
      return 30;
    case "Critical Risk":
      return 14;
    default:
      return 90;
  }
}

export function riskClassificationColor(classification: RiskClassification): string {
  switch (classification) {
    case "Low Risk":
      return "var(--green, #22c55e)";
    case "Moderate Risk":
      return "#3b82f6";
    case "Elevated Risk":
      return "#f59e0b";
    case "High Risk":
      return "#f97316";
    case "Very High Risk":
      return "#ef4444";
    case "Critical Risk":
      return "#991b1b";
    default:
      return "var(--muted2)";
  }
}
