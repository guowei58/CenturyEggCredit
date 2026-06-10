import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_parsePrimaryStatementAtTableOffset,
  __test_validateSinglePrimaryStatementShape,
} from "@/lib/sec-filing-financials";
import { locatePrimaryStatementPacket } from "@/lib/sec-statement-locator";

const main = async () => {
  const res = await getAllFilingsByTickerCached("WMT");
  const f = res?.filings.find((x) => x.form === "10-Q" && (x.reportDate ?? "").startsWith("2024-04"));
  if (!f) throw new Error("no filing");
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html)!;
  const located = locatePrimaryStatementPacket(ctx, { form: "10-Q" });
  const packets = [located.packet, ...located.packetAlternates].filter(Boolean);
  console.log("packets", packets.length);
  for (let pi = 0; pi < packets.length; pi++) {
    const pkt = packets[pi]!;
    for (const kind of ["is", "bs", "cf"] as const) {
      const block = pkt[kind];
      const ti = ctx.tables.findIndex((t) => t.offset === block.startOffset);
      const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, kind, ti, "10-Q");
      const shape = validated ? true : parsed ? __test_validateSinglePrimaryStatementShape(parsed, "10-Q") : false;
      console.log(
        `pkt${pi} ${kind} #${ti} rows=${parsed?.rows.length} periods=${parsed?.periods.length} valid=${!!validated} shape=${shape}`
      );
      if (parsed && !validated) {
        console.log("  periods:", parsed.periods.map((p) => p.label).join(" | "));
        console.log("  labels:", parsed.rows.slice(0, 8).map((r) => r.label).join(" | "));
      }
    }
  }
};
main().catch(console.error);
