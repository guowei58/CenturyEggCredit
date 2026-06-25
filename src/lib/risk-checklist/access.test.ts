import { describe, expect, it } from "vitest";
import { canAccessRiskChecklist, canApplyRiskManualOverride } from "./access";

describe("risk checklist access", () => {
  it("allows guowei58@hotmail.com", () => {
    expect(canAccessRiskChecklist("guowei58@hotmail.com")).toBe(true);
    expect(canApplyRiskManualOverride("guowei58@hotmail.com")).toBe(true);
  });

  it("denies other accounts", () => {
    expect(canAccessRiskChecklist("other@example.com")).toBe(false);
    expect(canApplyRiskManualOverride("other@example.com")).toBe(false);
  });
});
