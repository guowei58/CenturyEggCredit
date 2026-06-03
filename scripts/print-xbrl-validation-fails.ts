/**
 * npx tsx --tsconfig tsconfig.json scripts/print-xbrl-validation-fails.ts
 */
import { fetchAsPresentedStatements } from "../src/lib/sec-xbrl-as-presented";

const CIK = "1652044";
const ACCESSION = "0001652044-26-000048";
const FORM = "10-Q";
const FILING_DATE = "2026-04-30";

async function main() {
  const payload = await fetchAsPresentedStatements({
    cik: CIK,
    accessionNumber: ACCESSION,
    form: FORM,
    filingDate: FILING_DATE,
  });
  const fails = (payload.validation ?? []).filter((v) => v.severity === "fail");
  console.log("Filing:", ACCESSION, FILING_DATE, FORM);
  console.log("calculationLinkbaseLoaded:", payload.calculationLinkbaseLoaded);
  console.log("Total validation issues:", payload.validation?.length ?? 0);
  console.log("Fails:", fails.length);
  for (const v of fails) {
    console.log("---");
    console.log(JSON.stringify(v, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
