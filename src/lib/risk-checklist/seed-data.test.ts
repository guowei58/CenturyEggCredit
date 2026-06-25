import { describe, expect, it } from "vitest";
import {
  ISSUER_BUCKET_TOTAL_POINTS,
  ISSUER_RISK_BUCKET_KEYS,
  ISSUER_RISK_QUESTIONS,
  assignEqualIssuerBucketPoints,
} from "./seed-data";

describe("assignEqualIssuerBucketPoints", () => {
  it("allocates 25 points per issuer bucket across questions", () => {
    for (const key of ISSUER_RISK_BUCKET_KEYS) {
      const qs = ISSUER_RISK_QUESTIONS.filter((q) => q.category === key);
      const total = qs.reduce((sum, q) => sum + q.maxPoints, 0);
      expect(total).toBeCloseTo(ISSUER_BUCKET_TOTAL_POINTS, 2);
      const values = qs.map((q) => q.maxPoints);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.011);
    }
  });

  it("distributes remainder cents when 25 does not divide evenly", () => {
    const assigned = assignEqualIssuerBucketPoints([
      {
        questionCode: "A",
        category: "financial",
        questionText: "a",
        displayOrder: 1,
      },
      {
        questionCode: "B",
        category: "financial",
        questionText: "b",
        displayOrder: 2,
      },
      {
        questionCode: "C",
        category: "financial",
        questionText: "c",
        displayOrder: 3,
      },
    ]);
    expect(assigned.reduce((s, q) => s + q.maxPoints, 0)).toBe(25);
  });
});
