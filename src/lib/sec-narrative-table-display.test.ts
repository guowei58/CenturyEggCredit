import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";

import {
  applyNarrativeTableTotalRowHighlightCheerio,
  highlightNarrativeTableTotalRowsHtml,
  narrativeTableRowStartsWithTotal,
  NARRATIVE_TABLE_TOTAL_ROW_CLASS,
} from "@/lib/sec-narrative-table-display";

describe("narrativeTableRowStartsWithTotal", () => {
  it("matches labels starting with Total", () => {
    expect(narrativeTableRowStartsWithTotal("Total Revenue")).toBe(true);
    expect(narrativeTableRowStartsWithTotal("Total Revenue(2)")).toBe(true);
    expect(narrativeTableRowStartsWithTotal("  Total net sales")).toBe(true);
  });

  it("does not match other labels", () => {
    expect(narrativeTableRowStartsWithTotal("Net revenues")).toBe(false);
    expect(narrativeTableRowStartsWithTotal("Subtotal operating expenses")).toBe(false);
  });
});

describe("applyNarrativeTableTotalRowHighlightCheerio", () => {
  it("tags tbody rows whose first cell starts with Total", () => {
    const html = `<table><tbody>
      <tr><td>North America revenue</td><td>100</td></tr>
      <tr><td>Total Revenue</td><td>500</td></tr>
    </tbody></table>`;
    const $ = cheerio.load(`<div id="wrap">${html}</div>`);
    applyNarrativeTableTotalRowHighlightCheerio($, $("#wrap"));
    expect($("tr").eq(0).attr("class") ?? "").not.toContain(NARRATIVE_TABLE_TOTAL_ROW_CLASS);
    expect($("tr").eq(1).attr("class")).toContain(NARRATIVE_TABLE_TOTAL_ROW_CLASS);
  });
});

describe("highlightNarrativeTableTotalRowsHtml", () => {
  it("returns input unchanged when DOMParser is unavailable", () => {
    const html = `<table><tr><td>Total net revenues</td></tr></table>`;
    expect(highlightNarrativeTableTotalRowsHtml(html)).toBe(html);
  });
});
