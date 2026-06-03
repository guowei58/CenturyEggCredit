import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_inferPrimaryFaceStatementKind,
  __test_statementTableMeetsMinNumbersPerPeriodColumn,
  __test_tableClassificationText,
  __test_countStatementTableNumericCellsOrTags,
} from "@/lib/sec-filing-financials";
import { validateStatementShape } from "@/lib/sec-filing-financials-diagnostics";

async function probeAcc(acc: string) {
  const res = await getAllFilingsByTickerCached("LUMN");
  const f = res?.filings.find((x) => x.accessionNumber === acc);
  if (!f || !res) {
    console.log("not found", acc);
    return;
  }

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });

  console.log(`\n=== ${f.filingDate} ${f.form} ${acc} ===`);
  console.log(
    "extracted:",
    bundle.statements.map((s) => ({
      id: s.id,
      rows: s.rows.length,
      firstRows: s.rows.slice(0, 6).map((r) => r.label),
    }))
  );

  for (const s of bundle.statements) {
    const issues = validateStatementShape(s, f.form);
    if (issues.length) console.log("shape issues", s.id, issues);
  }

  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml!);
  if (!ctx) return;

  const section = __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, f.form);
  const sectionTables = ctx.tables.filter((t) => section && t.offset >= section.start && t.offset < section.end);
  console.log("section tables total:", sectionTables.length, "(10-Q scan cap: first 7)");

  for (let i = 0; i < Math.min(12, sectionTables.length); i++) {
    const table = sectionTables[i]!;
    const gate = __test_statementTableMeetsMinNumbersPerPeriodColumn(ctx.$, table);
    const kind = gate ? __test_inferPrimaryFaceStatementKind(ctx.$, table) : null;
    const text = __test_tableClassificationText(ctx.$, table).toLowerCase();
    const cfHints =
      /\boperating activities\b/.test(text) ||
      /\binvesting activities\b/.test(text) ||
      /\bfinancing activities\b/.test(text) ||
      /\bcash flows?\b/.test(text);

    if (i < 8 || gate || kind || cfHints) {
      const totalNums = __test_countStatementTableNumericCellsOrTags(ctx.$, table);
      console.log(`table[${i}] gate=${gate} kind=${kind ?? "-"} cfHints=${cfHints} totalNumericCells=${totalNums}`);
      if (kind === "cf" || cfHints || i < 4) {
        console.log("  sample:", __test_tableClassificationText(ctx.$, table).slice(0, 300).replace(/\s+/g, " "));
      }
    }
  }
}

const acc = process.argv[2]?.trim();
if (!acc) {
  console.error("usage: npx tsx scripts/probe-lumn-cf.ts <accession>");
  process.exit(1);
}

void probeAcc(acc);
