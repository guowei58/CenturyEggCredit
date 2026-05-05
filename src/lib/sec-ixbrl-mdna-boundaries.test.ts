import { describe, expect, it } from "vitest";

import {
  buildNotesSectionBounds,
  collectNoteBlockStartIndicesInSlice,
  computeStructuralNoteEndOffset,
  findBestSegmentNoteRange,
  findMdnaBounds,
  findMdnaEnd10Q,
  findSegmentKeywordFallbackPick,
  scoreSegmentNoteCandidate,
} from "@/lib/sec-ixbrl-mdna-boundaries";

describe("findMdnaEnd10Q", () => {
  it("ignores early weak Item 3 references inside Item 2 prose", () => {
    const pad = "x".repeat(11000);
    const item2 =
      " ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS ";
    const trap =
      " Investors should read Item 3. Risk Factors and our other risk disclosures when evaluating results. ";
    const mid = " liquidity capital resources results of operations overview discussion ".repeat(100);
    const item3 =
      " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";
    const acc = pad + item2 + trap + mid + item3;
    const start = acc.indexOf("ITEM 2");
    expect(start).toBeGreaterThan(0);
    const end = findMdnaEnd10Q(acc, start);
    expect(end.index).toBeLessThanOrEqual(acc.indexOf("ITEM 3. QUANTITATIVE") + 30);
    expect(end.index - start).toBeGreaterThan(5000);
  });
});

describe("findMdnaBounds", () => {
  it("finds 10-K Item 7 through Item 8 body section", () => {
    const filler = "word ".repeat(600);
    const acc =
      "TABLE OF CONTENTS ITEM 7 Management Discussion page 12 ".repeat(20) +
      filler +
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      "Our results of operations liquidity and capital resources overview discussion ".repeat(80) +
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA Notes to consolidated financial statements";

    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(b!.confidence).not.toBe("low");
    expect(b!.start).toBeGreaterThan(100);
    expect(b!.end).toBeLessThan(acc.length);
    expect(acc.slice(b!.start, b!.start + 40)).toMatch(/ITEM\s+7/i);
  });

  it("finds 10-Q Item 2 before Item 3", () => {
    const filler = "x ".repeat(5000);
    const acc =
      filler +
      " ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " liquidity capital resources results of operations ".repeat(200) +
      " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";

    const b = findMdnaBounds(acc, "10-Q");
    expect(b).not.toBeNull();
    expect(b!.end).toBeLessThan(acc.indexOf("ITEM 3") + 50);
  });

  it("accepts a shorter 10-Q MD&A span than the annual minimum", () => {
    const filler = "x ".repeat(9000);
    const body = " liquidity overview segment operating performance ".repeat(52);
    const acc =
      filler +
      " ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      body +
      " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";

    const b = findMdnaBounds(acc, "10-Q");
    expect(b).not.toBeNull();
    expect(b!.end - b!.start).toBeLessThan(4000);
    expect(b!.end).toBeLessThan(acc.indexOf("ITEM 3") + 40);
  });
});

describe("scoreSegmentNoteCandidate", () => {
  it("scores Segment Information highly", () => {
    const s = scoreSegmentNoteCandidate("Note 12 — Segment Information", "reportable segments operating segment revenue");
    expect(s.total).toBeGreaterThan(60);
  });

  it("requires body cues for Revenue Recognition heading", () => {
    const weak = scoreSegmentNoteCandidate("Note 2 — Revenue Recognition", "policy recognition timing");
    const strong = scoreSegmentNoteCandidate(
      "Note 2 — Revenue Recognition",
      "disaggregated revenue by operating segment and geography"
    );
    expect(strong.total).toBeGreaterThan(weak.total);
  });

  it("downranks debt-only headings", () => {
    const s = scoreSegmentNoteCandidate("Note 5 — Long-Term Debt", "borrowings covenants maturity");
    expect(s.total).toBeLessThan(0);
  });

  it("boosts parenthetical Information About … Operating Segments style titles", () => {
    const s = scoreSegmentNoteCandidate(
      "(15) Information About QVC Group's Operating Segments",
      "chief operating decision maker reportable segments"
    );
    expect(s.total).toBeGreaterThan(50);
  });
});

describe("collectNoteBlockStartIndicesInSlice", () => {
  it("merges Note N and (N) markers and skips year parens like (2024)", () => {
    const slice =
      "Note 1 Summary (2024) fiscal year " +
      "(2) Second topic body " +
      "(15) Information About Operating Segments ";
    const hits = collectNoteBlockStartIndicesInSlice(slice);
    const nums = hits.map((h) => h.num);
    expect(nums).toContain("1");
    expect(nums).toContain("2");
    expect(nums).toContain("15");
    expect(nums).not.toContain("2024");
    expect(hits.some((h) => h.num === "1" && h.source === "note")).toBe(true);
    expect(hits.some((h) => h.num === "15" && h.source === "paren")).toBe(true);
  });
});

describe("findSegmentKeywordFallbackPick", () => {
  it("builds a window from segment-related prose when note numbers are absent", () => {
    const acc =
      "preamble ".repeat(400) +
      "Notes to Condensed Consolidated Financial Statements " +
      "other footnote text ".repeat(30) +
      " Operating Segment results and geographic revenue details " +
      "table area ".repeat(100) +
      " PART II ";
    const notes = buildNotesSectionBounds(acc, "10-Q");
    expect(notes).not.toBeNull();
    const pick = findSegmentKeywordFallbackPick(acc, notes!);
    expect(pick).not.toBeNull();
    expect(acc.slice(pick!.start, pick!.end).toLowerCase()).toMatch(/operating segment/);
    expect(pick!.end).toBeGreaterThan(pick!.start);
  });
});

describe("computeStructuralNoteEndOffset", () => {
  it("keeps segment note range through (1)(2) list markers until the next higher parenthetical note", () => {
    const slice =
      "prefix (15) Information About Operating Segments narrative " +
      "(1) reportable segment revenue operating segment " +
      "(2) geographic revenue chief operating decision maker " +
      "more disclosure " +
      "(16) Income Taxes begin";
    const boundaries = collectNoteBlockStartIndicesInSlice(slice);
    const i15 = boundaries.findIndex((b) => b.num === "15");
    expect(i15).toBeGreaterThanOrEqual(0);
    const end = computeStructuralNoteEndOffset(boundaries, i15, slice.length);
    expect(slice.slice(end, end + 4)).toBe("(16)");
  });

  it("still ends at the next Note N heading even when N would sort before the opening parenthetical", () => {
    const slice = "(15) Segments body text Note 16 Income Taxes";
    const boundaries = collectNoteBlockStartIndicesInSlice(slice);
    const i15 = boundaries.findIndex((b) => b.num === "15");
    expect(i15).toBeGreaterThanOrEqual(0);
    const end = computeStructuralNoteEndOffset(boundaries, i15, slice.length);
    expect(slice.slice(end)).toMatch(/^Note\s+16/);
  });
});

describe("segment note range", () => {
  it("picks disaggregated revenue over generic note when scored higher", () => {
    const acc =
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA " +
      " Notes to Financial Statements " +
      " Note 3 Revenue text ".repeat(30) +
      " Note 4 Disaggregated Revenue " +
      " disaggregated revenue by reportable segment operating segment ".repeat(20) +
      " Note 5 Leases ";

    const notes = buildNotesSectionBounds(acc, "10-K");
    expect(notes).not.toBeNull();
    const pick = findBestSegmentNoteRange(acc, notes!);
    expect(pick).not.toBeNull();
    expect(pick!.headingText.toLowerCase()).toMatch(/disaggregated/i);
  });

  it("picks segment block when notes use parenthetical (N) headings only", () => {
    const acc =
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA " +
      " Notes to Consolidated Financial Statements " +
      " (14) Other disclosure ".repeat(40) +
      " (15) Information About QVC Group's Operating Segments " +
      " chief operating decision maker reportable segments operating segment ".repeat(45) +
      " (16) Income Taxes ";

    const notes = buildNotesSectionBounds(acc, "10-K");
    expect(notes).not.toBeNull();
    const pick = findBestSegmentNoteRange(acc, notes!);
    expect(pick).not.toBeNull();
    expect(pick!.headingText.toLowerCase()).toMatch(/information about.*operating segments|operating segments/);
    expect(pick!.score).toBeGreaterThan(40);
  });

  it("picks best note block inside notes section", () => {
    const acc =
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA " +
      " Notes to Consolidated Financial Statements " +
      " Note 1 Organization " +
      " text ".repeat(100) +
      " Note 18 Segment Information " +
      " reportable segments operating segment revenue by geography ".repeat(50) +
      " Note 19 Income Taxes ";

    const notes = buildNotesSectionBounds(acc, "10-K");
    expect(notes).not.toBeNull();
    const pick = findBestSegmentNoteRange(acc, notes!);
    expect(pick).not.toBeNull();
    expect(pick!.headingText.toLowerCase()).toContain("segment");
    expect(pick!.score).toBeGreaterThan(40);
  });
});
