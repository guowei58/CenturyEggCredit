import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
} from "@/lib/sec-filing-financials";

const NOTES_HEADING_PATTERNS = [
  /\bnotes?\s+to\s+(?:the\s+)?consolidated\s+financial\s+statements\b/gi,
  /\bnotes?\s+to\s+financial\s+statements\b/gi,
];

const main = async () => {
  const res = await getAllFilingsByTickerCached("HUBB");
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

  const cfRe =
    /\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+statements?\s+of\s+cash\s+flows?\b/gi;
  const bsRe =
    /\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+balance\s+sheets?\b/gi;
  const isRe =
    /\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+(?:statements?\s+of\s+(?:operations|income|earnings)|income\s+statements?)\b/gi;

  const findHits = (re: RegExp) => {
    const hits: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(ctx.acc)) !== null) {
      if (m.index >= section.start && m.index < section.end) hits.push(m.index);
    }
    return hits.slice(0, 6);
  };

  console.log("section", section);
  console.log("is headings", findHits(isRe));
  console.log("bs headings", findHits(bsRe));
  console.log("cf headings", findHits(cfRe));

  const cfFirst = findHits(cfRe)[0];
  const notesSearchStart = cfFirst ?? section.start + 800;
  for (const pat of NOTES_HEADING_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(ctx.acc)) !== null) {
      if (m.index >= notesSearchStart && m.index < section.end) {
        console.log("notes hit", m.index, "context:", ctx.acc.slice(m.index, m.index + 80).replace(/\s+/g, " "));
        break;
      }
    }
  }
};

main().catch(console.error);
