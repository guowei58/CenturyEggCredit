import { describe, expect, it } from "vitest";
import { pickAnnualColumnIndex } from "@/lib/xbrl-saved-history/parseWorkbook";

describe("pickAnnualColumnIndex", () => {
  it("prefers ~1y duration for income statement", () => {
    const labels = ["2023-10-01 → 2024-09-30", "2024-07-01 → 2024-09-30"];
    const r = pickAnnualColumnIndex(labels, "is");
    expect(r.index).toBe(0);
    expect(r.fyEnd).toBe("2024-09-30");
  });

  it("prefers instant column for balance sheet", () => {
    const labels = ["2024-09-30", "2024-06-30"];
    const r = pickAnnualColumnIndex(labels, "bs");
    expect(r.fyEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
