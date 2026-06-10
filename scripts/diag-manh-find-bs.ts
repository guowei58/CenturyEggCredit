import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
} from "@/lib/sec-filing-financials";

const main = async () => {
  const res = await getAllFilingsByTickerCached("MANH");
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === "2024-03-31"
  );
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f!.accessionNumber,
    form: f!.form,
    primaryDocument: f!.primaryDocument,
    docUrl: f!.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html)!;
  const section = __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q")!;

  const needles = [
    "balance sheet",
    "total assets",
    "cash and cash equivalents",
    "CONDENSED CONSOLIDATED BALANCE",
  ];
  for (const needle of needles) {
    const re = new RegExp(needle, "gi");
    let m: RegExpExecArray | null;
    const hits: number[] = [];
    while ((m = re.exec(ctx.acc)) !== null) {
      if (m.index >= section.start && m.index < section.start + 30000) hits.push(m.index);
    }
    console.log(needle, hits.slice(0, 8));
  }

  console.log("\n--- tables 0-10 offsets ---");
  for (let ti = 0; ti <= 10; ti++) {
    const t = ctx.tables[ti];
    if (!t) continue;
    const snippet = ctx.acc.slice(t.offset, t.offset + 120).replace(/\s+/g, " ");
    console.log(`#${ti}@${t.offset}`, snippet.slice(0, 100));
  }

  const ta = ctx.acc.indexOf("Total assets", section.start);
  if (ta >= 0) {
    console.log("\n--- context around first Total assets @", ta, "---");
    console.log(ctx.acc.slice(ta - 400, ta + 800).replace(/\s+/g, " ").slice(0, 1200));
  }
};

main().catch(console.error);
