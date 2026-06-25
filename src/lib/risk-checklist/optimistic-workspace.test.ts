import { describe, expect, it } from "vitest";
import { applyOptimisticAnswer, mergeSavedAnswerBatch } from "./optimistic-workspace";
import type { RiskAnswerLabel, RiskClassification } from "./types";

function baseWorkspace(
  answerLabel: RiskAnswerLabel = "unknown",
  extraQuestions: Array<{
    id: string;
    questionCode: string;
    category: string;
    maxPoints: number;
    answerLabel: RiskAnswerLabel;
    calculatedPoints: number;
    isIncomplete: boolean;
  }> = []
) {
  return {
    assessment: {
      manualOverrideScore: null,
      manualOverrideClassification: null,
      isEditable: true,
      updatedAt: new Date(0).toISOString(),
    },
    scores: {
      riskVelocity: null,
      riskVelocityStatus: "Insufficient History",
      rawScoreRounded: 50,
      effectiveScoreRounded: 50,
      finalScoreRounded: 50,
      rawScore: 50,
      effectiveScore: 50,
      finalScore: 50,
      classification: "Elevated Risk" as RiskClassification,
      effectiveClassification: "Elevated Risk" as RiskClassification,
    },
    categories: [
      {
        key: "industry_business",
        label: "Industry and Business Risk",
        maxPoints: 5,
        earnedPoints: 2.5,
        applicableMaxPoints: 5,
        displayScore: 50,
        displayScoreRounded: 50,
        unansweredCount: 1,
      },
    ],
    questions: [
      {
        id: "q1",
        questionCode: "IBR-01",
        category: "industry_business",
        maxPoints: 5,
        answerLabel,
        calculatedPoints: 2.5,
        isIncomplete: answerLabel === "unknown",
      },
      ...extraQuestions,
    ],
  };
}

describe("applyOptimisticAnswer", () => {
  it("updates question points and raw score immediately for No", () => {
    const next = applyOptimisticAnswer(baseWorkspace("unknown"), "q1", "no");
    expect(next.questions[0]?.calculatedPoints).toBe(0);
    expect(next.questions[0]?.isIncomplete).toBe(false);
    expect(next.scores.rawScoreRounded).toBe(0);
    expect(next.categories[0]?.unansweredCount).toBe(0);
  });

  it("updates question points for Yes", () => {
    const next = applyOptimisticAnswer(baseWorkspace("unknown"), "q1", "yes");
    expect(next.questions[0]?.calculatedPoints).toBe(5);
    expect(next.scores.rawScoreRounded).toBe(100);
  });
});

describe("mergeSavedAnswerBatch", () => {
  it("keeps newer local answers when a stale save returns for another question", () => {
    const withTwo = baseWorkspace("unknown", [
      {
        id: "q2",
        questionCode: "IBR-02",
        category: "industry_business",
        maxPoints: 5,
        answerLabel: "unknown",
        calculatedPoints: 2.5,
        isIncomplete: true,
      },
    ]);
    const local = applyOptimisticAnswer(applyOptimisticAnswer(withTwo, "q1", "yes"), "q2", "no");
    const server = applyOptimisticAnswer(withTwo, "q1", "yes");
    const merged = mergeSavedAnswerBatch(local, server, [["q1", "yes"]], new Set(["q2"]));
    expect(merged.questions.find((q) => q.id === "q1")?.answerLabel).toBe("yes");
    expect(merged.questions.find((q) => q.id === "q2")?.answerLabel).toBe("no");
  });

  it("ignores a stale save when a newer answer is already in flight", () => {
    const local = applyOptimisticAnswer(baseWorkspace(), "q1", "no");
    const server = applyOptimisticAnswer(baseWorkspace(), "q1", "yes");
    const merged = mergeSavedAnswerBatch(
      local,
      server,
      [["q1", "yes"]],
      new Set(),
      new Map([["q1", "no"]])
    );
    expect(merged.questions[0]?.answerLabel).toBe("no");
  });
});
