import { describe, expect, it } from "vitest";

import {
  extractEmployerIdentificationNumberFromTenK,
  extractPropertiesSectionFromTenKHtml,
  extractPropertiesSectionFromTenKText,
} from "@/lib/buildPublicRecordsProfileFromSec";

describe("extractEmployerIdentificationNumberFromTenK", () => {
  it("parses EIN immediately after Employer Identification No. (period after label)", () => {
    expect(
      extractEmployerIdentificationNumberFromTenK(
        "FOO INC. Employer Identification No. 12-3456789 BAR",
        "",
      ),
    ).toBe("12-3456789");
  });

  it("parses hyphenless nine digits immediately after canonical label text", () => {
    expect(
      extractEmployerIdentificationNumberFromTenK(
        "IRS Employer Identification No.: 943294953 BAR",
        "",
      ),
    ).toBe("94-3294953");
  });

  it("accepts unicode hyphen separators between XX and XXXXXXX", () => {
    expect(
      extractEmployerIdentificationNumberFromTenK(
        "Employer Identification Number\u201087\u20116543299",
        "",
      ),
    ).toBe("87-6543299");
  });

  it("finds EIN in a split IXBRL/table cell after a parenthetical IRS label", () => {
    const ix = `<tr><td colspan="2"><span>(I.R.S. Employer Identification No.)</span></td></tr><tr><td colspan="2"><span>94<span>-</span>2404110</span></td></tr>`;
    expect(extractEmployerIdentificationNumberFromTenK("", "", ix)).toBe("94-2404110");
  });

  it("decodes numeric entities (e.g. &#8211;) in raw HTML EIN cell", () => {
    const ix = `(I.R.S. Employer Identification No.)</td><td>94&#8211;2404110</td>`;
    expect(extractEmployerIdentificationNumberFromTenK("", "", ix)).toBe("94-2404110");
  });

  it("prefers hyphen EIN near Employer Identification when several dashed groups appear on cover", () => {
    const cover =
      "Commission File Number: 333-1234567 SOME JUNK Employer Identification No. 94-2404110 FORM 10-K";
    expect(extractEmployerIdentificationNumberFromTenK(cover, "")).toBe("94-2404110");
  });

  it("first hyphen XX-XXXXXXX on cover wins when multiple matches have no IRS context", () => {
    const cover = "Page 1 header 55-4444444 then later 98-7654321 after ITEM 7";
    expect(extractEmployerIdentificationNumberFromTenK(cover, "")).toBe("55-4444444");
  });

  it("cover scan finds hyphen EIN after noise in flattened IX HTML", () => {
    const noisy = `<div style="">${"x ".repeat(2000)}</div><span>(I.R.S.)</span> 33-8877666`;
    expect(extractEmployerIdentificationNumberFromTenK("", "", noisy)).toBe("33-8877666");
  });
});

describe("extractPropertiesSectionFromTenKText", () => {
  it("extracts the real Item 2 properties section body", () => {
    const tenK = `
TABLE OF CONTENTS
Item 2. Properties ................................ 15
Item 3. Legal Proceedings .......................... 19

PART I

ITEM 2. PROPERTIES

We own our corporate headquarters in Denver, Colorado.
We lease distribution centers in Texas and Ohio.

ITEM 3. LEGAL PROCEEDINGS
No material proceedings.
`;

    expect(extractPropertiesSectionFromTenKText(tenK)).toContain("We own our corporate headquarters in Denver, Colorado.");
  });

  it("ignores an early table-of-contents hit and prefers the later full section", () => {
    const tenK = `
TABLE OF CONTENTS
ITEM 2. PROPERTIES
ITEM 3. LEGAL PROCEEDINGS

... many pages later ...

PART I
ITEM 2. PROPERTIES

Our properties include manufacturing plants, office campuses, and warehouse facilities across the United States.
Several properties are owned and others are leased.

ITEM 3. LEGAL PROCEEDINGS
None.
`;

    const extracted = extractPropertiesSectionFromTenKText(tenK);
    expect(extracted).toContain("manufacturing plants");
    expect(extracted).not.toContain("TABLE OF CONTENTS");
  });

  it("returns null when no Item 2 properties section is present", () => {
    expect(extractPropertiesSectionFromTenKText("ITEM 1. BUSINESS\nNo properties heading here.")).toBeNull();
  });
});

describe("extractPropertiesSectionFromTenKHtml", () => {
  it("preserves tables inside the properties section html excerpt", () => {
    const html = `
      <html><body>
        <div>TABLE OF CONTENTS Item 2. Properties .... Item 3. Legal Proceedings</div>
        <h2>PART I</h2>
        <h2>ITEM 2. PROPERTIES</h2>
        <p>Our properties include offices and warehouses.</p>
        <table>
          <tr><th>Location</th><th>Owned / Leased</th></tr>
          <tr><td>Dallas, TX</td><td>Owned</td></tr>
        </table>
        <h2>ITEM 3. LEGAL PROCEEDINGS</h2>
      </body></html>
    `;

    const extracted = extractPropertiesSectionFromTenKHtml(html);
    expect(extracted).toContain("<table>");
    expect(extracted).toContain("Dallas, TX");
    expect(extracted).not.toContain("TABLE OF CONTENTS");
  });
});
