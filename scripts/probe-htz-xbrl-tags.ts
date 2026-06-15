/**
 * Compare HTZ 10-K vs 10-Q inline XBRL tag coverage in saved workbooks path.
 * Usage: npx tsx scripts/probe-htz-xbrl-tags.ts
 */
import { getAllFilingsByTicker, SEC_EDGAR_USER_AGENT } from "@/lib/sec-edgar";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import {
  fetchHtmlFilingStatementsBundle,
  parsePrimaryFilingStatementsFromHtml,
  resolveEdgarArchivesDataCikForSubmission,
} from "@/lib/sec-filing-financials";
import { primaryHtmlHasInlineIxTags } from "@/lib/sec-ixbrl-inline-cell";

function isHtmlConcept(c: string): boolean {
  return (c ?? "").trim().startsWith("html:");
}

async function probePrimaryOnly(
  cik: string,
  filing: { form: string; accessionNumber: string; primaryDocument: string }
) {
  const archiveCik = resolveEdgarArchivesDataCikForSubmission({
    issuerCik: cik,
    accessionNumber: filing.accessionNumber,
  });
  const acc = filing.accessionNumber.replace(/-/g, "");
  const cikNum = parseInt(archiveCik.replace(/\D/g, ""), 10);
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${encodeURIComponent(filing.primaryDocument)}`;
  const html = await (await fetch(sourceUrl, { headers: { "User-Agent": SEC_EDGAR_USER_AGENT } })).text();
  const statements = parsePrimaryFilingStatementsFromHtml(html, {
    form: filing.form,
    primaryDocument: filing.primaryDocument,
    sourceUrl,
  });
  return {
    statementCount: statements.length,
    inlineIxInPrimaryHtml: primaryHtmlHasInlineIxTags(html),
    statements: statements.map((s) => ({
      id: s.id,
      sourceHtmlFile: s.sourceHtmlFile,
      periods: s.periods.length,
      rows: s.rows.length,
      taggedCells: s.rows.reduce((n, r) => {
        for (const meta of Object.values(r.ixByPeriod ?? {})) {
          if (meta?.xbrlConcept) n += 1;
        }
        return n;
      }, 0),
      htmlConceptRows: s.rows.filter((r) => isHtmlConcept(r.concept)).length,
    })),
  };
}

async function probeOne(
  cik: string,
  filing: { form: string; filingDate: string; accessionNumber: string; primaryDocument: string }
) {
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik,
    accessionNumber: filing.accessionNumber,
    primaryDocument: filing.primaryDocument,
    form: filing.form,
  });
  const primaryHtml = bundle.primaryHtml ?? "";
  const hasIxGlobally = primaryHtmlHasInlineIxTags(primaryHtml);

  const stmtSources = bundle.statements.map((s) => ({
    id: s.id,
    sourceHtmlFile: s.sourceHtmlFile,
    taggedCells: s.rows.reduce((n, r) => {
      for (const meta of Object.values(r.ixByPeriod ?? {})) {
        if (meta?.xbrlConcept) n += 1;
      }
      return n;
    }, 0),
    htmlConceptRows: s.rows.filter((r) => isHtmlConcept(r.concept)).length,
    totalRows: s.rows.length,
  }));

  const payload = await fetchFacePresentedStatements({
    cik,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    filingDate: filing.filingDate,
    primaryDocument: filing.primaryDocument,
  });

  let xbrlRows = 0;
  let htmlRows = 0;
  for (const stmt of payload.statements) {
    for (const r of stmt.rows) {
      const c =
        stmt.periods.map((p) => r.cellIxByPeriod[p.key]?.xbrlConcept).find(Boolean) ?? r.concept;
      if (isHtmlConcept(c)) htmlRows += 1;
      else if (c && c.includes(":")) xbrlRows += 1;
    }
  }

  return {
    form: filing.form,
    filingDate: filing.filingDate,
    accession: filing.accessionNumber,
    primaryDocument: filing.primaryDocument,
    inlineIxInPrimaryHtml: hasIxGlobally,
    inlineIxDetected: payload.inlineIxDetected,
    stmtSources,
    extractionQa: payload.extractionQa,
    workbookConcepts: { xbrlRows, htmlRows },
  };
}

async function main() {
  const res = await getAllFilingsByTicker("HTZ");
  if (!res) throw new Error("HTZ not found");
  const k = res.filings.find((f) => f.form === "10-K");
  const q = res.filings.find((f) => f.form === "10-Q");
  if (!k || !q) throw new Error("Missing 10-K or 10-Q");

  console.log("=== Latest HTZ 10-Q (primary doc parse only) ===");
  console.log(JSON.stringify(await probePrimaryOnly(res.cik, q), null, 2));
  console.log("\n=== Latest HTZ 10-Q (after FilingSummary merge — what workbooks use) ===");
  console.log(JSON.stringify(await probeOne(res.cik, q), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
