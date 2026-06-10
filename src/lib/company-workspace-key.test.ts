import { describe, expect, it } from "vitest";
import {
  formatWorkspaceBadge,
  isCikWorkspaceKey,
  parseCompanyLookupInput,
} from "@/lib/company-workspace-key";

describe("isCikWorkspaceKey", () => {
  it("accepts zero-padded 10-digit keys", () => {
    expect(isCikWorkspaceKey("0001780924")).toBe(true);
    expect(isCikWorkspaceKey("0000320193")).toBe(true);
  });

  it("rejects tickers and short numbers", () => {
    expect(isCikWorkspaceKey("MSFT")).toBe(false);
    expect(isCikWorkspaceKey("1780924")).toBe(false);
    expect(isCikWorkspaceKey("")).toBe(false);
  });
});

describe("formatWorkspaceBadge", () => {
  it("prefixes CIK keys", () => {
    expect(formatWorkspaceBadge("0001780924")).toBe("CIK 0001780924");
  });

  it("uppercases ticker keys", () => {
    expect(formatWorkspaceBadge("lumn")).toBe("LUMN");
  });
});

describe("parseCompanyLookupInput", () => {
  it("parses bare numeric CIK", () => {
    expect(parseCompanyLookupInput("1780924")).toEqual({
      kind: "cik",
      normalized: "0001780924",
    });
  });

  it("parses CIK prefix forms", () => {
    expect(parseCompanyLookupInput("CIK 0001780924")).toEqual({
      kind: "cik",
      normalized: "0001780924",
    });
    expect(parseCompanyLookupInput("cik:1780924")).toEqual({
      kind: "cik",
      normalized: "0001780924",
    });
  });

  it("parses tickers", () => {
    expect(parseCompanyLookupInput("MSFT")).toEqual({
      kind: "ticker",
      normalized: "MSFT",
    });
    expect(parseCompanyLookupInput("BRK.B")).toEqual({
      kind: "ticker",
      normalized: "BRK.B",
    });
  });

  it("returns null for empty input", () => {
    expect(parseCompanyLookupInput("")).toBeNull();
    expect(parseCompanyLookupInput("   ")).toBeNull();
  });
});
