import { describe, expect, it } from "vitest";
import {
  assessBulkUpdatePreflight,
  countMissingOnlyRunSteps,
  shouldSkipBulkStep,
  type BulkPreflightSnapshot,
} from "@/lib/bulk-update-preflight";
import type { BulkUpdateStep } from "@/lib/bulk-ai-open";

function snap(overrides: Partial<BulkPreflightSnapshot> = {}): BulkPreflightSnapshot {
  return {
    nonEmptySaveKeys: new Set(),
    hasCapitalStructureExcel: false,
    hasOrgChartExcel: false,
    earningsPackageComplete: false,
    entityMapperComplete: false,
    ...overrides,
  };
}

describe("assessBulkUpdatePreflight", () => {
  const steps: BulkUpdateStep[] = [
    { type: "prompt", label: "Overview", saveKey: "overview", prompt: "x" },
    { type: "excel-prompt", label: "Capital structure (Excel)", target: "capital-structure", prompt: "x" },
    { type: "entity-mapper", label: "Entity Mapper" },
    { type: "work-product", label: "KPI Commentary", kind: "kpi", saveKey: "kpi-latest" },
    { type: "ai-memo", label: "AI Credit Memo", saveKey: "ai-credit-memo-latest" },
  ];

  it("marks saved text and excel steps complete and splits phases", () => {
    const r = assessBulkUpdatePreflight(
      steps,
      snap({
        nonEmptySaveKeys: new Set(["overview", "kpi-latest", "ai-credit-memo-latest"]),
        hasCapitalStructureExcel: true,
      })
    );
    expect(r.sourcesCompleteCount).toBe(2);
    expect(r.sourcesMissingCount).toBe(1);
    expect(r.workProductCount).toBe(2);
    expect(r.workProductCompleteCount).toBe(2);
    expect(r.steps.find((s) => s.label === "Overview")?.phase).toBe("sources");
    expect(r.steps.find((s) => s.label === "KPI Commentary")?.phase).toBe("work-product");
  });
});

describe("shouldSkipBulkStep", () => {
  const kpiStep: BulkUpdateStep = {
    type: "work-product",
    label: "KPI Commentary",
    kind: "kpi",
    saveKey: "kpi-latest",
  };
  const pf = { index: 3, label: "KPI Commentary", complete: true, phase: "work-product" as const };

  it("does not skip work products when refreshing in missing-only mode", () => {
    expect(shouldSkipBulkStep(kpiStep, pf, "missing-only", true)).toBe(false);
  });

  it("skips work products when refreshWorkProducts is false", () => {
    expect(shouldSkipBulkStep(kpiStep, pf, "missing-only", false)).toBe(true);
  });
});

describe("countMissingOnlyRunSteps", () => {
  it("counts missing sources plus all work products when refreshing", () => {
    const preflight = assessBulkUpdatePreflight(
      [
        { type: "prompt", label: "Overview", saveKey: "overview", prompt: "x" },
        { type: "work-product", label: "KPI", kind: "kpi", saveKey: "kpi-latest" },
        { type: "ai-memo", label: "Memo", saveKey: "ai-credit-memo-latest" },
      ],
      snap({ nonEmptySaveKeys: new Set(["kpi-latest"]) })
    );
    expect(countMissingOnlyRunSteps(preflight, true)).toBe(3);
    expect(countMissingOnlyRunSteps(preflight, false)).toBe(1);
  });
});
