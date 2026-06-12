/**
 * Compare 1Q24 cash flow: HTML face grid rows vs workbook export rows.
 * Usage: npx tsx scripts/probe-1q24-cf-vs-workbook.ts [TICKER]
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { faceStatementToWorkbookShape } from "@/lib/sec-ixbrl-face-save-client";

const ticker = (process.argv[2] ?? "LUMN").toUpperCase();

async function main() {
  const res = await getAllFilingsByTickerCached(ticker);
  if (!res) throw new Error(`no filings for ${ticker}`);

  // 1Q24 = 10-Q filed ~May 2024 with three months ended Mar 2024
  const candidates = res.filings.filter(
    (f) => f.form === "10-Q" && (f.filingDate.startsWith("2024-05") || f.filingDate.startsWith("2024-04"))
  );
  const filing =
    candidates.find((f) => f.reportDate?.startsWith("2024-03")) ??
    candidates[0] ??
    res.filings.find((f) => f.form === "10-Q" && f.filingDate.startsWith("2024"));

  if (!filing) throw new Error(`no 1Q24-ish 10-Q for ${ticker}`);

  console.log("=== FILING ===");
  console.log(`${filing.form} ${filing.filingDate} acc=${filing.accessionNumber} report=${filing.reportDate ?? "?"}`);

  const payload = await fetchFacePresentedStatements({
    cik: res.cik,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    filingDate: filing.filingDate,
    primaryDocument: filing.primaryDocument,
    docUrl: filing.docUrl,
  });

  const cf = payload.statements.find((s) => s.id === "cash-flow");
  if (!cf) throw new Error("no cash-flow statement");

  console.log("\n=== PERIODS ===");
  for (const p of cf.periods) console.log(`  ${p.key} | ${p.label} | short=${p.shortLabel ?? ""}`);

  const pk =
    cf.periods.find((p) => /three month/i.test(p.label) && /2024/.test(p.label))?.key ??
    cf.periods[0]?.key;

  console.log("\n=== FACE GRID ROWS (all) ===");
  console.log(`count=${cf.rows.length} primaryPeriod=${pk}`);
  for (let i = 0; i < cf.rows.length; i++) {
    const r = cf.rows[i]!;
    const v = pk ? r.values[pk] : null;
    const concept = cf.periods.map((p) => r.cellIxByPeriod[p.key]?.xbrlConcept).find(Boolean) ?? r.concept;
    const tagged = pk ? r.cellIxByPeriod[pk]?.xbrlConcept : null;
    console.log(
      `${String(i + 1).padStart(3)} | ${r.rowKind.padEnd(7)} | ${String(v ?? "").padStart(8)} | ${concept}`
    );
    console.log(`       ${r.label}`);
    if (r.rowKind === "heading" && v !== null) console.log("       ** heading with numeric value **");
    if (!tagged && v !== null) console.log("       ** numeric but untagged **");
  }

  const wbShape = faceStatementToWorkbookShape(cf, filing);
  console.log("\n=== WORKBOOK EXPORT ROWS ===");
  console.log(`count=${wbShape.rows.length}`);
  for (let i = 0; i < wbShape.rows.length; i++) {
    const r = wbShape.rows[i]!;
    const v = pk ? r.workbookCells?.[pk] ?? r.values[pk] : null;
    console.log(`${String(i + 1).padStart(3)} | ${String(v ?? "").padStart(8)} | ${r.concept}`);
    console.log(`       ${r.label}`);
  }

  const faceLabels = cf.rows.map((r) => r.label);
  const wbLabels = wbShape.rows.map((r) => r.label);
  const onlyFace = faceLabels.filter((l) => !wbLabels.includes(l));
  const onlyWb = wbLabels.filter((l) => !faceLabels.includes(l));

  console.log("\n=== DIFF ===");
  if (!onlyFace.length && !onlyWb.length) {
    console.log("Face grid and workbook export have identical row labels (same count).");
  } else {
    for (const l of onlyFace) console.log(`  FACE ONLY: ${l}`);
    for (const l of onlyWb) console.log(`  WORKBOOK ONLY: ${l}`);
  }

  // Rows with value in 1Q24 on face but empty in workbook cells
  console.log("\n=== VALUE MISMATCHES (face vs workbookCells) ===");
  for (const r of cf.rows) {
    if (!pk) continue;
    const faceN = r.values[pk];
    const wbRow = wbShape.rows.find((w) => w.label === r.label);
    const wbN = wbRow?.workbookCells?.[pk];
    if (faceN !== wbN && !(faceN == null && wbN === "")) {
      console.log(`  ${r.label}: face=${faceN} wb=${wbN}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
