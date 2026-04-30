import { describe, expect, it } from "vitest";

import { extractEmployerIdentificationNumberFromTenK } from "@/lib/buildPublicRecordsProfileFromSec";

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
