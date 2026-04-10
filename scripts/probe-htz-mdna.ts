import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import { fetchIxbrlMdnaTablesFromFiling } from "@/lib/sec-ixbrl-mdna-tables";

async function main() {
  const r = await getAllFilingsByTicker("HTZ");
  if (!r) {
    console.log("no filings");
    process.exit(1);
  }
  const filings = r.filings.filter((f) => f.form === "10-K" || f.form === "10-Q").slice(0, 600);
  const chosen = filings.find((f) => f.form === "10-K") ?? filings[0];
  console.log("chosen", chosen?.accessionNumber, chosen?.form);
  const ex = await fetchIxbrlMdnaTablesFromFiling({
    cik: r.cik,
    accessionNumber: chosen!.accessionNumber,
    primaryDocument: chosen!.primaryDocument,
    form: chosen!.form,
  });
  if (!ex.ok) {
    console.log("error", ex.error);
    return;
  }
  console.log(
    "mdnaHeadingFound",
    ex.mdnaHeadingFound,
    "segmentHeadingFound",
    ex.segmentHeadingFound,
    "mdnaTableHit",
    ex.mdnaTableHit,
    "n",
    ex.tables.length
  );
  ex.tables.slice(0, 8).forEach((t) => console.log(t.section, t.factCount, (t.caption ?? "").slice(0, 80)));
}

void main();
