/**
 * Materialize LUMN 10-K/10-Q workbooks since 2019 into argv[1] for Python trace.
 * Usage: npx tsx scripts/_materialize_lumn_for_trace.ts <outDir>
 */
import fs from "fs/promises";
import path from "path";

import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { buildFacePresentedStatementsWorkbook } from "@/lib/sec-ixbrl-face-save-client";
import { workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: npx tsx scripts/_materialize_lumn_for_trace.ts <outDir>");
  process.exit(1);
}

function wbFilename(f: { form: string; filingDate: string; accessionNumber: string }) {
  const acc = f.accessionNumber.replace(/[^\w-]+/g, "_");
  return `LUMN_SEC-XBRL-financials_as-presented_${f.form}_${f.filingDate}_${acc}.xlsx`;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const res = await getAllFilingsByTickerCached("LUMN");
  if (!res) throw new Error("no LUMN");

  const pick = res.filings.filter(
    (f) =>
      (f.form === "10-K" || f.form === "10-Q") &&
      f.filingDate >= "2019-01-01" &&
      f.filingDate <= "2026-06-01"
  );

  console.error(`materializing ${pick.length} filings to ${outDir}`);
  for (const filing of pick) {
    const fn = wbFilename(filing);
    const dest = path.join(outDir, fn);
    try {
      await fs.access(dest);
      continue;
    } catch {
      /* build */
    }
    const payload = await fetchFacePresentedStatements({
      cik: res.cik,
      accessionNumber: filing.accessionNumber,
      form: filing.form,
      filingDate: filing.filingDate,
      primaryDocument: filing.primaryDocument,
      docUrl: filing.docUrl,
    });
    const wb = buildFacePresentedStatementsWorkbook({
      ticker: "LUMN",
      cik: res.cik,
      filing,
      statements: payload.statements,
    });
    await fs.writeFile(dest, Buffer.from(workbookToXlsxUint8Array(wb)));
    console.error(`  wrote ${fn}`);
  }
  console.error("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
