import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";

import {
  domCellForMatrixColumn,
  extractInlineIxForMatrixAmountCell,
  findInlineIxInRowByVisibleText,
  primaryHtmlHasInlineIxTags,
} from "@/lib/sec-ixbrl-inline-cell";

describe("sec-ixbrl-inline-cell", () => {
  it("reads ix:nonFraction from the matrix column cell (not trailing columns only)", () => {
    const html = `<table><tr>
      <td>Total revenues</td>
      <td>$</td>
      <td><ix:nonFraction name="us-gaap:Revenues" contextRef="c1" unitRef="usd" decimals="-3" scale="3">179,325</ix:nonFraction></td>
      <td><ix:nonFraction name="us-gaap:Revenues" contextRef="c2" unitRef="usd" decimals="-3" scale="3">159,521</ix:nonFraction></td>
    </tr></table>`;
    const $ = cheerio.load(html);
    const tr = $("tr").get(0)!;
    const meta = extractInlineIxForMatrixAmountCell($, tr, 2, "179,325");
    expect(meta.xbrlConcept).toBe("us-gaap:Revenues");
    expect(meta.contextRef).toBe("c1");
    expect(meta.rawValue).toBe(179_325_000);
  });

  it("domCellForMatrixColumn respects colspan", () => {
    const html = `<table><tr>
      <td colspan="2">Label</td>
      <td><ix:nonFraction name="us-gaap:Cash" contextRef="c1">100</ix:nonFraction></td>
    </tr></table>`;
    const $ = cheerio.load(html);
    const tr = $("tr").get(0)!;
    expect(domCellForMatrixColumn($, tr, 2)?.name).toBe("td");
    const meta = extractInlineIxForMatrixAmountCell($, tr, 2, "100");
    expect(meta.xbrlConcept).toBe("us-gaap:Cash");
  });

  it("findInlineIxInRowByVisibleText matches formatted amounts", () => {
    const html = `<table><tr>
      <td>Net income</td>
      <td>(<ix:nonFraction name="us-gaap:NetIncomeLoss" contextRef="c1" sign="-">18,495</ix:nonFraction>)</td>
    </tr></table>`;
    const $ = cheerio.load(html);
    const tr = $("tr").get(0)!;
    const meta = findInlineIxInRowByVisibleText($, tr, "(18,495)");
    expect(meta?.xbrlConcept).toBe("us-gaap:NetIncomeLoss");
  });

  it("primaryHtmlHasInlineIxTags detects ix:nonFraction in document HTML", () => {
    expect(
      primaryHtmlHasInlineIxTags(
        '<html><body><ix:nonFraction name="us-gaap:Revenues" contextRef="c1">100</ix:nonFraction></body></html>'
      )
    ).toBe(true);
    expect(primaryHtmlHasInlineIxTags("<html><body><table><tr><td>100</td></tr></table></body></html>")).toBe(false);
  });
});
