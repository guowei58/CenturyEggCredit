import { describe, expect, it } from "vitest";
import { buildVisibleBlockStream, segmentFootnotesForDebtExtraction } from "@/lib/secDebtFootnote/noteSegmentation";

const GTN_HTML = `<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p><b>Note 1 - Summary</b></p>
<p>Organization and basis of presentation.</p>
<p><b>Note 13 "Goodwill and Intangible Assets."</b></p>
<p>67 Accumulated Other Comprehensive Loss . Our accumulated other comprehensive loss balances as of December 31, 2025 consisted of adjustments to our pension asset and the related income tax effects including interest rate caps.</p>
<p><b>Note 2 - Accounting Policies</b></p>
<p>Estimates are required.</p>
<p><b>Note 4 - Debt</b></p>
<p>Our credit agreement provides a revolving credit facility.</p>
<table><tr><td>Total debt</td><td>500</td></tr></table>
<p><b>Note 14 - Income Taxes</b></p>
<p>Tax disclosure.</p>
</body></html>`;

describe("noteSegmentation GTN fixture", () => {
  it("lists heading-like blocks after Notes anchor", () => {
    const notesStart = GTN_HTML.indexOf("Notes to Consolidated");
    expect(notesStart).toBeGreaterThan(0);
    const blocks = buildVisibleBlockStream(GTN_HTML, notesStart, GTN_HTML.length);
    const hs = blocks.filter((b) => b.is_heading_like).map((b) => b.text);
    expect(hs.join("|")).toContain("Note 2");
    expect(hs.join("|")).toContain("Note 4");
  });

  it("segments into canonical notes including debt", () => {
    const notesStart = GTN_HTML.indexOf("Notes to Consolidated");
    const r = segmentFootnotesForDebtExtraction(GTN_HTML, {
      formType: "10-K",
      regionStart: 0,
      regionEnd: GTN_HTML.length,
      notesStart,
      notesSectionFound: true,
      itemFloorFound: true,
      itemFloorKind: "Item 8",
    });
    expect(r.note_blocks.some((n) => n.note_number === "4")).toBe(true);
  });
});
