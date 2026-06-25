import { describe, expect, it } from "vitest";
import {
  applyDaggerOverrides,
  calculateDataConfidence,
  calculateOverallCreditRiskScore,
  classifyRiskScore,
} from "./classification";
import { calculateIssuerRiskScore, calculateNormalizedIssuerScore } from "./scoring";
import { calculateRiskVelocity } from "./velocity";
import type { ScoringQuestionInput } from "./types";

function makeQuestions(
  label: "no" | "mixed" | "yes" | "unknown" | "not_applicable",
  count = 3,
  maxPoints = 10
): ScoringQuestionInput[] {
  return Array.from({ length: count }, (_, i) => ({
    questionId: `q-${i}`,
    questionCode: `Q-${i}`,
    category: "financial",
    maxPoints,
    answerLabel: label,
  }));
}

describe("risk checklist scoring engine", () => {
  it("all No answers produce a score of 0", () => {
    const result = calculateNormalizedIssuerScore(makeQuestions("no"));
    expect(result.rawScore).toBe(0);
  });

  it("all Yes answers produce a score of 100", () => {
    const result = calculateNormalizedIssuerScore(makeQuestions("yes"));
    expect(result.rawScore).toBe(100);
  });

  it("all Mixed answers produce a score of 50", () => {
    const result = calculateNormalizedIssuerScore(makeQuestions("mixed"));
    expect(result.rawScore).toBe(50);
  });

  it("Unknown answers receive half points", () => {
    const result = calculateNormalizedIssuerScore(makeQuestions("unknown", 2, 10));
    expect(result.rawScore).toBe(50);
  });

  it("Not Applicable questions are excluded and remaining points normalize correctly", () => {
    const questions: ScoringQuestionInput[] = [
      { questionId: "1", questionCode: "A", category: "financial", maxPoints: 50, answerLabel: "yes" },
      { questionId: "2", questionCode: "B", category: "financial", maxPoints: 50, answerLabel: "not_applicable" },
    ];
    const result = calculateNormalizedIssuerScore(questions);
    expect(result.rawScore).toBe(100);
    expect(result.totalApplicableMaxPoints).toBe(50);
  });

  it("one Dagger Flag creates a classification floor of High Risk", () => {
    const result = applyDaggerOverrides({
      rawScore: 40,
      activeDaggers: [{ daggerCode: "DAG-01", isActive: true }],
    });
    expect(result.effectiveScore).toBeGreaterThanOrEqual(51);
    expect(result.classification).toBe("High Risk");
  });

  it("two Dagger Flags create a classification floor of Very High Risk", () => {
    const result = applyDaggerOverrides({
      rawScore: 40,
      activeDaggers: [
        { daggerCode: "DAG-01", isActive: true },
        { daggerCode: "DAG-02", isActive: true },
      ],
    });
    expect(result.effectiveScore).toBeGreaterThanOrEqual(66);
    expect(result.classification).toBe("Very High Risk");
  });

  it("qualifying DAG-03 event creates an effective score floor of 85", () => {
    const result = applyDaggerOverrides({
      rawScore: 54,
      activeDaggers: [
        {
          daggerCode: "DAG-03",
          isActive: true,
          analystComment: "Covenant breach disclosed in 10-Q",
        },
      ],
    });
    expect(result.effectiveScore).toBe(85);
  });

  it("raw score remains unchanged after a Dagger override", () => {
    const questions = makeQuestions("mixed");
    const issuer = calculateIssuerRiskScore({
      questions,
      activeDaggers: [{ daggerCode: "DAG-01", isActive: true }],
    });
    expect(issuer.rawScore).toBe(50);
    expect(issuer.effectiveScore).toBeGreaterThan(issuer.rawScore);
  });

  it("manual override does not change the calculated score", () => {
    const issuer = calculateIssuerRiskScore({
      questions: makeQuestions("mixed"),
      activeDaggers: [],
      manualOverrideScore: 72,
    });
    expect(issuer.rawScore).toBe(50);
    expect(issuer.effectiveScore).toBe(50);
    expect(issuer.finalScore).toBe(72);
  });

  it("issuer and security weighting produces the correct Overall Credit Risk Score", () => {
    const overall = calculateOverallCreditRiskScore(60, 40, {
      issuerWeightPercent: 75,
      securityWeightPercent: 25,
    });
    expect(overall).toBe(55);
  });

  it("historical template versioning preserves prior assessment scores conceptually", () => {
    const v1 = calculateNormalizedIssuerScore(makeQuestions("no", 1, 100));
    const v2 = calculateNormalizedIssuerScore(makeQuestions("yes", 1, 100));
    expect(v1.rawScore).toBe(0);
    expect(v2.rawScore).toBe(100);
  });

  it("Risk Velocity uses the correct prior assessment", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const history = [
      { effectiveScore: 70, completedAt: new Date("2026-03-15T12:00:00Z") },
      { effectiveScore: 50, completedAt: new Date("2025-12-15T12:00:00Z") },
    ];
    const velocity = calculateRiskVelocity(80, history, now);
    expect(velocity.delta).toBe(10);
    expect(velocity.status).toBe("Rapid Deterioration");
  });

  it("Risk Velocity displays Insufficient History when appropriate", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const velocity = calculateRiskVelocity(80, [], now);
    expect(velocity.status).toBe("Insufficient History");
    expect(velocity.delta).toBeNull();
  });

  it("Data Confidence declines when questions are Unknown or unanswered", () => {
    const confidence = calculateDataConfidence([
      { maxPoints: 50, answerLabel: "yes" },
      { maxPoints: 50, answerLabel: "unknown" },
    ]);
    expect(confidence.percent).toBe(50);
    expect(confidence.label).toBe("Low Confidence");
  });

  it("scores never fall below 0 or exceed 100", () => {
    const high = calculateNormalizedIssuerScore(makeQuestions("yes", 5, 100));
    const low = calculateNormalizedIssuerScore(makeQuestions("no", 5, 100));
    expect(high.rawScore).toBeLessThanOrEqual(100);
    expect(low.rawScore).toBeGreaterThanOrEqual(0);
  });

  it("classifies risk score bands", () => {
    expect(classifyRiskScore(15)).toBe("Low Risk");
    expect(classifyRiskScore(30)).toBe("Moderate Risk");
    expect(classifyRiskScore(45)).toBe("Elevated Risk");
    expect(classifyRiskScore(60)).toBe("High Risk");
    expect(classifyRiskScore(75)).toBe("Very High Risk");
    expect(classifyRiskScore(90)).toBe("Critical Risk");
  });
});
