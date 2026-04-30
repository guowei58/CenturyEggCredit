import { describe, expect, it } from "vitest";
import { normalizeEntityNameForMatch } from "@/lib/debt-map/normalizeEntityName";
import { exhibitMatchesDebtKeywords, shouldIncludeExhibitFile } from "@/lib/debt-map/exhibitFilters";
import { reconcileFootnotesToInstruments } from "@/lib/debt-map/reconciler";
import { buildRedFlagsMvp } from "@/lib/debt-map/redFlagRules";

describe("normalizeEntityNameForMatch", () => {
  it("strips legal suffix noise", () => {
    expect(normalizeEntityNameForMatch("ACME, Inc.")).toBe(normalizeEntityNameForMatch("ACME Inc"));
  });
});

describe("exhibitFilters", () => {
  it("matches debt keywords in filename", () => {
    expect(exhibitMatchesDebtKeywords("ex4.htm", "Indenture and Credit Agreement")).toBe(true);
    expect(exhibitMatchesDebtKeywords("ex10-1-something.htm", "")).toBe(false);
  });

  it("includes ex-4 with debt keyword", () => {
    expect(shouldIncludeExhibitFile("d10.htm", "d10.htm", { includeExhibit21: true, includeExhibit22: true })).toBe(
      false
    );
  });
});

describe("reconciler", () => {
  it("links footnote to instrument on shared tokens", () => {
    const m = reconcileFootnotesToInstruments(
      [{ description: "Senior Notes 2029", principalAmount: null, carryingValue: null, maturityDate: null, rate: null }],
      [{ id: "i1", instrumentName: "Senior Notes due 2029", principalAmount: null, maturityDate: "2029-06-01" }]
    );
    expect(m[0]?.matchedInstrumentId).toBe("i1");
  });
});

describe("redFlagRules", () => {
  it("returns reconciliation gap when instruments lack matches", () => {
    const rf = buildRedFlagsMvp({
      publicParentName: "Parent Inc.",
      issuerNames: ["Subsidiary Issuer LLC"],
      instrumentsWithoutFootnote: ["x1"],
      footnotesWithoutInstrument: 1,
      hasSecuredWithoutGrantors: false,
      hasReceivablesLanguage: false,
      hasUnrestrictedLanguage: false,
      materialSubsNames: [],
      guarantorNames: [],
    });
    expect(rf.some((r) => r.category === "reconciliation_gap")).toBe(true);
  });
});
