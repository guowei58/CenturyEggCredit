/**
 * Probe NXST bulk-save workbook concept tag coverage.
 * Usage: npx tsx scripts/probe-nxst-xbrl-tags.ts
 */
import fs from "fs/promises";
import os from "os";
import path from "path";

import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { buildFacePresentedStatementsWorkbook } from "@/lib/sec-ixbrl-face-save-client";
import { workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";
import * as XLSX from "xlsx";

const TICKER = "NXST";

function isXbrlConcept(c: string): boolean {
  const s = (c ?? "").trim();
  if (!s) return false;
  if (s.startsWith("html:")) return false;
  return s.includes(":") || /^[a-z]+_[A-Z]/.test(s);
}

async function main() {
  const res = await getAllFilingsByTickerCached(TICKER);
  if (!res) throw new Error("no NXST");

  const latestK = res.filings.find((f) => f.form === "10-K");
  const latestQ = res.filings.find((f) => f.form === "10-Q");
  const targets = [latestK, latestQ].filter(Boolean) as NonNullable<typeof latestK>[];

  for (const filing of targets) {
    console.log(`\n========== ${filing.form} ${filing.filingDate} ${filing.accessionNumber} ==========`);

    const payload = await fetchFacePresentedStatements({
      cik: res.cik,
      accessionNumber: filing.accessionNumber,
      form: filing.form,
      filingDate: filing.filingDate,
      primaryDocument: filing.primaryDocument,
      docUrl: filing.docUrl,
    });

    console.log("inlineIxDetected:", payload.inlineIxDetected);
    console.log("extractionQa:");
    for (const qa of payload.extractionQa ?? []) {
      const pct = qa.numericCells ? Math.round((qa.taggedCells / qa.numericCells) * 100) : 0;
      console.log(
        `  ${qa.statementId}: rows=${qa.rowCount} numeric=${qa.numericCells} tagged=${qa.taggedCells} (${pct}%) untagged=${qa.untaggedNumericCells} confidence=${qa.confidenceScore}`
      );
    }

    for (const stmt of payload.statements) {
      let xbrlRows = 0;
      let htmlRows = 0;
      let emptyRows = 0;
      const htmlExamples: string[] = [];
      for (const r of stmt.rows) {
        const concept =
          stmt.periods.map((p) => r.cellIxByPeriod[p.key]?.xbrlConcept).find(Boolean) ?? r.concept;
        if (isXbrlConcept(concept)) xbrlRows += 1;
        else if ((concept ?? "").startsWith("html:")) {
          htmlRows += 1;
          if (htmlExamples.length < 5) htmlExamples.push(`${concept} | ${r.label}`);
        } else emptyRows += 1;
      }
      console.log(
        `\n${stmt.title}: total rows=${stmt.rows.length} xbrl-tagged=${xbrlRows} html-fallback=${htmlRows} other/empty=${emptyRows}`
      );
      if (htmlExamples.length) {
        console.log("  html-fallback examples:");
        for (const e of htmlExamples) console.log(`    ${e}`);
      }
    }

    // Build workbook and read Concept column back
    const wb = buildFacePresentedStatementsWorkbook({
      ticker: TICKER,
      cik: res.cik,
      filing,
      statements: payload.statements,
    });
    const buf = Buffer.from(workbookToXlsxUint8Array(wb));
    const parsed = XLSX.read(buf, { type: "buffer" });
    for (const sn of parsed.SheetNames.filter((n) => !/^(Meta|Validation)$/i.test(n))) {
      const sheet = parsed.Sheets[sn]!;
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as (string | number)[][];
      const header = aoa[0] ?? [];
      const conceptIdx = header.findIndex((h) => String(h).toLowerCase() === "concept");
      if (conceptIdx < 0) continue;
      let xbrl = 0;
      let html = 0;
      let blank = 0;
      const samples: string[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const c = String(aoa[i]?.[conceptIdx] ?? "").trim();
        if (!c) blank += 1;
        else if (c.startsWith("html:")) {
          html += 1;
          if (samples.length < 4) samples.push(c);
        } else if (isXbrlConcept(c)) xbrl += 1;
      }
      console.log(`\nWorkbook sheet "${sn}": xbrl=${xbrl} html=${html} blank=${blank}`);
      if (samples.length) console.log(`  sample html concepts: ${samples.join(", ")}`);
    }

    const out = path.join(os.tmpdir(), `nxst-probe-${filing.form}-${filing.filingDate}.xlsx`);
    await fs.writeFile(out, buf);
    console.log(`\nWrote probe workbook: ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
