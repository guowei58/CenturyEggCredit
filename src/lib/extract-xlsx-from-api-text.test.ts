import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { extractXlsxArrayBufferFromApiText, isLikelyXlsxBytes } from "@/lib/extract-xlsx-from-api-text";

function minimalXlsxBase64(): string {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Ticker", "Debt"]]), "Capital Structure");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  return Buffer.from(bytes).toString("base64");
}

describe("extractXlsxArrayBufferFromApiText", () => {
  it("extracts from ```xlsx fence", () => {
    const b64 = minimalXlsxBase64();
    const text = `\`\`\`xlsx\n${b64}\n\`\`\``;
    const buf = extractXlsxArrayBufferFromApiText(text);
    expect(buf).not.toBeNull();
    expect(isLikelyXlsxBytes(new Uint8Array(buf!))).toBe(true);
    const wb = XLSX.read(buf!, { type: "array" });
    expect(wb.SheetNames).toContain("Capital Structure");
  });

  it("prefers xlsx fence over trailing prose", () => {
    const b64 = minimalXlsxBase64();
    const text = `Here is a summary of debt.\n\n\`\`\`xlsx\n${b64}\n\`\`\``;
    const buf = extractXlsxArrayBufferFromApiText(text);
    expect(buf).not.toBeNull();
  });

  it("returns null for plain markdown", () => {
    expect(extractXlsxArrayBufferFromApiText("# Debt\n\n| Col | Val |\n| --- | --- |")).toBeNull();
  });
});
