import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import type { DomElement } from "domhandler";

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
import { indexIxbrlBodyFlatText } from "@/lib/sec-ixbrl-mdna-tables";

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

  it("ignores Part II cross-references inside MD&A and terminates at structural Part II headings (here: Item 1 Legal anchor)", () => {
    const pad = "x ".repeat(6000);
    const item2 =
      " ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS ";
    const mdnaBody =
      " liquidity capital resources overview results of operations discussion ".repeat(140) +
      " Critical Accounting Policies and Estimates For a description of our critical accounting policies and estimates, refer to Part II, Item 7, Critical Accounting Policies and Estimates in our Annual Report on Form 10-K. " +
      " Results of Operations revenues margin cash flows capital expenditures table discussion ".repeat(80);
    const realEnd = " PART II. OTHER INFORMATION ITEM 1. LEGAL PROCEEDINGS ";
    const acc = pad + item2 + mdnaBody + realEnd;
    const start = acc.indexOf("ITEM 2");
    expect(start).toBeGreaterThan(0);

    const end = findMdnaEnd10Q(acc, start);
    expect(end.label).toMatch(/Item 1 Legal/);
    expect(end.index).toBeGreaterThan(acc.indexOf("refer to Part II, Item 7"));
    /** Strong-only end: skips weak `PART II` but still picks statutory `ITEM 1. LEGAL …` beginning Part II. */
    expect(end.index).toBeGreaterThanOrEqual(acc.indexOf("PART II. OTHER INFORMATION"));
  });

  it("ignores em-dash Annual Report cites like Part II—Item 7—… inside Item 2 (SIRI Q1–2026-style)", () => {
    const pad = "x ".repeat(6000);
    const item2 =
      " ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS ";
    /** Quotes 10‑K captions with em dash between roman numeral headings — must not `push` bogus Part II endpoint. */
    const bogusAnnualCite =
      " see \"PART II\u2014ITEM 7\u2014MANAGEMENT'S DISCUSSION AND ANALYSIS\" and \"PART I\u2014ITEM 1A\u2014RISK FACTORS\" in our 2024 Form 10-K. ";
    const mid = " results of operations liquidity capital resources subscriber revenue ".repeat(200);
    const realEnd = " PART II. OTHER INFORMATION ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";
    const acc = pad + item2 + bogusAnnualCite + mid + realEnd;
    const start = acc.indexOf("ITEM 2");
    expect(start).toBeGreaterThan(0);
    const bogusAt = acc.indexOf(bogusAnnualCite);
    const end = findMdnaEnd10Q(acc, start);
    expect(end.index).toBeGreaterThan(bogusAt + bogusAnnualCite.length + 8000);
    /** Earliest terminator is structural `PART II. OTHER INFORMATION` **or**, when that differs in flat text ordering, Item 3. */
    expect(acc.slice(end.index, Math.min(acc.length, end.index + 100)).replace(/\s+/g, " ")).toMatch(
      /\bOTHER\s+INFORMATION\b|\bQUANTITATIVE\s+AND\s+QUALITATIVE\b/i,
    );
  });

  it("ignores inline Part I, Item 3 - Quantitative… hyphen cites (HSY-style) for the real Item 3. heading", () => {
    const pad = "x".repeat(11000);
    const item2 =
      " ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS ";
    const cite =
      " Cocoa costs have improved (see Part I, Item 3 - Quantitative and Qualitative Disclosures about Market Risk included in our Form 10-K). ";
    const mid = " liquidity capital resources results of operations overview ".repeat(120);
    const realItem3 = " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";
    const acc = pad + item2 + cite + mid + realItem3;
    const start = acc.indexOf("ITEM 2");
    expect(start).toBeGreaterThan(0);
    const end = findMdnaEnd10Q(acc, start);
    expect(end.index - start).toBeGreaterThan(5000);
    expect(acc.slice(end.index, end.index + 40)).toMatch(/ITEM\s+3\.\s*QUANTITATIVE/i);
  });
});

describe("findMdnaBounds", () => {
  it("10-K: skips Item 7. \"…\" inline cites so longest-span picks real MD&A body (BLCO FY2025-style)", () => {
    const pad = "x ".repeat(13_000);
    const cite =
      ' ITEM 7. "Management\'s Discussion and Analysis of Financial Condition and Results of Operations — Overview — Product Development" of this Form 10-K. ' +
      " trademarks patents intellectual property know-how discussion ".repeat(200);
    const real =
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " INTRODUCTION Unless the context otherwise indicates results of operations segment revenue discussion ".repeat(120) +
      " ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK " +
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA ";
    const acc = pad + cite + real;
    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(acc.slice(b!.start, b!.start + 160)).not.toMatch(/Product Development" of this Form/i);
    expect(b!.start).toBeGreaterThan(acc.indexOf(cite) + 40);
    expect(b!.endMatchLabel).toMatch(/7A/i);
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

  it("10-K: skips risk-factor prose that echoes MD&A title then “…Results of Operations and Note N” (SBGI FY2024-style)", () => {
    const pad = "x ".repeat(13_000);
    const bogus =
      " ITEM 1A. RISK FACTORS risk factor discussion goodwill impairment disclosures " +
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS AND NOTE 12. GOODWILL AND INTANGIBLE ASSETS risk narrative continues discussion ".repeat(
        220,
      );
    const real =
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " FORWARD LOOKING STATEMENTS Our results segment revenue liquidity capital resources overview ".repeat(110) +
      " ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK " +
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA ";
    const acc = pad + bogus + real;
    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(acc.slice(b!.start, b!.start + 260)).not.toMatch(/RESULTS\s+OF\s+OPERATIONS\s+AND\s+NOTE/i);
    expect(acc.slice(b!.start, b!.start + 320)).toMatch(/FORWARD\s+LOOKING\s+STATEMENTS/i);
    expect(b!.endMatchLabel).toMatch(/7A/i);
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

  it("10-Q: Item 2 MD&A is not mistaken for TOC when intro cites Part I, Item 1 statements (REXR Q1-2026-style)", () => {
    const pad = "x ".repeat(6000);
    const body =
      " ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " The following discussion should be read in conjunction with the consolidated financial statements in Part I, Item 1 \"Financial Statements\" of this Quarterly Report on Form 10-Q. " +
      " Our results of operations liquidity capital resources overview ".repeat(100) +
      " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";
    const acc = pad + body;
    const b = findMdnaBounds(acc, "10-Q");
    expect(b).not.toBeNull();
    expect(acc.slice(b!.start, b!.start + 25).toUpperCase()).toMatch(/ITEM\s+2/);
    expect(b!.endMatchLabel).toMatch(/3|Item 3/i);
    expect(b!.end - b!.start).toBeGreaterThan(1500);
  });

  it("finds 10-K MD&A when Item 7 / Item 7A use spaced punctuation (iXBRL / NextNav-style)", () => {
    const pad = "x ".repeat(13_000);
    const toc =
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS page 31 ITEM 7A. QUANTITATIVE page 40 ITEM 8. FINANCIAL page 79 ";
    const body =
      " ITEM 7 . MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " our results of operations liquidity capital resources overview ".repeat(110) +
      " ITEM 7 A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK " +
      " narrative " +
      " ITEM 8 . FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA ";
    const acc = toc + pad + body;

    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(acc.indexOf(pad) + 100);
    expect(acc.slice(b!.start, b!.start + 25)).toMatch(/ITEM\s+7/i);
    expect(b!.endMatchLabel).toMatch(/7A/i);
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

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

  it("matches Item 2 MD&A when the filing uses a curly apostrophe in Management's (common on EDGAR)", () => {
    const filler = "x ".repeat(5000);
    const item2 =
      " ITEM 2. MANAGEMENT\u2019S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS ";
    const acc =
      filler +
      item2 +
      " liquidity capital resources results of operations overview ".repeat(200) +
      " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";

    const b = findMdnaBounds(acc, "10-Q");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(4000);
    expect(acc.slice(b!.start, Math.min(acc.length, b!.start + 80))).toMatch(/ITEM\s+2.*MANAGEMENT/i);
    expect(b!.end).toBeLessThan(acc.indexOf("ITEM 3. QUANTITATIVE") + 60);
  });

  it("finds 10-Q statutory MD&A after GE-style (MD&A) TOC row — body title has no Item 2 prefix in flat text", () => {
    const pad = "x ".repeat(6000);
    const toc =
      "MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS (MD&A) 4 Consolidated Results 4 Segment ";
    const pad2 = "x ".repeat(6000);
    const body =
      "MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS (MD&A). Our consolidated financial statements are prepared in conformity with GAAP. " +
      "Results of operations liquidity capital resources overview segment performance ".repeat(60);
    const tail = " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";
    const acc = pad + toc + pad2 + body + tail;
    const b = findMdnaBounds(acc, "10-Q");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(pad.length + toc.length);
    expect(acc.slice(b!.start, b!.start + 24)).toMatch(/MANAGEMENT/i);
    expect(b!.end - b!.start).toBeGreaterThan(1500);
  });

  it("10-Q: keeps real ITEM 2 MD&A when opener cites ITEM 1 of this Quarterly Report (GOOG Alphabet-style two-item heuristic)", () => {
    const pad = "x ".repeat(6000);
    const item2Heading =
      " ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " Please read the following discussion and analysis of our financial condition and results of operations together with our consolidated financial statements and related notes included under ITEM 1 of this Quarterly Report on Form 10-Q. ";
    const body = " results of operations liquidity capital resources overview segment ".repeat(100);
    const item3 = " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";
    const acc = pad + item2Heading + body + item3;
    const b = findMdnaBounds(acc, "10-Q");
    expect(b).not.toBeNull();
    expect(acc.slice(b!.start, b!.start + 12).toUpperCase()).toContain("ITEM 2");
    expect(b!.end - b!.start).toBeGreaterThan(2500);
  });

  it("10-Q: ignores statutory MD&A title inside quoted forward-looking Item 2 cite (Alphabet GOOG FY2026 Q1-style)", () => {
    const pad = "x ".repeat(4000);
    const fwd =
      ' Note About Forward Looking Statements Readers should carefully review ITEM 2, "Management\'s Discussion and Analysis of Financial Condition and Results of Operations" in this Quarterly Report on Form 10-Q and ITEM 1A "Risk Factors" ' +
      " disclosures risk macroeconomic uncertainties commitments ".repeat(200);
    const padMid = "y ".repeat(8000);
    const realMdAnd =
      " ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " Please read the following discussion liquidity capital resources results of operations overview ".repeat(80);
    const item3 = " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";
    const acc = pad + fwd + padMid + realMdAnd + item3;
    const b = findMdnaBounds(acc, "10-Q");
    expect(b).not.toBeNull();
    expect(acc.slice(b!.start, b!.start + 14).toUpperCase()).toContain("ITEM 2.");
    expect(b!.start).toBeGreaterThan(pad.length + fwd.length + padMid.length - 2000);
    expect(b!.end - b!.start).toBeGreaterThan(6000);
  });

  it("skips 10-K flattened TOC where page is a bare integer before Item 7A (Charter / CHTR-style index)", () => {
    const tocLine =
      " Item 7 Management's Discussion and Analysis of Financial Condition and Results of Operations 39 Item 7A Quantitative and Qualitative Disclosures About Market Risk 53 ";
    const pad = "x ".repeat(14_000);
    const body =
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " our results of operations liquidity capital resources overview ".repeat(120) +
      " ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK " +
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA ";
    const acc = tocLine + pad + body;
    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(tocLine.length);
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

  it("10-K: keeps real Item 7 when opener cites ITEM 1 of this Annual Report (Alphabet GOOG FY2025-style)", () => {
    const pad = "x ".repeat(14_000);
    const item7Heading =
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " Please read the following discussion and analysis of our financial condition and results of operations together with our consolidated financial statements and related notes included under ITEM 1 of this Annual Report on Form 10-K. ";
    const body = " our results of operations liquidity capital resources overview ".repeat(120);
    const tail =
      " ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK " +
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA ";
    const acc = pad + item7Heading + body + tail;
    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(acc.slice(b!.start, b!.start + 12).toUpperCase()).toContain("ITEM 7");
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

  it("skips Item 7 cross-reference lines that start with “under the heading” (MD&A title cite)", () => {
    const noise =
      " ITEM 7. under the heading “Management’s Discussion and Analysis of Financial Condition and Results of Operations” in this report. ";
    const pad = "x ".repeat(14_000);
    const body =
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " our results of operations liquidity capital resources overview ".repeat(120) +
      " ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK " +
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA ";
    const acc = noise + pad + body;
    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(noise.length);
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

  it("skips Item 7 line that points to MD&A included elsewhere in this document before unrelated exhibit text (AMC 2013-style)", () => {
    const pad = "x ".repeat(16_000);
    const exhibitNoise = " Network costs include personnel satellite bandwidth repairs and other operating costs. ".repeat(120);
    const trap =
      " Item 7— Management's Discussion and Analysis of Financial Condition and Results of Operations included elsewhere in this document. " +
      exhibitNoise;
    const body =
      " Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations. The following discussion relates to the consolidated financial statements. " +
      " our results of operations liquidity capital resources overview ".repeat(120) +
      " ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK " +
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA ";
    const acc = pad + trap + body;
    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(pad.length + trap.length - 800);
    expect(acc.slice(b!.start, b!.start + 120).toUpperCase()).toMatch(/ITEM\s+7/);
    expect(acc.slice(b!.start, b!.start + 200).toLowerCase()).toMatch(/following discussion/);
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

  it("finds 10-K statutory MD&A when body opens with consolidated financial statements only (GE FY2019-style)", () => {
    const pad = "x ".repeat(130_000);
    const title =
      "MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS (MD&A) ";
    const body =
      "The consolidated financial statements of Example Corp combine the industrial businesses. " +
      "Our results of operations liquidity capital resources overview ".repeat(200);
    const tail = " ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";
    const acc = pad + title + body + tail;
    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(120_000);
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

  it('skips see "Item 7 – …" quotes inside Item 7A prose (LUMN/CenturyTel-style cite)', () => {
    const pad = "x ".repeat(55_000);
    const item7aCite =
      ' ITEM 7A. MARKET RISK For details, see "Item 7 - Management\'s Discussion and Analysis of Financial Condition and Results of Operations - Market Risk". ';
    const body =
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " our results of operations liquidity capital resources overview ".repeat(120) +
      " ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK " +
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA ";
    const acc = pad + item7aCite + body;
    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(pad.length + item7aCite.length - 400);
    expect(acc.slice(b!.start, b!.start + 20).toUpperCase()).toMatch(/ITEM\s+7/);
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

  it("10-K: finds MD&A when Item 7 is incorporation-only and narrative restarts at statutory title (SSP-style)", () => {
    const padEarly = "x ".repeat(72_000);
    const stub =
      " ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS required by this item is filed as part of this Form 10-K. See Index to Consolidated Financial Statement Information " +
      " ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK required by this item is filed ";
    const padMid = "y ".repeat(3_000);
    const body =
      " MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " The Consolidated Financial Statements are the basis for our discussion and analysis of our financial condition and results of operations overview liquidity capital resources ".repeat(90) +
      " ITEM 7A. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK " +
      " ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA ";
    const acc = padEarly + stub + padMid + body;
    const b = findMdnaBounds(acc, "10-K");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(padEarly.length + stub.length);
    expect(acc.slice(b!.start, b!.start + 55).toUpperCase()).toContain("MANAGEMENT");
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

  it("10-Q: finds MD&A when Item 2 is incorporation-only and narrative restarts at statutory title (SSP-style)", () => {
    const padEarly = "x ".repeat(28_000);
    const stub =
      " ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " required by this item is filed as part of this Form 10-Q. See Index to Consolidated Financial Statement Information " +
      " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";
    const padMid = "y ".repeat(2_000);
    const body =
      " MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS " +
      " The Condensed Consolidated Financial Statements are the basis for our discussion and analysis of results of operations liquidity overview ".repeat(60) +
      " ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK ";
    const acc = padEarly + stub + padMid + body;
    const b = findMdnaBounds(acc, "10-Q");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(padEarly.length + stub.length);
    expect(b!.end - b!.start).toBeGreaterThan(1500);
  });
});

const SSP_TMP_10K = path.join(process.cwd(), ".tmp-ssp-10k.htm");
const SSP_TMP_10Q = path.join(process.cwd(), ".tmp-ssp-10q.htm");

describe.skipIf(!fs.existsSync(SSP_TMP_10K))("SSP local HTML fixtures (.tmp-ssp-*.htm)", () => {
  it("finds MD&A bounds in real SSP FY2025 10-K iXBRL", () => {
    const html = fs.readFileSync(SSP_TMP_10K, "utf8");
    const $ = cheerio.load(html);
    const body = ($("body").get(0) ?? $("html").get(0)) as DomElement | undefined;
    expect(body).toBeTruthy();
    const { flatText } = indexIxbrlBodyFlatText(body!);
    const b = findMdnaBounds(flatText, "10-K");
    expect(b).not.toBeNull();
    expect(b!.end - b!.start).toBeGreaterThan(4000);
  });

  it.skipIf(!fs.existsSync(SSP_TMP_10Q))("finds MD&A bounds in real SSP Q1-2026 10-Q iXBRL", () => {
    const html = fs.readFileSync(SSP_TMP_10Q, "utf8");
    const $ = cheerio.load(html);
    const body = ($("body").get(0) ?? $("html").get(0)) as DomElement | undefined;
    expect(body).toBeTruthy();
    const { flatText } = indexIxbrlBodyFlatText(body!);
    const b = findMdnaBounds(flatText, "10-Q");
    expect(b).not.toBeNull();
    expect(b!.end - b!.start).toBeGreaterThan(1500);
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
