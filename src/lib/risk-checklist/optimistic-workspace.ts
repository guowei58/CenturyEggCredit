import { calculateQuestionPoints, isUnknownAnswer, roundDisplayScore } from "./classification";
import { calculateIssuerRiskScore } from "./scoring";
import type { RiskAnswerLabel, RiskClassification } from "./types";

/** Minimal workspace shape needed to recalculate scores after an answer change. */
export type OptimisticRiskWorkspace = {
  assessment: {
    manualOverrideScore: number | null;
    manualOverrideClassification: string | null;
    isEditable: boolean;
    updatedAt: string;
  };
  scores: {
    riskVelocity: number | null;
    riskVelocityStatus: string;
    rawScoreRounded: number;
    effectiveScoreRounded: number;
    finalScoreRounded: number;
    rawScore: number;
    effectiveScore: number;
    finalScore: number;
    classification: RiskClassification;
    effectiveClassification: RiskClassification;
  };
  categories: Array<{
    key: string;
    label: string;
    maxPoints: number;
    earnedPoints: number;
    applicableMaxPoints: number;
    displayScore: number;
    displayScoreRounded: number;
    unansweredCount: number;
  }>;
  questions: Array<{
    id: string;
    questionCode: string;
    category: string;
    maxPoints: number;
    answerLabel: RiskAnswerLabel;
    calculatedPoints: number;
    isIncomplete: boolean;
  }>;
};

export function applyOptimisticAnswer<T extends OptimisticRiskWorkspace>(
  workspace: T,
  questionId: string,
  answerLabel: RiskAnswerLabel
): T {
  const questions = workspace.questions.map((q) => {
    if (q.id !== questionId) return q;
    return {
      ...q,
      answerLabel,
      calculatedPoints: calculateQuestionPoints(q.maxPoints, answerLabel),
      isIncomplete: isUnknownAnswer(answerLabel),
    };
  });

  const scoringInputs = questions.map((q) => ({
    questionId: q.id,
    questionCode: q.questionCode,
    category: q.category,
    maxPoints: q.maxPoints,
    answerLabel: q.answerLabel,
  }));

  const score = calculateIssuerRiskScore({
    questions: scoringInputs,
    activeDaggers: [],
    manualOverrideScore: workspace.assessment.manualOverrideScore,
    manualOverrideClassification: workspace.assessment.manualOverrideClassification,
  });

  const categories = workspace.categories.map((cat) => {
    const row = score.categoryScores.find((c) => c.category === cat.key);
    return {
      ...cat,
      earnedPoints: row?.earnedPoints ?? 0,
      applicableMaxPoints: row?.applicableMaxPoints ?? 0,
      displayScore: row?.displayScore ?? 0,
      displayScoreRounded: roundDisplayScore(row?.displayScore ?? 0),
      unansweredCount: row?.unansweredCount ?? 0,
    };
  });

  const finalScoreRounded = roundDisplayScore(
    workspace.assessment.manualOverrideScore ?? score.finalScore
  );

  return {
    ...workspace,
    assessment: {
      ...workspace.assessment,
      updatedAt: new Date().toISOString(),
    },
    scores: {
      ...workspace.scores,
      rawScore: score.rawScore,
      effectiveScore: score.effectiveScore,
      finalScore: workspace.assessment.manualOverrideScore ?? score.finalScore,
      classification: score.classification,
      effectiveClassification:
        (workspace.assessment.manualOverrideClassification as RiskClassification | null) ??
        score.effectiveClassification,
      rawScoreRounded: roundDisplayScore(score.rawScore),
      effectiveScoreRounded: roundDisplayScore(score.effectiveScore),
      finalScoreRounded,
    },
    categories,
    questions,
  };
}

/** Apply a persisted save batch without clobbering newer local edits still queued or in flight. */
export function mergeSavedAnswerBatch<T extends OptimisticRiskWorkspace>(
  local: T,
  server: T,
  batch: ReadonlyArray<readonly [questionId: string, answerLabel: RiskAnswerLabel]>,
  stillPending: ReadonlySet<string>,
  inFlight: ReadonlyMap<string, RiskAnswerLabel> = new Map()
): T {
  let merged = local;
  for (const [questionId, sentLabel] of batch) {
    if (stillPending.has(questionId)) continue;
    const newerInFlight = inFlight.get(questionId);
    if (newerInFlight != null && newerInFlight !== sentLabel) continue;
    const serverQ = server.questions.find((q) => q.id === questionId);
    const label = serverQ?.answerLabel ?? sentLabel;
    merged = applyOptimisticAnswer(merged, questionId, label);
  }
  return merged;
}

export function mergedQuestionIdsFromBatch(
  batch: ReadonlyArray<readonly [questionId: string, answerLabel: RiskAnswerLabel]>,
  stillPending: ReadonlySet<string>,
  inFlight: ReadonlyMap<string, RiskAnswerLabel>
): string[] {
  return batch
    .filter(([questionId, sentLabel]) => {
      if (stillPending.has(questionId)) return false;
      const newerInFlight = inFlight.get(questionId);
      return newerInFlight == null || newerInFlight === sentLabel;
    })
    .map(([questionId]) => questionId);
}
