import { describe, expect, it } from "vitest";

import { userSavedDocumentIncludedInLmeCorpus } from "@/lib/lme-saved-documents-filter";

describe("userSavedDocumentIncludedInLmeCorpus", () => {
  const small = 1024;

  it("excludes ABI-style car-wash research HTML (generic other)", () => {
    const fn =
      "2026-04-15T14-21-13-475Z - zips-car-wash-pursuing-bankruptcy-to-facilitate-hand-off-to-lenders.html";
    const r = userSavedDocumentIncludedInLmeCorpus(fn, small);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("generic saved document");
  });

  it("includes SEC material-contract style filenames in saved-docs folder", () => {
    const fn = "2026-04-15T14-46-23-571Z - d353521dex101.html";
    expect(userSavedDocumentIncludedInLmeCorpus(fn, small).ok).toBe(true);
  });

  it("excludes filenames that classify as news (e.g. wsj in basename)", () => {
    const fn = "2026-01-01T00-00-00-000Z - wsj-company-update.html";
    const r = userSavedDocumentIncludedInLmeCorpus(fn, small);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("news-style");
  });

  it("excludes opaque research notes classified as other", () => {
    const fn = "industry-history-drivers.txt";
    const r = userSavedDocumentIncludedInLmeCorpus(fn, small);
    expect(r.ok).toBe(false);
  });

  it("excludes Excel saved documents (same as work-product ingest)", () => {
    const fn = "model-workbook.xlsx";
    const r = userSavedDocumentIncludedInLmeCorpus(fn, small);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Excel");
  });
});
