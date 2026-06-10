import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
} from "@/lib/sec-filing-financials";

const NOTES = [
  /\bnotes\s+to\s+(?:the\s+)?(?:unaudited\s+)?(?:condensed\s+)?consolidated\s+financial\s+statements\b/gi,
];

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
  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml ?? "")!;
  const section = __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q")!;
  console.log("section", section);

  const cfRe =
    /\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+statements?\s+of\s+cash\s+flows?\b/gi;
  const cfHits: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = cfRe.exec(ctx.acc)) !== null) {
    if (m.index >= section.start && m.index < section.end) cfHits.push(m.index);
  }
  console.log("cf headings", cfHits.slice(0, 8));

  for (const start of [section.start + 800, cfHits[0] ?? -1, cfHits[1] ?? -1]) {
    if (start < 0) continue;
    for (const pat of NOTES) {
      pat.lastIndex = 0;
      while ((m = pat.exec(ctx.acc)) !== null) {
        if (m.index >= start && m.index < section.end) {
          console.log("notes@", m.index, "from", start, ctx.acc.slice(m.index, m.index + 90).replace(/\s+/g, " "));
          break;
        }
      }
    }
  }
};

main().catch(console.error);
