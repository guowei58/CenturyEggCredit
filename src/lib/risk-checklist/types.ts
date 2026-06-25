export type RiskAnswerLabel = "no" | "mixed" | "yes" | "unknown" | "not_applicable";

export type RiskClassification =
  | "Low Risk"
  | "Moderate Risk"
  | "Elevated Risk"
  | "High Risk"
  | "Very High Risk"
  | "Critical Risk";

export type RiskVelocityStatus =
  | "Material Improvement"
  | "Improving"
  | "Stable"
  | "Deteriorating"
  | "Rapid Deterioration"
  | "Insufficient History";

export type DataConfidenceLabel = "High Confidence" | "Medium Confidence" | "Low Confidence";

export type ScoringQuestionInput = {
  questionId: string;
  questionCode: string;
  category: string;
  maxPoints: number;
  answerLabel: RiskAnswerLabel | null;
  isDagger?: boolean;
};

export type CategoryScoreResult = {
  category: string;
  earnedPoints: number;
  applicableMaxPoints: number;
  displayScore: number;
  unansweredCount: number;
};

export type IssuerScoreResult = {
  rawScore: number;
  effectiveScore: number;
  finalScore: number;
  classification: RiskClassification;
  effectiveClassification: RiskClassification;
  daggerOverrideReason: string | null;
  dataConfidence: number;
  dataConfidenceLabel: DataConfidenceLabel;
  categoryScores: CategoryScoreResult[];
  totalEarnedPoints: number;
  totalApplicableMaxPoints: number;
};

export type DaggerFlagState = {
  daggerCode: string;
  isActive: boolean;
  analystComment?: string | null;
};

export type RiskScoringWeights = {
  issuerWeightPercent: number;
  securityWeightPercent: number;
};
