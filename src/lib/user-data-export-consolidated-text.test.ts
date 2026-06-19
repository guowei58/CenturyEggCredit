import { describe, expect, it } from "vitest";

import {
  assembleConsolidatedTextfile,
  buildConsolidatedSectionsFromRows,
  CONSOLIDATED_TEXTFILE_NAME,
  isExcludedConsolidatedWorkProductDataKey,
  shouldIncludeInConsolidatedTextfile,
} from "@/lib/user-data-export-consolidated-text";

describe("shouldIncludeInConsolidatedTextfile", () => {
  it("includes response-box txt tabs", () => {
    expect(shouldIncludeInConsolidatedTextfile("overview", "overview.txt")).toBe(true);
  });

  it("includes work-product md outputs", () => {
    expect(shouldIncludeInConsolidatedTextfile("kpi-latest", "kpi-latest.md")).toBe(true);
  });

  it("excludes literary, biblical, shorting, and earnings transcript work products", () => {
    expect(isExcludedConsolidatedWorkProductDataKey("literary-references-latest")).toBe(true);
    expect(isExcludedConsolidatedWorkProductDataKey("biblical-references-latest")).toBe(true);
    expect(isExcludedConsolidatedWorkProductDataKey("how-to-look-like-a-dumbass-latest")).toBe(true);
    expect(isExcludedConsolidatedWorkProductDataKey("next-quarter-earnings-transcript-latest")).toBe(true);
    expect(shouldIncludeInConsolidatedTextfile("literary-references-latest", "literary-references-latest.md")).toBe(
      false
    );
  });

  it("excludes meta and source-pack files", () => {
    expect(shouldIncludeInConsolidatedTextfile("kpi-latest-meta", "kpi-latest-meta.json")).toBe(false);
    expect(shouldIncludeInConsolidatedTextfile("kpi-latest-source-pack", "kpi-latest-source-pack.txt")).toBe(false);
  });
});

describe("assembleConsolidatedTextfile", () => {
  it("orders information-gathering tabs before work products", () => {
    const sections = buildConsolidatedSectionsFromRows([
      { dataKey: "kpi-latest", content: "KPI body" },
      { dataKey: "overview", content: "Overview body" },
    ]);
    const text = assembleConsolidatedTextfile(sections, "CRM");
    const overviewIdx = text.indexOf("Overview");
    const kpiIdx = text.indexOf("Kpi Latest");
    expect(overviewIdx).toBeGreaterThan(-1);
    expect(kpiIdx).toBeGreaterThan(overviewIdx);
  });

  it("uses the expected export filename constant", () => {
    expect(CONSOLIDATED_TEXTFILE_NAME).toBe("CONSOLIDATED TEXTFILE.txt");
  });
});
