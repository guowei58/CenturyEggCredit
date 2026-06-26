import { describe, expect, it } from "vitest";
import { canAccessRiskChecklist, canApplyRiskManualOverride } from "./access";

describe("risk checklist access", () => {
  it("allows any signed-in user for checklist and PM dashboard", () => {
    expect(canAccessRiskChecklist("guowei58@hotmail.com")).toBe(true);
    expect(canAccessRiskChecklist("other@example.com")).toBe(true);
  });

  it("denies unsigned users", () => {
    expect(canAccessRiskChecklist(null)).toBe(false);
    expect(canAccessRiskChecklist("")).toBe(false);
    expect(canAccessRiskChecklist("   ")).toBe(false);
  });

  it("restricts manual override to the override account", () => {
    expect(canApplyRiskManualOverride("guowei58@hotmail.com")).toBe(true);
    expect(canApplyRiskManualOverride("other@example.com")).toBe(false);
  });
});
