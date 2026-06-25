import {
  applyDaggerOverrides,
  calculateDataConfidence,
  calculateQuestionPoints,
  classifyRiskScore,
  clampScore,
  isAnswerExcludedFromScoring,
  isUnknownAnswer,
} from "./classification";
import type {
  CategoryScoreResult,
  DaggerFlagState,
  IssuerScoreResult,
  ScoringQuestionInput,
} from "./types";

export function normalizeCategoryScores(
  questions: ScoringQuestionInput[]
): CategoryScoreResult[] {
  const byCategory = new Map<string, CategoryScoreResult>();

  for (const q of questions) {
    if (!byCategory.has(q.category)) {
      byCategory.set(q.category, {
        category: q.category,
        earnedPoints: 0,
        applicableMaxPoints: 0,
        displayScore: 0,
        unansweredCount: 0,
      });
    }
    const row = byCategory.get(q.category)!;
    if (isAnswerExcludedFromScoring(q.answerLabel)) continue;
    row.applicableMaxPoints += q.maxPoints;
    row.earnedPoints += calculateQuestionPoints(q.maxPoints, q.answerLabel);
    if (isUnknownAnswer(q.answerLabel)) row.unansweredCount += 1;
  }

  for (const row of byCategory.values()) {
    row.displayScore =
      row.applicableMaxPoints > 0 ? (row.earnedPoints / row.applicableMaxPoints) * 100 : 0;
  }

  return Array.from(byCategory.values());
}

export function calculateNormalizedIssuerScore(questions: ScoringQuestionInput[]): {
  rawScore: number;
  totalEarnedPoints: number;
  totalApplicableMaxPoints: number;
  categoryScores: CategoryScoreResult[];
  dataConfidence: ReturnType<typeof calculateDataConfidence>;
} {
  const categoryScores = normalizeCategoryScores(questions);
  let totalEarned = 0;
  let totalApplicable = 0;

  for (const q of questions) {
    if (isAnswerExcludedFromScoring(q.answerLabel)) continue;
    totalApplicable += q.maxPoints;
    totalEarned += calculateQuestionPoints(q.maxPoints, q.answerLabel);
  }

  const rawScore = totalApplicable > 0 ? clampScore((totalEarned / totalApplicable) * 100) : 0;
  const dataConfidence = calculateDataConfidence(
    questions.map((q) => ({ maxPoints: q.maxPoints, answerLabel: q.answerLabel }))
  );

  return {
    rawScore,
    totalEarnedPoints: totalEarned,
    totalApplicableMaxPoints: totalApplicable,
    categoryScores,
    dataConfidence,
  };
}

export function calculateIssuerRiskScore(params: {
  questions: ScoringQuestionInput[];
  activeDaggers: DaggerFlagState[];
  manualOverrideScore?: number | null;
  manualOverrideClassification?: string | null;
}): IssuerScoreResult {
  const base = calculateNormalizedIssuerScore(params.questions);
  const daggerResult = applyDaggerOverrides({
    rawScore: base.rawScore,
    activeDaggers: params.activeDaggers,
  });

  let finalScore = daggerResult.effectiveScore;
  let effectiveClassification = daggerResult.classification;

  if (params.manualOverrideScore != null && Number.isFinite(params.manualOverrideScore)) {
    finalScore = clampScore(params.manualOverrideScore);
    if (params.manualOverrideClassification) {
      effectiveClassification = params.manualOverrideClassification as IssuerScoreResult["effectiveClassification"];
    } else {
      effectiveClassification = classifyRiskScore(finalScore);
    }
  }

  return {
    rawScore: base.rawScore,
    effectiveScore: daggerResult.effectiveScore,
    finalScore,
    classification: classifyRiskScore(base.rawScore),
    effectiveClassification,
    daggerOverrideReason: daggerResult.overrideReason,
    dataConfidence: base.dataConfidence.percent,
    dataConfidenceLabel: base.dataConfidence.label,
    categoryScores: base.categoryScores,
    totalEarnedPoints: base.totalEarnedPoints,
    totalApplicableMaxPoints: base.totalApplicableMaxPoints,
  };
}

export function calculateSecurityRiskScore(questions: ScoringQuestionInput[]): {
  rawScore: number;
  dataConfidence: number;
  dataConfidenceLabel: ReturnType<typeof calculateDataConfidence>["label"];
} {
  const base = calculateNormalizedIssuerScore(questions);
  return {
    rawScore: base.rawScore,
    dataConfidence: base.dataConfidence.percent,
    dataConfidenceLabel: base.dataConfidence.label,
  };
}
