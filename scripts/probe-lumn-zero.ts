import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_inferPrimaryFaceStatementKind,
  __test_statementTableMeetsMinNumbersPerPeriodColumn,
  __test_tableClassificationText,
  __test_countStatementTableNumericCellsOrTags,
  __test_flatAccFromHtml,
} from "@/lib/sec-filing-financials";

async function probeAcc(acc: string) {
  const res = await getAllFilingsByTickerCached("LUMN");
  const f = res?.filings.find((x) => x.accessionNumber === acc);
  if (!f || !res) {
    console.log("not found", acc);
    return;
  }

  console.log(`\n=== ${f.filingDate} ${f.form} ${acc} ===`);
  console.log("primaryDocument:", f.primaryDocument);
  console.log("docUrl:", f.docUrl ?? "(none)");

  let bundle;
  try {
    bundle = await fetchHtmlFilingStatementsBundle({
      cik: res.cik,
      accessionNumber: f.accessionNumber,
      form: f.form,
      primaryDocument: f.primaryDocument,
      docUrl: f.docUrl,
    });
  } catch (e) {
    console.log("fetch error:", e instanceof Error ? e.message : e);
    return;
  }

  console.log("primaryHtml length:", bundle.primaryHtml?.length ?? 0);
  console.log(
    "extracted:",
    bundle.statements.length === 0 ? "NONE" : bundle.statements.map((s) => s.id).join(", ")
  );

  const accText = __test_flatAccFromHtml(bundle.primaryHtml ?? "");
  const section = __test_findPrimaryFinancialStatementsItemSectionBounds(accText, f.form);
  if (section) {
    console.log("section start snippet:", accText.slice(section.start, section.start + 140).replace(/\s+/g, " "));
  }
  const item8Hits = [...accText.matchAll(/\bitem\s+8\b/gi)].slice(0, 6).map((m) => m.index);
  const item1Fin = [...accText.matchAll(/\bitem\s+1\b[\s\S]{0,100}?financial\s+statements/gi)]
    .slice(0, 4)
    .map((m) => ({ at: m.index, text: m[0].slice(0, 100).replace(/\s+/g, " ") }));
  console.log("item8 offsets:", item8Hits);
  console.log("item1->financialStatements:", item1Fin);

  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml ?? "");
  if (!ctx) {
    console.log("buildParsedFilingHtmlContext returned null");
    return;
  }

  console.log("total tables in doc:", ctx.tables.length);

  const section2 = __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, f.form);
  if (!section2) {
    console.log("SECTION BOUNDS: NOT FOUND");
    const accLower = ctx.acc.toLowerCase();
    console.log("text offsets:", {
      item1: accLower.indexOf("item 1"),
      item8: accLower.indexOf("item 8"),
      financialStatements: accLower.indexOf("financial statements"),
      partI: accLower.indexOf("part i"),
      partII: accLower.indexOf("part ii"),
    });
    const gated = ctx.tables
      .map((t, i) => ({
        i,
        off: t.offset,
        gate: __test_statementTableMeetsMinNumbersPerPeriodColumn(ctx.$, t),
        kind: null as string | null,
        nums: 0,
      }))
      .map((x) => {
        if (!x.gate) return x;
        return {
          ...x,
          kind: __test_inferPrimaryFaceStatementKind(ctx.$, ctx.tables[x.i]!) ?? "-",
          nums: __test_countStatementTableNumericCellsOrTags(ctx.$, ctx.tables[x.i]!),
        };
      })
      .filter((x) => x.gate && x.kind && x.kind !== "-");
    console.log("gated statement tables anywhere:", gated.slice(0, 8));
    return;
  }

  console.log("section bounds:", section2);
  const sectionTables = ctx.tables.filter((t) => t.offset >= section2.start && t.offset < section2.end);
  const scanCap = f.form.includes("10-K") ? 120 : 40;
  console.log("section tables:", sectionTables.length, `(progressive scan cap ${scanCap})`);

  for (let i = 0; i < Math.min(scanCap + 5, sectionTables.length); i++) {
    const table = sectionTables[i]!;
    const gate = __test_statementTableMeetsMinNumbersPerPeriodColumn(ctx.$, table);
    const kind = gate ? __test_inferPrimaryFaceStatementKind(ctx.$, table) : null;
    const nums = __test_countStatementTableNumericCellsOrTags(ctx.$, table);
    const text = __test_tableClassificationText(ctx.$, table).slice(0, 220).replace(/\s+/g, " ");
    console.log(`table[${i}] gate=${gate} kind=${kind ?? "-"} nums=${nums}`);
    if (i < 6 || gate || kind) console.log("  sample:", text);
  }
}

const accs = process.argv.slice(2);
if (!accs.length) {
  console.error("usage: npx tsx scripts/probe-lumn-zero.ts <acc> [acc...]");
  process.exit(1);
}

void (async () => {
  for (const acc of accs) {
    await probeAcc(acc);
  }
})();
