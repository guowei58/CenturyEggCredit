import { describe, expect, it } from "vitest";

import {
  applyResearchTabPromptStyle,
  CANON_RESEARCH_SAVE_KEYS,
  resolveResearchTabOutputLayer,
} from "@/lib/research-tab-output-style";

describe("resolveResearchTabOutputLayer", () => {
  it("classifies canon and delta tabs", () => {
    expect(resolveResearchTabOutputLayer({ researchSaveKey: "overview" })).toBe("canon");
    expect(resolveResearchTabOutputLayer({ researchSaveKey: "customers" })).toBe("delta");
    expect(CANON_RESEARCH_SAVE_KEYS.has("business-model")).toBe(true);
  });

  it("classifies credit docs and work products", () => {
    expect(
      resolveResearchTabOutputLayer({ researchSaveKey: "credit-agreements-indentures-credit-agreement" })
    ).toBe("credit-doc");
    expect(resolveResearchTabOutputLayer({ workProductKind: "kpi" })).toBe("work-product");
    expect(resolveResearchTabOutputLayer({ workProductKind: "literary" })).toBe("creative");
  });

  it("classifies excel deliverable tabs", () => {
    expect(resolveResearchTabOutputLayer({ researchSaveKey: "capital-structure" })).toBe("excel-deliverable");
    expect(resolveResearchTabOutputLayer({ researchSaveKey: "org-chart-prompt" })).toBe("excel-deliverable");
  });
});

describe("applyResearchTabPromptStyle", () => {
  it("uses excel-deliverable system for capital structure API", () => {
    const out = applyResearchTabPromptStyle({
      userPrompt: "Build workbook",
      researchSaveKey: "capital-structure",
    });
    expect(out.layer).toBe("excel-deliverable");
    expect(out.systemPrompt).toContain("base64");
  });

  it("prepends delta block for non-canon research tabs", () => {
    const out = applyResearchTabPromptStyle({
      userPrompt: "Analyze customers.",
      researchSaveKey: "customers",
    });
    expect(out.layer).toBe("delta");
    expect(out.userPrompt).toContain("**delta** tab");
    expect(out.userPrompt).toContain("Analyze customers.");
  });

  it("appends work-product system block", () => {
    const out = applyResearchTabPromptStyle({
      userPrompt: "Task",
      systemPrompt: "You are an analyst.",
      workProductKind: "forensic",
    });
    expect(out.layer).toBe("work-product");
    expect(out.systemPrompt).toContain("source pack already contains");
  });
});
