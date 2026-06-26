import { describe, expect, it } from "vitest";
import {
  ISSUER_CATEGORY_BUCKET_POINTS,
  ISSUER_RISK_BUCKET_KEYS,
  ISSUER_RISK_QUESTIONS,
  assignEqualIssuerBucketPoints,
} from "./seed-data";

describe("assignEqualIssuerBucketPoints", () => {
  it("allocates weighted issuer bucket totals across questions", () => {
    for (const key of ISSUER_RISK_BUCKET_KEYS) {
      const qs = ISSUER_RISK_QUESTIONS.filter((q) => q.category === key);
      const bucketTotal = ISSUER_CATEGORY_BUCKET_POINTS[key]!;
      const total = qs.reduce((sum, q) => sum + q.maxPoints, 0);
      expect(total).toBeCloseTo(bucketTotal, 2);
      const values = qs.map((q) => q.maxPoints);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.011);
    }
  });

  it("weights industry & business at 40 and other buckets at 20", () => {
    expect(ISSUER_CATEGORY_BUCKET_POINTS.industry_business).toBe(40);
    expect(ISSUER_CATEGORY_BUCKET_POINTS.financial).toBe(20);
    expect(ISSUER_CATEGORY_BUCKET_POINTS.liquidity_capital).toBe(20);
    expect(ISSUER_CATEGORY_BUCKET_POINTS.management_governance).toBe(20);
    const grandTotal = ISSUER_RISK_BUCKET_KEYS.reduce(
      (sum, key) => sum + ISSUER_CATEGORY_BUCKET_POINTS[key]!,
      0
    );
    expect(grandTotal).toBe(100);
  });

  it("distributes remainder cents when bucket total does not divide evenly", () => {
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
    expect(assigned.reduce((s, q) => s + q.maxPoints, 0)).toBe(20);
  });
});
