import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchHtmlFilingStatementsBundle, __test_flatAccFromHtml } from "@/lib/sec-filing-financials";

async function inspect(ticker: string, acc: string) {
  const res = await getAllFilingsByTickerCached(ticker);
  const f = res!.filings.find((x) => x.accessionNumber === acc)!;
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const accText = __test_flatAccFromHtml(bundle.primaryHtml ?? "");
  console.log(`\n${ticker} ${f.form} ${f.filingDate} ${acc} doc=${f.primaryDocument}`);
  console.log("htmlKB", ((bundle.primaryHtml?.length ?? 0) / 1024).toFixed(0));

  const patterns = [
    "ITEM 8",
    "ITEM 8.",
    "FINANCIAL STATEMENTS",
    "incorporated by reference",
    "annual report",
    "INDEX TO CONSOLIDATED",
    "Consolidated Balance Sheets",
    "Consolidated Statements of Operations",
  ];
  for (const p of patterns) {
    const idx = accText.toLowerCase().indexOf(p.toLowerCase());
    console.log(`  ${p}: ${idx >= 0 ? `found@${idx}` : "MISSING"}`);
  }

  const item8Re = /\bitem\s*8\b/gi;
  let m: RegExpExecArray | null;
  const hits: number[] = [];
  while ((m = item8Re.exec(accText)) !== null) hits.push(m.index);
  console.log("  item8 hits:", hits.slice(0, 8));

  if (hits[0] != null) {
    console.log("  preview:", JSON.stringify(accText.slice(hits[0], hits[0] + 200)));
  }
}

void inspect(process.argv[2]!.toUpperCase(), process.argv[3]!);
