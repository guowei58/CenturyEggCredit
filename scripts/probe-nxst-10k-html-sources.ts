/** NXST 10-K: which HTML files have ix tags and what tables were picked. */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";
import { primaryHtmlHasInlineIxTags, listInlineIxOnRow } from "@/lib/sec-ixbrl-inline-cell";
import * as cheerio from "cheerio";

async function main() {
  const res = await getAllFilingsByTickerCached("NXST");
  const k = res!.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2026-02"))!;

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: k.accessionNumber,
    form: k.form,
    primaryDocument: k.primaryDocument,
    docUrl: k.docUrl,
  });

  console.log("Statements picked:");
  for (const s of bundle.statements) {
    console.log(`  ${s.id}: file=${s.sourceHtmlFile} rows=${s.rows.length} title=${s.title}`);
    console.log(`    row0=${s.rows[0]?.label} concept=${s.rows[0]?.concept}`);
    const tagged = s.rows.filter((r) =>
      Object.values(r.ixByPeriod ?? {}).some((m) => m?.xbrlConcept)
    ).length;
    console.log(`    rows with any ix tag: ${tagged}/${s.rows.length}`);
  }

  console.log("\nHTML files in bundle:");
  for (const [name, html] of Object.entries(bundle.htmlByFile ?? {})) {
    const hasIx = primaryHtmlHasInlineIxTags(html);
    const $ = cheerio.load(html);
    const ixCount = $("[name]").filter((_, el) => {
      const n = $(el).attr("name") ?? "";
      return n.includes(":") && /nonfraction|nonnumeric/i.test(el.tagName ?? "");
    }).length;
    const nonFrac = $("ix\\:nonFraction, nonFraction").length;
    console.log(`  ${name}: hasInlineIx=${hasIx} ixNonFraction=${nonFrac}`);
  }

  // Sample first data table in primary doc
  const primary = bundle.primaryHtml ?? "";
  const $p = cheerio.load(primary);
  const tables = $p("table").toArray();
  console.log(`\nPrimary doc tables: ${tables.length}`);
  for (let i = 0; i < Math.min(8, tables.length); i++) {
    const tr = $p(tables[i]).find("tr").toArray().find((t) => $p(t).find("ix\\:nonFraction, nonFraction").length);
    const ixInTable = $p(tables[i]).find("ix\\:nonFraction, nonFraction").length;
    const firstLabel = $p(tables[i]).find("tr").first().text().replace(/\s+/g, " ").trim().slice(0, 80);
    console.log(`  table[${i}]: ixTags=${ixInTable} sampleLabel="${firstLabel}"`);
  }
}

main().catch(console.error);
