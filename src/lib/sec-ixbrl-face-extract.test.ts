import { describe, expect, it } from "vitest";

import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { getAllFilingsByTicker } from "@/lib/sec-edgar";

describe("fetchFacePresentedStatements ix coverage", () => {
  it(
    "FICO 2026 Q1 tags essentially all numeric cells on primary statements (inline XBRL HTML)",
    async () => {
      const res = await getAllFilingsByTicker("FICO");
      expect(res).not.toBeNull();
      const f =
        res!.filings.find((x) => x.accessionNumber === "0000814547-26-000021") ??
        res!.filings.find((x) => x.form === "10-Q");
      expect(f).toBeDefined();

      const payload = await fetchFacePresentedStatements({
        cik: res!.cik,
        accessionNumber: f!.accessionNumber,
        form: f!.form,
        filingDate: f!.filingDate,
        primaryDocument: f!.primaryDocument,
        docUrl: f!.docUrl,
      });

      for (const stmt of payload.statements) {
        const qa = payload.extractionQa.find((q) => q.statementId === stmt.id);
        expect(qa).toBeDefined();
        expect(qa!.numericCells).toBeGreaterThan(0);
        expect(qa!.taggedCells / qa!.numericCells).toBeGreaterThan(0.85);
      }
    },
    120_000
  );
});
