import fs from "fs/promises";
import path from "path";
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { buildFacePresentedStatementsWorkbook } from "@/lib/sec-ixbrl-face-save-client";
import { workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";

const out = process.argv[2];
if (!out) throw new Error("usage: tsx _build_lumn_fy22_wb_only.ts <out.xlsx>");

const res = await getAllFilingsByTickerCached("LUMN");
const f = res!.filings.find((x) => x.form === "10-K" && x.filingDate.startsWith("2023-02"));
if (!f) throw new Error("no FY22 10-K");

const payload = await fetchFacePresentedStatements({
  cik: res!.cik,
  accessionNumber: f.accessionNumber,
  form: f.form,
  filingDate: f.filingDate,
  primaryDocument: f.primaryDocument,
  docUrl: f.docUrl,
});

const wb = buildFacePresentedStatementsWorkbook({
  ticker: "LUMN",
  cik: res!.cik,
  filing: f,
  statements: payload.statements,
});

await fs.writeFile(path.resolve(out), Buffer.from(workbookToXlsxUint8Array(wb)));
console.error("wrote", out);
