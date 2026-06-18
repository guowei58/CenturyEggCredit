import { describe, expect, it } from "vitest";

import type { SourceFileRecord } from "./types";
import { classifySourceFilename, categoryPriority } from "./fileClassifier";
import { planMemoOutline, sortMemoDeckSourcesForEvidence, sortSourcesForEvidence } from "./memoPlanner";
import { buildEvidencePackSync } from "./evidencePack";
import { CREDIT_MEMO_CHUNK_OVERLAP_CHARS } from "./chunkConstants";
import type { CreditMemoProject } from "./types";

function stubSource(partial: Pick<SourceFileRecord, "relPath" | "category">): SourceFileRecord {
  return {
    id: partial.relPath,
    relPath: partial.relPath,
    absPath: `/x/${partial.relPath}`,
    size: 0,
    ext: "",
    category: partial.category,
    modifiedAt: null,
    parseStatus: "ok",
    charExtracted: 0,
  };
}

describe("credit memo file classifier", () => {
  it("classifies debt and SEC filenames", () => {
    expect(classifySourceFilename("Credit-Agreement-2024.pdf")).toBe("debt_document");
    expect(classifySourceFilename("lumn-2023-10k.pdf")).toBe("sec_filing");
    expect(classifySourceFilename("model/LBO_v3.xlsx")).toBe("model_spreadsheet");
  });

  it("prioritizes debt over news", () => {
    expect(categoryPriority("debt_document")).toBeGreaterThan(categoryPriority("news"));
  });
});

describe("credit memo planner", () => {
  it("sorts text-like ingested files before PDFs at equal category", () => {
    const ordered = sortSourcesForEvidence([
      stubSource({ relPath: "indenture.pdf", category: "debt_document" }),
      stubSource({ relPath: "notes/scratch.md", category: "debt_document" }),
      stubSource({ relPath: "Credit-Agreement.docx", category: "debt_document" }),
    ]);
    expect(ordered.map((s) => s.relPath)).toEqual(["notes/scratch.md", "Credit-Agreement.docx", "indenture.pdf"]);
  });

  it("allocates word budget across sections", () => {
    const outline = planMemoOutline(10_000, []);
    expect(outline.targetWords).toBe(10_000);
    expect(outline.totalWordBudget).toBe(10_000);
    const sumWords = outline.sections.reduce((a, s) => a + s.targetWords, 0);
    expect(sumWords).toBeGreaterThan(9_000);
    expect(sumWords).toBeLessThanOrEqual(10_500);
    expect(outline.sections.some((s) => s.id === "trade")).toBe(true);
  });

  it("sortMemoDeckSourcesForEvidence prioritizes work-product markdown before saved tabs and SEC", () => {
    const ordered = sortMemoDeckSourcesForEvidence([
      stubSource({ relPath: "overview.txt", category: "research" }),
      stubSource({ relPath: "kpi-latest.md", category: "research" }),
      stubSource({ relPath: "__ceg_user_saved_documents__/MSFT_10-K-FY2024.html", category: "sec_filing" }),
    ]);
    expect(ordered.map((s) => s.relPath)).toEqual([
      "kpi-latest.md",
      "overview.txt",
      "__ceg_user_saved_documents__/MSFT_10-K-FY2024.html",
    ]);
  });
});

describe("buildEvidencePackSync", () => {
  it("stitches overlapping chunks without duplicating boundary text", () => {
    const overlap = "O".repeat(CREDIT_MEMO_CHUNK_OVERLAP_CHARS);
    const project: CreditMemoProject = {
      id: "p1",
      ticker: "TEST",
      resolvedFolderPath: "/research/TEST",
      folderResolutionJson: null,
      status: "ingested",
      createdAt: "",
      updatedAt: "",
      sources: [
        {
          ...stubSource({ relPath: "notes.txt", category: "research" }),
          id: "s1",
          charExtracted: 100,
        },
      ],
      chunks: [
        { id: "c0", sourceFileId: "s1", chunkIndex: 0, text: `A-${overlap}`, sectionLabel: null },
        { id: "c1", sourceFileId: "s1", chunkIndex: 1, text: `${overlap}B`, sectionLabel: null },
      ],
      tables: [],
      ingestWarnings: [],
    };
    const pack = buildEvidencePackSync(project, { maxChars: 50_000, memoDeckOrder: true });
    expect(pack).toContain(`A-${overlap}B`);
    expect(pack).not.toContain(`${overlap}${overlap}`);
  });
});
