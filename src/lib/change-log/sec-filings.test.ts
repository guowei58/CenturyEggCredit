import { describe, expect, it } from "vitest";
import { isMaterialChangeLogSecForm } from "./sec-filings";

describe("isMaterialChangeLogSecForm", () => {
  it("accepts base and amended material forms", () => {
    expect(isMaterialChangeLogSecForm("8-K")).toBe(true);
    expect(isMaterialChangeLogSecForm("8-K/A")).toBe(true);
    expect(isMaterialChangeLogSecForm("10-Q/A")).toBe(true);
    expect(isMaterialChangeLogSecForm("424B5")).toBe(true);
    expect(isMaterialChangeLogSecForm("4")).toBe(true);
    expect(isMaterialChangeLogSecForm("4/A")).toBe(true);
  });

  it("rejects routine forms", () => {
    expect(isMaterialChangeLogSecForm("UPLOAD")).toBe(false);
    expect(isMaterialChangeLogSecForm("CORRESP")).toBe(false);
    expect(isMaterialChangeLogSecForm("ARS")).toBe(false);
  });
});
