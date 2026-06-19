import { describe, expect, it } from "vitest";

import { pickCreditDocUrlForCategory, scoreCreditDocRowForCategory } from "./bulk-credit-doc-match";
import type { CreditDocListRow } from "./extract-credit-doc-save-label";

function row(partial: Partial<CreditDocListRow> & Pick<CreditDocListRow, "url">): CreditDocListRow {
  return {
    securityFacility: "",
    documentType: "",
    documentTitle: "",
    filingDate: "",
    label: "",
    ...partial,
  };
}

describe("scoreCreditDocRowForCategory", () => {
  it("prefers credit agreements over indentures for credit-agreement category", () => {
    const ca = row({
      url: "https://www.sec.gov/a.htm",
      documentType: "Credit Agreement",
      securityFacility: "Term Loan B",
      label: "Credit Agreement — Term Loan B",
    });
    const ind = row({
      url: "https://www.sec.gov/b.htm",
      documentType: "Indenture",
      securityFacility: "6.75% Senior Notes",
      label: "Indenture — Notes",
    });
    expect(scoreCreditDocRowForCategory(ca, "credit-agreements-indentures-credit-agreement")).toBeGreaterThan(
      scoreCreditDocRowForCategory(ind, "credit-agreements-indentures-credit-agreement")
    );
  });

  it("matches first lien indenture rows", () => {
    const fl = row({
      url: "https://www.sec.gov/fl.htm",
      documentType: "Indenture",
      securityFacility: "First Lien Notes due 2029",
      label: "Indenture — First Lien Notes",
    });
    expect(scoreCreditDocRowForCategory(fl, "credit-agreements-indentures-first-lien-indenture")).toBeGreaterThanOrEqual(90);
  });

  it("matches senior secured notes without explicit first lien wording", () => {
    const sr = row({
      url: "https://www.sec.gov/sr.htm",
      documentType: "Indenture",
      securityFacility: "6.875% Senior Secured Notes due 2030",
      label: "Indenture — Senior Secured Notes",
    });
    expect(scoreCreditDocRowForCategory(sr, "credit-agreements-indentures-first-lien-indenture")).toBeGreaterThanOrEqual(
      80
    );
  });
});

describe("pickCreditDocUrlForCategory", () => {
  const list = `
| Security / Facility | Document Type | Document Title | Filing Date | Direct Document Link |
| Term Loan B | Credit Agreement | Amended Credit Agreement | 2024-03-15 | [Ex-10.1](https://www.sec.gov/Archives/edgar/data/1/dex101.htm) |
| 6.75% Notes | Indenture | Senior Unsecured Notes Indenture | 2021-06-01 | https://www.sec.gov/Archives/edgar/data/1/dex42.htm |
| First Lien Notes | Indenture | First Lien Notes Indenture | 2022-01-10 | https://www.sec.gov/Archives/edgar/data/1/dex43.htm |
`;

  it("picks credit agreement URL for credit agreement tab", () => {
    const pick = pickCreditDocUrlForCategory(list, "credit-agreements-indentures-credit-agreement");
    expect(pick?.url).toContain("dex101.htm");
  });

  it("returns null when no row matches category", () => {
    const sparse = "| Security | Document Type | Document Title | Filing Date | Direct Document Link |\n| — | Press release | — | — | — |";
    expect(pickCreditDocUrlForCategory(sparse, "credit-agreements-indentures-second-lien-indenture")).toBeNull();
  });
});
