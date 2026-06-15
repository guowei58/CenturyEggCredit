import { describe, expect, it } from "vitest";
import {
  buildCreditDocSaveLabel,
  extractCreditDocSaveLabelForUrl,
} from "@/lib/extract-credit-doc-save-label";

describe("extractCreditDocSaveLabelForUrl", () => {
  const md = `
## Document table

| Security / Facility | Document Type | Document Title | Filing Date | Filing / Source | Direct Document Link | Filing Link | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Term Loan B | Credit Agreement | Credit Agreement (Amended) | 2024-03-15 | 8-K | [Ex-10.1](https://www.sec.gov/Archives/edgar/data/123/dex101.htm) | [8-K](https://www.sec.gov/cgi-bin/viewer?action=view&cik=123) | — |
| 6.75% Notes due 2029 | Indenture | Senior Notes Indenture | 2021-06-01 | 8-K | https://www.sec.gov/Archives/edgar/data/123/dex42.htm | — | — |
`;

  it("builds label from row metadata", () => {
    expect(
      buildCreditDocSaveLabel({
        documentType: "Credit Agreement",
        documentTitle: "Credit Agreement (Amended)",
        securityFacility: "Term Loan B",
        filingDate: "2024-03-15",
      })
    ).toBe("Credit Agreement — Credit Agreement (Amended) — Term Loan B — 2024-03-15");
  });

  it("finds label for markdown link URL", () => {
    expect(
      extractCreditDocSaveLabelForUrl(
        md,
        "https://www.sec.gov/Archives/edgar/data/123/dex101.htm"
      )
    ).toBe("Credit Agreement — Credit Agreement (Amended) — Term Loan B — 2024-03-15");
  });

  it("finds label for bare exhibit URL", () => {
    expect(
      extractCreditDocSaveLabelForUrl(md, "https://www.sec.gov/Archives/edgar/data/123/dex42.htm")
    ).toBe("Indenture — Senior Notes Indenture — 6.75% Notes due 2029 — 2021-06-01");
  });

  it("returns null when URL is not in a document table", () => {
    expect(extractCreditDocSaveLabelForUrl(md, "https://example.com/other.pdf")).toBeNull();
  });
});
