import { describe, expect, it } from "vitest";

import {
  buildNotesSectionBounds,
  findAllSegmentRevenueNoteRanges,
  findMdnaBounds,
  findMdnaRevenueSectionBounds,
} from "@/lib/sec-ixbrl-mdna-boundaries";

describe("findMdnaRevenueSectionBounds", () => {
  it("finds Results of Operations through Liquidity", () => {
    const pad = "x".repeat(12000);
    const mdna =
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " OVERVIEW intro ".repeat(40) +
      " RESULTS OF OPERATIONS " +
      " Total net revenues increased segment revenue by product ".repeat(120) +
      " LIQUIDITY AND CAPITAL RESOURCES " +
      " cash flows ".repeat(80);
    const acc = pad + mdna;
    const mdnaBounds = findMdnaBounds(acc, "10-K");
    expect(mdnaBounds).not.toBeNull();
    const rev = findMdnaRevenueSectionBounds(acc, mdnaBounds!, "10-K");
    expect(rev).not.toBeNull();
    expect(rev!.startLabel).toMatch(/Results of Operations/i);
    expect(rev!.endLabel).toMatch(/Liquidity/i);
    const slice = acc.slice(rev!.start, rev!.end).toLowerCase();
    expect(slice).toMatch(/total net revenues/);
    expect(slice).not.toMatch(/liquidity and capital resources/);
  });
});

describe("findAllSegmentRevenueNoteRanges", () => {
  it("returns multiple segment-related note blocks", () => {
    const acc =
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA " +
      " Notes to Consolidated Financial Statements " +
      " Note 1 Organization " +
      " text ".repeat(80) +
      " Note 12 Segment Information " +
      " reportable segments operating segment revenue by geography ".repeat(40) +
      " Note 13 Income Taxes " +
      " tax ".repeat(40) +
      " Note 14 Disaggregated Revenue " +
      " disaggregated revenue by product service revenue by segment ".repeat(40) +
      " Note 15 Leases ";

    const notes = buildNotesSectionBounds(acc, "10-K");
    expect(notes).not.toBeNull();
    const picks = findAllSegmentRevenueNoteRanges(acc, notes!);
    expect(picks.length).toBeGreaterThanOrEqual(2);
    const headings = picks.map((p) => p.headingText.toLowerCase());
    expect(headings.some((h) => h.includes("segment"))).toBe(true);
    expect(headings.some((h) => h.includes("disaggregated") || h.includes("revenue"))).toBe(true);
  });
});
