import { describe, expect, it } from "vitest";

import { resolveAdjustedEbitdaDisplay } from "@/lib/adjusted-ebitda-display";
import type { IxbrlEbitdaReconciliation } from "@/lib/sec-ixbrl-mdna-tables";

function makeTable(overrides: Partial<IxbrlEbitdaReconciliation["tables"][number]> = {}) {
  return {
    caption: "Adjusted EBITDA",
    tableHtml: "<table><tr><td>EBITDA</td></tr></table>",
    textOffset: 100,
    factCount: 0,
    inMdna: false,
    ...overrides,
  };
}

describe("resolveAdjustedEbitdaDisplay", () => {
  it("returns empty when reconciliation is missing", () => {
    expect(resolveAdjustedEbitdaDisplay(undefined)).toEqual({
      source: null,
      status: "none",
      tables: [],
      sections: [],
    });
  });

  it("returns both MD&A and press release sections when present", () => {
    const ebitda: IxbrlEbitdaReconciliation = {
      status: "tables",
      tables: [
        makeTable({ inMdna: false, caption: "Press release EBITDA", textOffset: 1 }),
        makeTable({ inMdna: true, caption: "MD&A EBITDA", textOffset: 2, factCount: 3 }),
      ],
      supplementalSource: {
        form: "8-K",
        filingDate: "2024-01-31",
        accessionNumber: "0001234567-24-000001",
        primaryDocument: "ex99.htm",
        primaryDocumentUrl: "https://www.sec.gov/press",
      },
    };
    const display = resolveAdjustedEbitdaDisplay(ebitda, {
      periodicSecUrl: "https://www.sec.gov/10q",
      pressSecUrl: "https://www.sec.gov/press",
    });
    expect(display.source).toBe(null);
    expect(display.status).toBe("tables");
    expect(display.tables).toHaveLength(2);
    expect(display.sections).toHaveLength(2);
    expect(display.sections[0]?.source).toBe("mdna");
    expect(display.sections[0]?.tables[0]?.caption).toBe("MD&A EBITDA");
    expect(display.sections[1]?.source).toBe("press_release");
    expect(display.sections[1]?.tables[0]?.caption).toBe("Press release EBITDA");
  });

  it("returns press release section only when MD&A has none", () => {
    const ebitda: IxbrlEbitdaReconciliation = {
      status: "tables",
      tables: [makeTable({ inMdna: false, caption: "Non-GAAP reconciliation" })],
      supplementalSource: {
        form: "8-K",
        filingDate: "2024-01-31",
        accessionNumber: "0001234567-24-000001",
        primaryDocument: "ex99.htm",
        primaryDocumentUrl: "https://www.sec.gov/example",
      },
    };
    const display = resolveAdjustedEbitdaDisplay(ebitda);
    expect(display.source).toBe("press_release");
    expect(display.sections).toHaveLength(1);
    expect(display.sections[0]?.source).toBe("press_release");
  });

  it("passes through mention_only status when no tables", () => {
    const ebitda: IxbrlEbitdaReconciliation = {
      status: "mention_only",
      tables: [],
    };
    const display = resolveAdjustedEbitdaDisplay(ebitda);
    expect(display.source).toBe(null);
    expect(display.status).toBe("mention_only");
    expect(display.sections).toEqual([]);
  });
});
