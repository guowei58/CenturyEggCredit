import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";

import {
  buildDisplayTableHtml,
  buildMdnaSectionDisplayHtml,
  classifyEarningsExhibitHtml,
  extractEbitdaReconciliationFromIxbrlHtml,
  extractPressReleaseBodyHtmlForDisplay,
  extractSlideDeckBodyHtmlForDisplay,
  filingTextMentionsEbitdaMeasures,
  indexIxbrlBodyFlatText,
  isPlausibleDataTable,
  mergeDollarOnlyCellsInRow,
  normalizeFilingPhraseHyphens,
  pickEarningsMainAndDeck,
  resolveSrcsetAgainstDocument,
  scoreEarningsHtmlSlideDeckLikelihood,
} from "@/lib/sec-ixbrl-mdna-tables";
import { findMdnaBounds } from "@/lib/sec-ixbrl-mdna-boundaries";

describe("extractPressReleaseBodyHtmlForDisplay", () => {
  it("returns body inner HTML and removes script/style", () => {
    const raw = `<!DOCTYPE html><html><head><style>.x{color:red}</style><script>alert(1)</script></head><body><p id="x">Hello</p><noscript>n</noscript></body></html>`;
    const out = extractPressReleaseBodyHtmlForDisplay(raw);
    expect(out).toContain('id="x"');
    expect(out).toContain("Hello");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("color:red");
  });

  it("strips img/picture so relative SEC exhibit assets do not show as broken icons", () => {
    const raw = `<!DOCTYPE html><html><body>
      <p>NEWS RELEASE</p>
      <img src="exhibit991_files/image001.png" alt="Co Logo" width="120" height="40"/>
      <picture><source srcset="a.webp"/><img src="b.png"/></picture>
      <p>More text</p>
    </body></html>`;
    const out = extractPressReleaseBodyHtmlForDisplay(raw);
    expect(out).toContain("NEWS RELEASE");
    expect(out).toContain("More text");
    expect(out).not.toMatch(/<img\b/i);
    expect(out).not.toMatch(/<picture\b/i);
  });
});

describe("extractSlideDeckBodyHtmlForDisplay", () => {
  it("keeps images and resolves relative src against the exhibit document URL", () => {
    const docUrl = "https://www.sec.gov/Archives/edgar/data/123/000123456789012345/exhibit992.htm";
    const raw = `<!DOCTYPE html><html><body><p>Slide</p><img src="exhibit992_files/image001.png" alt="x"/></body></html>`;
    const out = extractSlideDeckBodyHtmlForDisplay(raw, docUrl);
    expect(out).toContain("exhibit992_files/image001.png");
    expect(out).toMatch(/https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/123\/000123456789012345\/exhibit992_files\/image001\.png/);
  });

  it("rewrites srcset URLs", () => {
    const docUrl = "https://www.sec.gov/Archives/edgar/data/1/000/a.htm";
    const raw = `<html><body><img src="a.png" srcset="b.png 1x, c.png 2x"/></body></html>`;
    const out = extractSlideDeckBodyHtmlForDisplay(raw, docUrl);
    expect(out).toContain("https://www.sec.gov/Archives/edgar/data/1/000/b.png");
    expect(out).toContain("2x");
  });
});

describe("resolveSrcsetAgainstDocument", () => {
  it("resolves comma-separated candidates", () => {
    const base = "https://www.sec.gov/Archives/edgar/data/1/000000000000000000/sub/dir/page.htm";
    expect(resolveSrcsetAgainstDocument("img.png 1x, img2.png 2x", base)).toContain(
      "https://www.sec.gov/Archives/edgar/data/1/000000000000000000/sub/dir/img.png"
    );
  });
});

describe("classifyEarningsExhibitHtml / pickEarningsMainAndDeck", () => {
  it("classifies Workiva-style raster slide deck (large images + 1pt FONT captions) as slide_deck", () => {
    const blocks = [1, 2, 3, 4, 5]
      .map(
        (i) =>
          `<div><img src="exhibit99100${i}.jpg" title="slide${i}" width="1365" height="1055"/>` +
          `<font size="1" style="font-size:1pt;color:white">S U M M A R Y H I G H L I G H T S ${i}</font></div>`
      )
      .join("");
    const html = `<html><body>${blocks}</body></html>`;
    expect(classifyEarningsExhibitHtml(html, "exhibit991.htm")).toBe("slide_deck");
  });

  it("classifies deck-style glued slide text as slide_deck", () => {
    const glued =
      "OPTIMUSFACTORYSITEPREPARATION—GIGAFACTORYTEXAS 16\nRESEARCHFAB—GROUNDBREAKING 17\nLFPFACTORY—FIRSTPRODUCTIONMODULES 18\n" +
      "y".repeat(900);
    const html = `<html><body><div>${glued}</div></body></html>`;
    expect(scoreEarningsHtmlSlideDeckLikelihood(html, "exhibit991.htm")).toBeGreaterThan(50);
    expect(classifyEarningsExhibitHtml(html, "exhibit991.htm")).toBe("slide_deck");
  });

  it("classifies narrative earnings PR as press_release", () => {
    const html = `<!DOCTYPE html><html><body>${"x".repeat(200)}<p>TSLA Q1 2024 financial results. Revenue was $21.3 billion. Diluted EPS $0.45. Conference call at 5:30 p.m.</p></body></html>`;
    expect(classifyEarningsExhibitHtml(html, "tsla-ex991.htm")).toBe("press_release");
  });

  it("classifies quarterly earnings filenames (e.g. CMPR) as press_release not slide_deck", () => {
    const html = `<!DOCTYPE html><html><body>${"x".repeat(200)}<p>Cimpress Q3 fiscal 2026 financial results. Revenue was $1.1 billion. Diluted EPS $0.42. Conference call at 5:00 p.m.</p></body></html>`;
    expect(classifyEarningsExhibitHtml(html, "q3_fy26quarterlyearnings.htm")).toBe("press_release");
  });

  it("picks a separate slide deck when a press release exhibit is first", () => {
    const classified = [
      { filename: "a.htm", kind: "press_release" as const },
      { filename: "b.htm", kind: "slide_deck" as const },
    ];
    expect(pickEarningsMainAndDeck(classified)).toEqual({ main: 0, deck: 1 });
  });

  it("does not add deck slot for deck-only filings", () => {
    const classified = [{ filename: "a.htm", kind: "slide_deck" as const }];
    expect(pickEarningsMainAndDeck(classified)).toEqual({ main: 0 });
  });
});

describe("extractEbitdaReconciliationFromIxbrlHtml", () => {
  /** Extraction returns early when HTML is shorter than 500 chars (real filings are always larger). */
  const pad520 = `<!-- ${"x".repeat(520)} -->`;

  it("returns multiple tables when the document has more than one EBITDA grid (no row-JSON dedupe)", () => {
    const html = `<!DOCTYPE html><html><body>${pad520}
      <table><tbody>
        <tr><td>Net revenue</td><td>100</td></tr>
        <tr><td>Adjusted EBITDA (non-GAAP)</td><td>50</td></tr>
      </tbody></table>
      <p>Bridge:</p>
      <table><tbody>
        <tr><td>Net income</td><td>10</td></tr>
        <tr><td>Add: interest</td><td>2</td></tr>
        <tr><td>EBITDA (Non-GAAP Measure)</td><td>50</td></tr>
      </tbody></table>
    </body></html>`;
    const r = extractEbitdaReconciliationFromIxbrlHtml(html, "8-K", { includeUncertainBoundaries: false });
    expect(r.status).toBe("tables");
    expect(r.tables.length).toBe(2);
  });

  it("detects EBITDA when it appears only after the first dozen rows", () => {
    const filler = Array.from({ length: 18 }, (_, i) => `<tr><td>Line ${i}</td><td>${i}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><body>${pad520}<table><tbody>${filler}<tr><td>Adjusted EBITDA</td><td>99</td></tr></tbody></table></body></html>`;
    const r = extractEbitdaReconciliationFromIxbrlHtml(html, "8-K", { includeUncertainBoundaries: false });
    expect(r.status).toBe("tables");
    expect(r.tables.length).toBeGreaterThanOrEqual(1);
  });
});

describe("filingTextMentionsEbitdaMeasures", () => {
  it("detects EBITDA and common variants", () => {
    expect(filingTextMentionsEbitdaMeasures("Adjusted EBITDA reconciliation")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("Adj. EBITDA (non-GAAP)")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("OIBTDA margin")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("Operating EBITDA")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("AI EBITDA")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("We use net income")).toBe(false);
  });

  it("detects non-GAAP earnings, operating income, net income, and EPS phrasing", () => {
    expect(filingTextMentionsEbitdaMeasures("Non-GAAP operating income reconciliation")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("adjusted operating income")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("non GAAP net income")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("Net income (non-GAAP)")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("Non-GAAP diluted EPS")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("non-GAAP earnings")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("Non-GAAP adjusted diluted earnings per share")).toBe(true);
  });

  it("normalizes Unicode dashes in Non–GAAP (en dash / NB hyphen) and matches GAAP↔non-GAAP bridges", () => {
    expect(normalizeFilingPhraseHyphens("Non\u2013GAAP net income")).toBe("Non-GAAP net income");
    expect(filingTextMentionsEbitdaMeasures("Non\u2013GAAP net income")).toBe(true);
    expect(filingTextMentionsEbitdaMeasures("Non\u2011GAAP diluted earnings per share")).toBe(true);
    expect(
      filingTextMentionsEbitdaMeasures(
        "GAAP net income 123 Non\u2013GAAP net income 456 GAAP diluted earnings per share 0.1 Non\u2013GAAP diluted earnings per share 0.2"
      )
    ).toBe(true);
    expect(
      filingTextMentionsEbitdaMeasures(
        "GAAP net income. Net cash provided by operating activities 100 Capital expenditures (20) Free cash flow 80"
      )
    ).toBe(false);
    expect(
      filingTextMentionsEbitdaMeasures(
        "GAAP net income 1. Non\u2013GAAP net income 2. Net cash provided by operating activities 100 Capital expenditures (20) Free cash flow 80"
      )
    ).toBe(true);
  });
});

describe("isPlausibleDataTable", () => {
  const prose = "We believe market conditions and execution risks described below could affect future performance.".repeat(
    3
  );

  it("rejects prose-only grids without digits in strict mode", () => {
    const rows = [
      ["Risk factor", prose.slice(0, 180)],
      ["Mitigation", prose.slice(180, 360)],
      ["Outlook", prose.slice(360, 540)],
    ];
    expect(isPlausibleDataTable(rows, 0)).toBe(false);
  });

  it("accepts MD&A-style prose grids in narrativeFinancialSection mode", () => {
    const rows = [
      ["Risk factor", prose.slice(0, 180)],
      ["Mitigation", prose.slice(180, 360)],
      ["Outlook", prose.slice(360, 540)],
    ];
    expect(isPlausibleDataTable(rows, 0, { narrativeFinancialSection: true })).toBe(true);
  });

  it("accepts very large prose cells in 2-column narrative tables (issuer-style)", () => {
    const long = `${prose.repeat(40)}`;
    const rows = Array.from({ length: 8 }, (_, i) => [`Label ${i}`, long.slice(i * 400, i * 400 + 12000)]);
    expect(isPlausibleDataTable(rows, 0, { narrativeFinancialSection: true })).toBe(true);
  });
});

describe("mergeDollarOnlyCellsInRow", () => {
  it("merges $ with the following numeric cell", () => {
    expect(mergeDollarOnlyCellsInRow(["QxH", "$", "5,936", "$", "2,357"])).toEqual(["QxH", "$5,936", "$2,357"]);
  });

  it("drops a redundant $ cell when the amount already starts with $", () => {
    expect(mergeDollarOnlyCellsInRow(["A", "$", "$1.2M"])).toEqual(["A", "$1.2M"]);
  });

  it("does not merge when $ is not alone", () => {
    expect(mergeDollarOnlyCellsInRow(["$ millions", "5,936"])).toEqual(["$ millions", "5,936"]);
  });

  it("treats NBSP-wrapped $ as a currency-only cell", () => {
    expect(mergeDollarOnlyCellsInRow(["QxH", "\u00a0$\u00a0", "5,936"])).toEqual(["QxH", "$5,936"]);
  });

  it("does not merge $ with an empty following cell", () => {
    expect(mergeDollarOnlyCellsInRow(["Label", "$", ""])).toEqual(["Label", "$", ""]);
  });
});

describe("indexIxbrlBodyFlatText", () => {
  it("flattens text and records table start offsets in flattened space", () => {
    const html = `<html><body><p>x</p><table><tr><td>y</td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const body = $("body").get(0)!;
    const { flatText, tableOffsets, elementSpans } = indexIxbrlBodyFlatText(body);
    expect(flatText).toBe("x y");
    const tbl = $("table").get(0)!;
    expect(tableOffsets.get(tbl)).toBe(1);
    expect(elementSpans.get(tbl)).toEqual({ start: 1, end: flatText.length });
  });

  it('merges "I" + "TEM …" split across font tags into ITEM (Tesla-style MD&A headings)', () => {
    const pad = `<p>${"prelude ".repeat(400)}</p>`;
    const html = `<html><body>${pad}<p><font>I</font><font>TEM\u00a02. MANAGEMENT\u2019S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS</font></p></body></html>`;
    const $ = cheerio.load(html);
    const body = $("body").get(0)!;
    const { flatText } = indexIxbrlBodyFlatText(body);
    expect(flatText).toMatch(/ITEM\s+2\.\s+MANAGEMENT\u2019S\s+DISCUSSION/i);
    expect(flatText.toUpperCase()).not.toContain("I TEM 2");
  });

  it("findMdnaBounds finds Item 2 MD&A after I+TEM merge (real EDGAR ixbrl pattern)", () => {
    const pad = `<p>${"prelude ".repeat(500)}</p>`;
    const html = `<html><body>${pad}
      <p><font>I</font><font>TEM\u00a02. MANAGEMENT\u2019S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS</font></p>
      <p>${"liquidity capital resources overview results of operations ".repeat(120)}</p>
      <p>ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK</p>
      </body></html>`;
    const $ = cheerio.load(html);
    const body = $("body").get(0)!;
    const { flatText } = indexIxbrlBodyFlatText(body);
    const b = findMdnaBounds(flatText, "10-Q");
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThan(3000);
    expect(flatText.slice(b!.start, b!.start + 30)).toMatch(/ITEM\s+2/i);
    expect(b!.end).toBeLessThan(flatText.indexOf("ITEM 3. QUANTITATIVE") + 40);
  });
});

describe("buildDisplayTableHtml / inline amount cleanup", () => {
  it("merges same-cell <p>$</p><p>amount</p> (Tesla-style ixbrl)", () => {
    const html = `<html><body><table><tr><td>Auto</td><td><p>$</p><p>2,561,881</p></td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const tbl = $("table").get(0)!;
    const out = buildDisplayTableHtml($, tbl);
    expect(out).toBeTruthy();
    expect(out!).toMatch(/\$2,?561,?881/);
    expect(out!).not.toMatch(/<p>\s*\$\s*<\/p>\s*<p>/);
  });

  it("tightens parenthetical and percent spacing in numeric columns", () => {
    const html = `<html><body><table><tr><th>Line</th><th>$</th></tr><tr><td>x</td><td>(81,104 )</td></tr><tr><td>y</td><td>-32 %</td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!);
    expect(out).toBeTruthy();
    expect(out!).toContain("(81,104)");
    expect(out!).toContain("-32%");
    expect(out!).not.toContain("-32 %");
  });

  it("merges trailing <p>%</p> into the amount paragraph", () => {
    const html = `<html><body><table><tr><td>z</td><td><p>26</p><p>%</p></td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!);
    expect(out).toBeTruthy();
    expect(out!.replace(/\s+/g, " ")).toMatch(/26%\s*<\/p>|26%</);
  });

  it("collapses $ and digits separated by <br> in a cell", () => {
    const html = `<html><body><table><tr><td>a</td><td>$<br>1,234</td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!);
    expect(out).toBeTruthy();
    expect(out!.replace(/\s+/g, " ").toLowerCase()).toMatch(/\$\s*1,234/i);
  });

  it("unwraps single-child div wrappers around $ / amount blocks", () => {
    const html = `<html><body><table><tr><td>L</td><td><div><p>$</p></div><div><p>2,561,881</p></div></td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!);
    expect(out).toBeTruthy();
    expect(out!).toMatch(/\$2,?561,?881/);
  });

  it("merges a leading $ text node before the amount paragraph", () => {
    const html = `<html><body><table><tr><td>L</td><td>$<p>3,408,751</p></td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!);
    expect(out).toBeTruthy();
    expect(out!.replace(/\s+/g, "")).toMatch(/\$3,?408,?751/);
  });

  it("coalesces parenthetical amounts split across <p> blocks into one aligned span", () => {
    const html = `<html><body><table><tr><td>x</td><td><p>(0.3</p><p>)</p></td><td><p>(37.7</p><p> )</p></td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!);
    expect(out).toBeTruthy();
    expect(out!).toContain("ixbrl-amt-inline");
    expect(out!.replace(/\s+/g, "")).toMatch(/\(0\.3\).*\(37\.7\)/);
  });

  it("adds a space before footnote markers like EBITDA(1) in label column", () => {
    const html = `<html><body><table><tr><td>Adjusted EBITDA(1)</td><td>100</td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!);
    expect(out).toBeTruthy();
    expect(out!).toMatch(/Adjusted EBITDA \(1\)/);
  });

  it("collapses uniform empty spacer columns so labels become the first column (earnings table layout)", () => {
    const html = `<html><body><table><tbody>
      <tr><td></td><td></td><td>Net Revenue</td><td>$1,198</td></tr>
      <tr><td></td><td></td><td>Net Income</td><td>$65</td></tr>
    </tbody></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!);
    expect(out).toBeTruthy();
    const $o = cheerio.load(out!);
    const cells = $o("tr").first().children("td");
    expect(cells.length).toBe(2);
    expect(cells.eq(0).text()).toContain("Net Revenue");
    expect(cells.eq(1).text()).toContain("$");
  });

  it("treats nbsp-only and br-only cells as empty spacers for column collapse", () => {
    const html = `<html><body><table><tbody>
      <tr><td>&nbsp;</td><td><br /></td><td>Net Revenue</td><td>100</td></tr>
      <tr><td>&#160;</td><td></td><td>EBITDA</td><td>50</td></tr>
    </tbody></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!);
    expect(out).toBeTruthy();
    const $o = cheerio.load(out!);
    expect($o("tr").first().children("td").length).toBe(2);
  });
});

describe("buildDisplayTableHtml / filing fidelity (press-release tables)", () => {
  it("does not merge Tesla-style $ / amount blocks or normalize typography", () => {
    const html = `<html><body><table><tr><td>Auto</td><td><p>$</p><p>2,561,881</p></td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!, { fidelity: "filing" });
    expect(out).toBeTruthy();
    expect(out!).toMatch(/<p>\s*\$\s*<\/p>\s*<p>\s*2,?561,?881\s*<\/p>/);
  });

  it("does not collapse uniform empty spacer columns", () => {
    const html = `<html><body><table><tbody>
      <tr><td></td><td></td><td>Net Revenue</td><td>$1,198</td></tr>
      <tr><td></td><td></td><td>Net Income</td><td>$65</td></tr>
    </tbody></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!, { fidelity: "filing" });
    expect(out).toBeTruthy();
    const $o = cheerio.load(out!);
    expect($o("tr").first().children("td").length).toBe(4);
  });

  it("does not insert label footnote spacing or coalesce split parentheticals", () => {
    const html = `<html><body><table><tr><td>Adjusted EBITDA(1)</td><td><p>(0.3</p><p>)</p></td></tr></table></body></html>`;
    const $ = cheerio.load(html);
    const out = buildDisplayTableHtml($, $("table").get(0)!, { fidelity: "filing" });
    expect(out).toBeTruthy();
    expect(out!).toContain("Adjusted EBITDA(1)");
    expect(out!).not.toContain("ixbrl-amt-inline");
    expect(out!).toMatch(/<p>\(\s*0\.3\s*<\/p>/);
  });
});

describe("buildMdnaSectionDisplayHtml", () => {
  it("includes narrative and replaces ix nonFraction with display spans", () => {
    const html = `<html><body><div><p>alpha</p><ix:nonfraction scale="6" sign="-" unitRef="u" contextRef="c">123</ix:nonfraction></div></body></html>`;
    const $ = cheerio.load(html, { xmlMode: true });
    const body = $("body").get(0)!;
    const { elementSpans } = indexIxbrlBodyFlatText(body);
    const { html: out, truncated } = buildMdnaSectionDisplayHtml($, body, elementSpans, { start: 0, end: 500 });
    expect(truncated).toBe(false);
    expect(out).toBeTruthy();
    expect(out!).toContain("alpha");
    expect(out!).toContain("ixbrl-nf");
    expect(out!).toContain("ixbrl-mdna-section-root");
    expect(out!.toLowerCase()).not.toContain("nonfraction");
  });

  it("preserves table colspan/structure (filing fidelity — no column-collapse heuristics)", () => {
    const html = `<html><body><div><table><tr><th colspan="2">Header span</th></tr><tr><td>Left</td><td>Right</td></tr></table></div></body></html>`;
    const $ = cheerio.load(html, { xmlMode: true });
    const body = $("body").get(0)!;
    const { elementSpans } = indexIxbrlBodyFlatText(body);
    const { html: out } = buildMdnaSectionDisplayHtml($, body, elementSpans, { start: 0, end: 500 });
    expect(out).toBeTruthy();
    expect(out!).toMatch(/colspan\s*=\s*["']2["']/i);
  });

  it("strips negative text-indent from table row paragraph (legacy EDGAR hanging indent)", () => {
    const html = `<html><body><div><table><tr><td><p style="margin-left:10pt;text-indent:-10pt;"><span> </span><span>Balance</span></p></td><td>x</td></tr></table></div></body></html>`;
    const $ = cheerio.load(html, { xmlMode: true });
    const body = $("body").get(0)!;
    const { elementSpans } = indexIxbrlBodyFlatText(body);
    const { html: out } = buildMdnaSectionDisplayHtml($, body, elementSpans, { start: 0, end: 500 });
    expect(out).toBeTruthy();
    expect(out!).toContain("Balance");
    expect(out!).not.toMatch(/text-indent\s*:\s*-/i);
  });

  it("strips negative text-indent from table row div labels (not only p)", () => {
    const html = `<html><body><div><table><tr><td><div style="margin-left:8pt;text-indent:-8pt;">Membership fees</div></td><td>1</td></tr></table></div></body></html>`;
    const $ = cheerio.load(html, { xmlMode: true });
    const body = $("body").get(0)!;
    const { elementSpans } = indexIxbrlBodyFlatText(body);
    const { html: out } = buildMdnaSectionDisplayHtml($, body, elementSpans, { start: 0, end: 500 });
    expect(out).toBeTruthy();
    expect(out!).toContain("Membership fees");
    expect(out!).not.toMatch(/text-indent\s*:\s*-/i);
  });
});
