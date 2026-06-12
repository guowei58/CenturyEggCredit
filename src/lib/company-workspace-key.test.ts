import { describe, expect, it } from "vitest";
import {
  formatWorkspaceBadge,
  isCikWorkspaceKey,
  isPrivateWorkspaceKey,
  parseCompanyLookupInput,
  privateWorkspaceDisplayName,
  privateWorkspaceKeyFromName,
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

  it("labels private workspace keys with readable slug", () => {
    expect(formatWorkspaceBadge("PRIVMIXBOOK")).toBe("PRIVMIXBOOK");
  });
});

describe("privateWorkspaceKeyFromName", () => {
  it("returns PRIV + name slug", () => {
    expect(privateWorkspaceKeyFromName("Mixbook")).toBe("PRIVMIXBOOK");
    expect(privateWorkspaceKeyFromName("McAfee")).toBe("PRIVMCAFEE");
    expect(isPrivateWorkspaceKey("PRIVMIXBOOK")).toBe(true);
  });

  it("normalizes punctuation and spacing", () => {
    expect(privateWorkspaceKeyFromName("  Acme   Corp ")).toBe("PRIVACMECORP");
    expect(privateWorkspaceKeyFromName("Mix Book")).toBe("PRIVMIXBOOK");
  });

  it("truncates long names to fit 12-char workspace key", () => {
    expect(privateWorkspaceKeyFromName("International Business Machines")).toBe("PRIVINTERNAT");
    expect(privateWorkspaceKeyFromName("International Business Machines")).toHaveLength(12);
  });

  it("decodes display name from slug when metadata is missing", () => {
    expect(privateWorkspaceDisplayName("PRIVMIXBOOK")).toBe("Mixbook");
    expect(privateWorkspaceDisplayName("PRIVMIXBOOK", "Mixbook Inc.")).toBe("Mixbook Inc.");
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
    expect(parseCompanyLookupInput("gen")).toEqual({
      kind: "ticker",
      normalized: "GEN",
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

  it("parses freeform company names", () => {
    expect(parseCompanyLookupInput("McAfee")).toEqual({
      kind: "ticker",
      normalized: "MCAFEE",
    });
    expect(parseCompanyLookupInput("Acme Corp")).toEqual({
      kind: "name",
      normalized: "Acme Corp",
    });
  });
});
