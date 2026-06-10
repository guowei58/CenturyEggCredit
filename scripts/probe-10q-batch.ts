import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import { fetchHtmlFilingStatementsBundle, parsePrimaryFilingStatementsFromHtml } from "@/lib/sec-filing-financials";
import { locatePrimaryStatementPacket, locateFinancialStatementsSection } from "@/lib/sec-statement-locator";
import { buildParsedFilingHtmlContext } from "@/lib/sec-filing-financials";
import { sortPresentedFilingsNewestFirst } from "@/lib/sec-xbrl-as-presented-save-client";

const TICKERS = ["NVDA", "CHTR", "GE", "MAGN", "GEN", "FICO"];

async function probeTicker(ticker: string) {
  const r = await getAllFilingsByTicker(ticker);
  if (!r) return { ticker, error: "no company" };
  const f = sortPresentedFilingsNewestFirst(r.filings.filter((x) => x.form === "10-Q"))[0];
  if (!f) return { ticker, error: "no 10-Q" };

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: r.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml ?? "");
  if (!ctx) return { ticker, filingDate: f.filingDate, error: "no ctx" };

  const section = locateFinancialStatementsSection(ctx, "10-Q");
  const located = locatePrimaryStatementPacket(ctx, { form: "10-Q" });
  const stmts = parsePrimaryFilingStatementsFromHtml(bundle.primaryHtml ?? "", {
    form: f.form,
    primaryDocument: f.primaryDocument,
    sourceUrl: bundle.primarySourceUrl,
  });

  return {
    ticker,
    filingDate: f.filingDate,
    accession: f.accessionNumber,
    section: section?.strategy ?? null,
    blocksBuilt: located.audit.blocksBuilt,
    packet: located.packet ? "yes" : "no",
    alternates: located.packetAlternates.length,
    parsed: stmts.map((s) => s.id).join(",") || "none",
    ok: stmts.length === 3,
  };
}

async function main() {
  for (const ticker of TICKERS) {
    try {
      const row = await probeTicker(ticker);
      console.log(JSON.stringify(row));
    } catch (e) {
      console.log(JSON.stringify({ ticker, error: String(e) }));
    }
  }
}

main().catch(console.error);
