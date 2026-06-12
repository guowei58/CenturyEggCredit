import { describe, expect, it } from "vitest";
import { fillCompanyPromptTemplate, resolveCompanyPromptLabels } from "@/lib/company-prompt-labels";
import { privateWorkspaceKeyFromName } from "@/lib/company-workspace-key";

describe("resolveCompanyPromptLabels", () => {
  it("uses company name instead of PRIV code in prompts for private companies", () => {
    const key = privateWorkspaceKeyFromName("Mixbook");
    expect(key).toBe("PRIVMIXBOOK");
    const labels = resolveCompanyPromptLabels({ workspaceKey: key, companyName: "Mixbook" });
    expect(labels.isPrivate).toBe(true);
    expect(labels.tickerForPrompt).toBe("Mixbook");
    expect(labels.parenLabel).toBe("Mixbook");
    expect(labels.displayName).toBe("Mixbook");
  });

  it("keeps listed ticker for public companies", () => {
    const labels = resolveCompanyPromptLabels({ workspaceKey: "GEN", companyName: "Gen Digital Inc." });
    expect(labels.isPrivate).toBe(false);
    expect(labels.tickerForPrompt).toBe("GEN");
    expect(labels.parenLabel).toBe("Gen Digital Inc. (GEN)");
  });
});

describe("fillCompanyPromptTemplate", () => {
  it("replaces ticker placeholders with company name for private workspaces", () => {
    const key = privateWorkspaceKeyFromName("Mixbook");
    const out = fillCompanyPromptTemplate("Ticker: [TICKER] · Name: [COMPANY NAME]", key, "Mixbook");
    expect(out).toBe("Ticker: Mixbook · Name: Mixbook");
    expect(out).not.toContain("PRIV");
  });
});
