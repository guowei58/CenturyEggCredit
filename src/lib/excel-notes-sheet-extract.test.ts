import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractNotesSheetFromXlsxBuffer, findNotesLikeSheetName } from "@/lib/excel-notes-sheet-extract";

describe("excel-notes-sheet-extract", () => {
  it("prefers Notes over other sheet names", () => {
    expect(findNotesLikeSheetName(["Capital Structure", "Notes", "Sources"])).toBe("Notes");
    expect(findNotesLikeSheetName(["Org Chart", "Summary notes"])).toBe("Summary notes");
    expect(findNotesLikeSheetName(["Org Chart", "Notes / Assumptions"])).toBe("Notes / Assumptions");
  });

  it("extracts cell text from the notes sheet", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["ignore"]]), "Org Chart");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Summary"],
        ["Total debt is $5bn with maturities in 2029."],
      ]),
      "Notes"
    );
    const buf = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    expect(extractNotesSheetFromXlsxBuffer(buf)).toContain("Total debt is $5bn");
  });
});
