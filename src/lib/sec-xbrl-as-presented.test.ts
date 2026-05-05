import { describe, expect, it } from "vitest";

import { fetchAsPresentedStatements, ideaViewerDefrefToConcept, parseIdeaViewerDefrefRows } from "@/lib/sec-xbrl-as-presented";

describe("ideaViewerDefrefToConcept", () => {
  it("maps us-gaap defref token to QName", () => {
    expect(ideaViewerDefrefToConcept("us-gaap_CashAndCashEquivalentsAtCarryingValue")).toBe(
      "us-gaap:CashAndCashEquivalentsAtCarryingValue"
    );
  });

  it("maps extension prefix", () => {
    expect(ideaViewerDefrefToConcept("nxst_BroadcastRightsCurrent")).toBe("nxst:BroadcastRightsCurrent");
  });
});

describe("parseIdeaViewerDefrefRows", () => {
  it("extracts concept and label from SEC viewer anchor pattern", () => {
    const html = `<tr><td class="pl"><a class="a" href="javascript:void(0);" onclick="Show.showAR( this, 'defref_us-gaap_Assets', window );">Total assets</a></td></tr>`;
    expect(parseIdeaViewerDefrefRows(html)).toEqual([{ concept: "us-gaap:Assets", label: "Total assets" }]);
  });
});

describe("fetchAsPresentedStatements (network)", () => {
  it(
    "resolves NXST 10-Q with no loose _pre/_lab using FilingSummary + R*.htm",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0001142417",
        accessionNumber: "0001193125-25-269795",
        form: "10-Q",
        filingDate: "2025-11-06",
      });
      expect(out.ok).toBe(true);
      expect(out.statements.length).toBeGreaterThanOrEqual(3);
      const titles = new Set(out.statements.map((s) => s.title));
      expect(titles.has("Balance Sheet")).toBe(true);
      expect(titles.has("Income Statement")).toBe(true);
      expect(titles.has("Cash Flow")).toBe(true);
    },
    120_000
  );
});
