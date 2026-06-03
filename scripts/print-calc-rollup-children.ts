/**
 * npx tsx --tsconfig tsconfig.json scripts/print-calc-rollup-children.ts
 *
 * Lists calculation-linkbase children and resolved values used for rollup validation
 * (same resolver as {@link runCalculationRollupValidations}).
 */
import { explainCalculationRollup } from "../src/lib/sec-xbrl-export-validation";
import { fetchAsPresentedValidationContext } from "../src/lib/sec-xbrl-as-presented";

const CIK = "1652044";
const ACCESSION = "0001652044-26-000048";
const FORM = "10-Q";
const FILING_DATE = "2026-04-30";
const PERIOD_KEY = "2026-01-01..2026-03-31";
const PARENT = "us-gaap:NetCashProvidedByUsedInInvestingActivities";

function fmtM(usd: number): string {
  return `${(usd / 1e6).toFixed(2)}M`;
}

async function main() {
  const { payload, exportStmts, resolveCalculationRollupValue } = await fetchAsPresentedValidationContext({
    cik: CIK,
    accessionNumber: ACCESSION,
    form: FORM,
    filingDate: FILING_DATE,
  });

  const ex = explainCalculationRollup(
    payload.calculationArcs,
    exportStmts,
    resolveCalculationRollupValue,
    PARENT,
    PERIOD_KEY
  );

  if (!ex) {
    console.error("No explanation (parent not in linkbase or no parent value for period).");
    process.exit(1);
  }

  console.log("Filing:", ACCESSION, FILING_DATE);
  console.log("Parent:", ex.parentConcept);
  console.log("Period:", ex.periodKey, `(${ex.periodLabel})`);
  console.log("Restricted to face cash-flow/IS/BS roles:", ex.restrictedToFaceRoles);
  console.log("Arc roles:", ex.arcRoles.join(" | "));
  console.log("Parent value:", fmtM(ex.parentValue));
  console.log("Σ(w×child) (same as rollup validation):", fmtM(ex.sumChildren));
  console.log("Children (calculation arc order; addend = weight × instance value):");
  for (const c of ex.children) {
    const v = c.value === null ? "null" : fmtM(c.value);
    const add = c.contributionToSum === null ? "null" : fmtM(c.contributionToSum);
    console.log(
      `  ${c.order}\tcal weight ${c.weight}\t${c.childConcept}\tvalue ${v}\taddend ${add}\t[resolved as ${c.resolvedKind}]`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
