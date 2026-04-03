import { describe, expect, it } from "vitest";

import { normalizeUrlForMatch } from "./utils";
import { classifyLink } from "./classify/linkClassifier";
import { dedupeAssets } from "./crawl/dedupe";

describe("irIndexer url normalization", () => {
  it("strips tracking params and hashes", () => {
    const out = normalizeUrlForMatch("https://example.com/path?a=1&utm_source=x#frag");
    expect(out).toBe("https://example.com/path?a=1");
  });
});

describe("irIndexer link classification", () => {
  it("classifies pdf", () => {
    const r = classifyLink({ url: "https://example.com/deck.pdf", anchorText: "Investor Presentation" });
    expect(r.assetType).toBe("pdf");
  });
  it("classifies sec filing via host", () => {
    const r = classifyLink({ url: "https://www.sec.gov/Archives/edgar/data/1/x.htm", anchorText: "10-K" });
    expect(r.assetType).toBe("sec_filing");
  });
  it("classifies presentation via anchor", () => {
    const r = classifyLink({ url: "https://example.com/foo", anchorText: "Q4 Presentation" });
    expect(r.assetType).toBe("presentation");
  });
});

describe("irIndexer dedupe", () => {
  it("dedupes by normalized_url", () => {
    const out = dedupeAssets([
      { normalized_url: "https://a.com/x" },
      { normalized_url: "https://a.com/x" },
      { normalized_url: "https://a.com/y" },
    ]);
    expect(out).toHaveLength(2);
  });
});

