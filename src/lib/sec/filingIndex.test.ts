import { describe, expect, it } from "vitest";
import {
  accessionForIndexHtmlBasename,
  htmlLooksLikePersonnelOnlyPressNotEarningsResults,
  html8KPrimaryDefersEarningsToExhibitAttachment,
  looksLike8kFormCoverShellHtml,
  parseExhibit99HtmlFilenamesFromSubmissionTxt,
  parseFilingDetailIndexHtmlAttachments,
  rankExhibit99HtmlFilenames,
  scoreExhibit99HtmlFilename,
  submissionDocumentTypeIsExhibit99,
} from "@/lib/sec/filingIndex";

describe("accessionForIndexHtmlBasename", () => {
  it("inserts dashes for 18-digit accessions", () => {
    expect(accessionForIndexHtmlBasename("000114420415004623")).toBe("0001144204-15-004623");
    expect(accessionForIndexHtmlBasename("0001144204-15-004623")).toBe("0001144204-15-004623");
  });
});

describe("parseFilingDetailIndexHtmlAttachments", () => {
  it("pulls attachment basenames from filing-detail index.htm hrefs", () => {
    const html = `<tr><td><a href="/Archives/edgar/data/814547/000114420415004623/v399818_8k.htm">x</a></td></tr>
<tr><td><a href="/Archives/edgar/data/814547/000114420415004623/v399818_ex99-1.htm">y</a></td></tr>`;
    const names = parseFilingDetailIndexHtmlAttachments(html, 814547, "000114420415004623").sort();
    expect(names).toEqual(["v399818_8k.htm", "v399818_ex99-1.htm"]);
  });
});

describe("scoreExhibit99HtmlFilename", () => {
  it("scores Workiva-style exhibit basenames with 99 + quarter and no ex99 token (REXR-style)", () => {
    expect(scoreExhibit99HtmlFilename("rexrex991q1-2026.htm")).toBeGreaterThanOrEqual(58);
    expect(scoreExhibit99HtmlFilename("rexrex992q1-2026.htm")).toBeGreaterThanOrEqual(58);
  });

  it("scores typical Exhibit 99.1 HTML names", () => {
    expect(scoreExhibit99HtmlFilename("ex99-1.htm")).toBeGreaterThanOrEqual(58);
    expect(scoreExhibit99HtmlFilename("nwsa-ex991_03072020.htm")).toBeGreaterThanOrEqual(58);
    expect(scoreExhibit99HtmlFilename("a8-kexhibit991.htm")).toBeGreaterThanOrEqual(58);
    expect(scoreExhibit99HtmlFilename("exhibit991erq22024.htm")).toBeGreaterThanOrEqual(58);
    expect(scoreExhibit99HtmlFilename("d881734dex991.htm")).toBeGreaterThanOrEqual(58);
    expect(scoreExhibit99HtmlFilename("tv499357_ex99-1.htm")).toBeGreaterThanOrEqual(58);
  });

  it("rejects non-HTML and index artifacts", () => {
    expect(scoreExhibit99HtmlFilename("index.htm")).toBe(0);
    expect(scoreExhibit99HtmlFilename("press.pdf")).toBe(0);
    expect(scoreExhibit99HtmlFilename("FilingSummary.xml")).toBe(0);
  });

  it("rewards issuer-style earnings release HTML basenames", () => {
    expect(scoreExhibit99HtmlFilename("ctl20148-earningsreleasex.htm")).toBeGreaterThanOrEqual(58);
  });

  it("scores glued `kexhibit991…` CenturyLink / Lumen exhibit HTML names", () => {
    expect(scoreExhibit99HtmlFilename("ctl20178-kexhibit9913q.htm")).toBeGreaterThanOrEqual(58);
    expect(scoreExhibit99HtmlFilename("ctl20178-kexhibit9923q.htm")).toBeGreaterThanOrEqual(58);
  });

  it("scores legacy abbreviated press release names like pressrls.htm", () => {
    expect(scoreExhibit99HtmlFilename("pressrls.htm")).toBeGreaterThanOrEqual(42);
    expect(scoreExhibit99HtmlFilename("pressrel.htm")).toBeGreaterThanOrEqual(42);
  });

  it("scores exh-prefixed exhibit 99 HTML basenames", () => {
    expect(scoreExhibit99HtmlFilename("exh99.htm")).toBeGreaterThanOrEqual(58);
    expect(scoreExhibit99HtmlFilename("exh99-1.htm")).toBeGreaterThanOrEqual(58);
    expect(scoreExhibit99HtmlFilename("exh991.htm")).toBeGreaterThanOrEqual(58);
  });

  it("scores other legacy earnings HTML stubs and qtr filenames", () => {
    expect(scoreExhibit99HtmlFilename("er.htm")).toBeGreaterThanOrEqual(42);
    expect(scoreExhibit99HtmlFilename("er.htm")).toBeLessThan(58);
    expect(scoreExhibit99HtmlFilename("earnings4thqtr.htm")).toBeGreaterThanOrEqual(58);
  });
});

describe("parseExhibit99HtmlFilenamesFromSubmissionTxt", () => {
  it("pulls ordered EX-99 HTML names from submission text", () => {
    const txt = `<SEC-DOCUMENT>
<DOCUMENT>
<TYPE>8-K
<SEQUENCE>1
<FILENAME>earningsrelease.htm
<TEXT><html></html>
</DOCUMENT>
<DOCUMENT>
<TYPE>EX-99.1
<SEQUENCE>2
<FILENAME>presssrelease.htm
<TEXT><html></html>
</DOCUMENT>
<DOCUMENT>
<TYPE>GRAPHIC
<SEQUENCE>3
<FILENAME>logo.jpg
<TEXT>begin
</DOCUMENT>
</SEC-DOCUMENT>`;
    expect(parseExhibit99HtmlFilenamesFromSubmissionTxt(txt)).toEqual(["presssrelease.htm"]);
  });

  it("dedupes repeated EX-99 blocks", () => {
    const txt = `<DOCUMENT>
<TYPE>EX-99.1
<FILENAME>a.htm
</DOCUMENT>
<DOCUMENT>
<TYPE>EX-99.2
<FILENAME>b.htm
</DOCUMENT>`;
    expect(parseExhibit99HtmlFilenamesFromSubmissionTxt(txt)).toEqual(["a.htm", "b.htm"]);
  });
});

describe("submissionDocumentTypeIsExhibit99", () => {
  it("accepts common SEC submission type spellings", () => {
    expect(submissionDocumentTypeIsExhibit99("EX-99.1")).toBe(true);
    expect(submissionDocumentTypeIsExhibit99("EX-99")).toBe(true);
    expect(submissionDocumentTypeIsExhibit99("Exhibit 99.1")).toBe(true);
    expect(submissionDocumentTypeIsExhibit99("8-K")).toBe(false);
    expect(submissionDocumentTypeIsExhibit99("GRAPHIC")).toBe(false);
  });
});

describe("rankExhibit99HtmlFilenames", () => {
  it("prefers submission .txt EX-99.1 order over basename scores (NXST-style)", () => {
    const names = ["earningsrelease.htm", "presssrelease.htm"];
    const ranked = rankExhibit99HtmlFilenames(names, {
      primaryDocumentForOrdering: "earningsrelease.htm",
      submissionTxtExhibit99Ordered: ["presssrelease.htm"],
    });
    expect(ranked[0]).toBe("presssrelease.htm");
    expect(ranked[1]).toBe("earningsrelease.htm");
  });

  it("orders by score and excludes listed names", () => {
    const names = [
      "shell-8k.htm",
      "ex99-2.htm",
      "ex99-1.htm",
      "shell-8k.htm",
      "random.htm",
    ];
    const ranked = rankExhibit99HtmlFilenames(names, { excludeLowercase: new Set(["ex99-2.htm"]) });
    expect(ranked).toEqual(["ex99-1.htm"]);
  });

  it("lists non-primary attachments before the primary when both are in the same tier", () => {
    const names = ["ctl20178-kearningsrelease3q.htm", "ctl20178-kexhibit9913q.htm"];
    const ranked = rankExhibit99HtmlFilenames(names, {
      primaryDocumentForOrdering: "ctl20178-kearningsrelease3q.htm",
    });
    expect(ranked[0]).toBe("ctl20178-kexhibit9913q.htm");
    expect(ranked[1]).toBe("ctl20178-kearningsrelease3q.htm");
  });

  /**
   * NXST-style legacy packs: primary `earningsrelease.htm` (tier-1 filename, short Item 2.02 shell) plus a bulky
   * sibling `presssrelease.htm` that is only tier-2 on `press`+`release`. We must still rank the sibling.
   */
  it("keeps tier-2 press-release siblings when the primary is tier-1 (legacy earnings 8-K folders)", () => {
    const names = ["earningsrelease.htm", "presssrelease.htm"];
    const ranked = rankExhibit99HtmlFilenames(names, {
      primaryDocumentForOrdering: "earningsrelease.htm",
    });
    expect(ranked[0]).toBe("presssrelease.htm");
    expect(ranked[1]).toBe("earningsrelease.htm");
    expect(scoreExhibit99HtmlFilename("earningsrelease.htm")).toBeGreaterThanOrEqual(58);
    expect(scoreExhibit99HtmlFilename("presssrelease.htm")).toBeGreaterThanOrEqual(42);
    expect(scoreExhibit99HtmlFilename("presssrelease.htm")).toBeLessThan(58);
  });

  it("falls back to mid-confidence 99-shaped HTML when no high-confidence exhibit names exist", () => {
    const ranked = rankExhibit99HtmlFilenames(["random.htm", "issuer_99_a.htm"]);
    expect(ranked).toEqual(["issuer_99_a.htm"]);
    expect(scoreExhibit99HtmlFilename("issuer_99_a.htm")).toBeGreaterThanOrEqual(42);
    expect(scoreExhibit99HtmlFilename("issuer_99_a.htm")).toBeLessThan(58);
  });
});

describe("html8KPrimaryDefersEarningsToExhibitAttachment", () => {
  it("is true for Workiva 8-K primaries that link to Exhibit 99 earnings HTML (CMPR-style)", () => {
    const html = `<html><body>Item 2.02 Results of Operations
    <p>furnished as Exhibit 99.1 to this report.</p>
    <a style="-sec-extract:exhibit" href="q3_fy26quarterlyearnings.htm">Q3 Fiscal Year 2026 Quarterly Earnings Document</a>
    </body></html>`;
    expect(html8KPrimaryDefersEarningsToExhibitAttachment(html)).toBe(true);
  });

  it("is false for a standalone earnings press body", () => {
    const html = `<html><body>${"x".repeat(400)}<p>Press release. Today we announced financial results for Q3.</p></body></html>`;
    expect(html8KPrimaryDefersEarningsToExhibitAttachment(html)).toBe(false);
  });
});

describe("looksLike8kFormCoverShellHtml", () => {
  const pad = (s: string) => s + "\n" + "x".repeat(250);

  it("is true for a short Form 8-K cover without Item 2.02", () => {
    const html = pad(
      `<html><body>UNITED STATES SECURITIES AND EXCHANGE COMMISSION WASHINGTON, D.C. 20549 FORM 8-K CURRENT REPORT Pursuant to Section 13 OR 15(d)</body></html>`
    );
    expect(looksLike8kFormCoverShellHtml(html)).toBe(true);
  });

  it("is false when Item 2.02 is present", () => {
    const html = pad(
      `<html><body>FORM 8-K CURRENT REPORT SECURITIES AND EXCHANGE COMMISSION Item 2.02 Results of Operations</body></html>`
    );
    expect(looksLike8kFormCoverShellHtml(html)).toBe(false);
  });

  it("is false for very long HTML (likely full exhibit / press body)", () => {
    const base =
      "SECURITIES AND EXCHANGE COMMISSION FORM 8-K CURRENT REPORT Pursuant to Section 13 ";
    const html = base + "x".repeat(90_000);
    expect(looksLike8kFormCoverShellHtml(html)).toBe(false);
  });
});

describe("htmlLooksLikePersonnelOnlyPressNotEarningsResults", () => {
  it("is true for officer appointment releases without earnings language", () => {
    const html = `<html><body><h1>News Release</h1>
    <p>Sandy Breland was named Chief Operating Officer of Example Corp effective May 22, 2023.</p>
    </body></html>`;
    expect(htmlLooksLikePersonnelOnlyPressNotEarningsResults(html)).toBe(true);
  });

  it("is false when quarterly / earnings language is present", () => {
    const html = `<html><body><p>Q1 2023 financial results and earnings conference call. Jane Doe named CFO.</p></body></html>`;
    expect(htmlLooksLikePersonnelOnlyPressNotEarningsResults(html)).toBe(false);
  });
});
