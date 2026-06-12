/**
 * Compare LUMN cash-flow line presentation: FY2023 10-K vs 2Q2023 10-Q.
 * Usage: npx tsx scripts/compare-lumn-cf-presentation.ts
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchAsPresentedStatements } from "@/lib/sec-xbrl-as-presented";

type CfRow = { label: string; concept: string; depth: number; values: Record<string, number | null> };

async function loadCf(accession: string) {
  const res = await getAllFilingsByTickerCached("LUMN");
  if (!res) throw new Error("no LUMN");
  const f = res.filings.find((x) => x.accessionNumber === accession);
  if (!f) throw new Error(`filing not found: ${accession}`);
  const payload = await fetchAsPresentedStatements({
    cik: res.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const cf = payload.statements.find((s) => s.id === "cash-flow" || s.id === "primary-cf");
  if (!cf) throw new Error(`no CF in ${accession}`);
  return { filing: f, cf };
}

function rowKey(r: { label: string; concept: string }) {
  return `${r.concept}::${r.label}`;
}

function mainPeriodKey(periods: { key: string; label: string }[], form: string) {
  if (form.includes("10-K")) {
    const fy = periods.find((p) => /year ended|twelve month/i.test(p.label) && /2023/.test(p.label));
    return fy?.key ?? periods[0]?.key;
  }
  const ytd = periods.find((p) => /six month/i.test(p.label) && /2023/.test(p.label));
  const q = periods.find((p) => /three month/i.test(p.label) && /2023/.test(p.label));
  return ytd?.key ?? q?.key ?? periods[0]?.key;
}

async function main() {
  const tenKAcc = "0000018926-24-000012"; // Feb 2024 10-K (FY2023) — adjust if wrong
  const twoQAcc = "0000018926-23-000085"; // Aug 2023 10-Q (2Q2023)

  const res = await getAllFilingsByTickerCached("LUMN");
  const k = res?.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2024-02"));
  const q = res?.filings.find((f) => f.form === "10-Q" && f.filingDate.startsWith("2023-08"));
  const kAcc = k?.accessionNumber ?? tenKAcc;
  const qAcc = q?.accessionNumber ?? twoQAcc;

  const [kData, qData] = await Promise.all([loadCf(kAcc), loadCf(qAcc)]);

  console.log("=== FILINGS ===");
  console.log("10-K:", kData.filing.filingDate, kData.filing.accessionNumber);
  console.log("10-Q:", qData.filing.filingDate, qData.filing.accessionNumber);

  console.log("\n=== PERIOD COLUMNS ===");
  console.log("10-K CF periods:");
  for (const p of kData.cf.periods) console.log(" ", p.key, "|", p.label);
  console.log("2Q23 CF periods:");
  for (const p of qData.cf.periods) console.log(" ", p.key, "|", p.label);

  const kPk = mainPeriodKey(kData.cf.periods, kData.filing.form);
  const qPk = mainPeriodKey(qData.cf.periods, qData.filing.form);
  console.log("\nPrimary compare keys:", { tenK: kPk, twoQ: qPk });

  const kRows: CfRow[] = kData.cf.rows.map((r) => ({
    label: r.label,
    concept: r.concept,
    depth: r.depth,
    values: r.values as Record<string, number | null>,
  }));
  const qRows: CfRow[] = qData.cf.rows.map((r) => ({
    label: r.label,
    concept: r.concept,
    depth: r.depth,
    values: r.values as Record<string, number | null>,
  }));

  const kMap = new Map(kRows.map((r) => [rowKey(r), r]));
  const qMap = new Map(qRows.map((r) => [rowKey(r), r]));

  const kLabels = kRows.map((r) => r.label);
  const qLabels = qRows.map((r) => r.label);

  console.log("\n=== ROW COUNT ===", { tenK: kRows.length, twoQ: qRows.length });

  console.log("\n=== LABEL ORDER (10-K only) ===");
  for (const lab of kLabels) {
    if (!qLabels.includes(lab)) console.log("  10-K only:", lab);
  }
  console.log("\n=== LABEL ORDER (10-Q only) ===");
  for (const lab of qLabels) {
    if (!kLabels.includes(lab)) console.log("  10-Q only:", lab);
  }

  console.log("\n=== SAME LABEL, DIFFERENT CONCEPT ===");
  const byLabelK = new Map<string, CfRow[]>();
  const byLabelQ = new Map<string, CfRow[]>();
  for (const r of kRows) {
    const arr = byLabelK.get(r.label) ?? [];
    arr.push(r);
    byLabelK.set(r.label, arr);
  }
  for (const r of qRows) {
    const arr = byLabelQ.get(r.label) ?? [];
    arr.push(r);
    byLabelQ.set(r.label, arr);
  }
  for (const lab of new Set([...kLabels, ...qLabels])) {
    const kc = byLabelK.get(lab)?.map((r) => r.concept) ?? [];
    const qc = byLabelQ.get(lab)?.map((r) => r.concept) ?? [];
    if (kc.length && qc.length && kc.join() !== qc.join()) {
      console.log(`  "${lab}"`);
      console.log("    10-K:", kc.join(" | "));
      console.log("    10-Q:", qc.join(" | "));
    }
  }

  console.log("\n=== IMPAIRMENT / DISPOSAL LINES (values) ===");
  const watch = /goodwill|impair|disposal|sale of business/i;
  for (const r of [...kRows, ...qRows]) {
    if (!watch.test(r.label)) continue;
    const pk = r.values === kRows.find((x) => x === r)?.values ? kPk : qPk;
    const key = kMap.has(rowKey(r)) && kRows.includes(r) ? kPk : qPk;
    const v = r.values[key ?? ""];
    const src = kRows.includes(r) ? "10-K" : "10-Q";
    console.log(`  [${src}] ${r.label}`);
    console.log(`    concept: ${r.concept}`);
    console.log(`    value @ ${key}: ${v ?? "(null)"}`);
    console.log(`    all values:`, JSON.stringify(r.values));
  }

  console.log("\n=== LABEL TEXT DRIFT (similar concepts) ===");
  const kConcepts = new Map(kRows.map((r) => [r.concept, r.label]));
  const qConcepts = new Map(qRows.map((r) => [r.concept, r.label]));
  for (const [concept, kLab] of kConcepts) {
    const qLab = qConcepts.get(concept);
    if (qLab && qLab !== kLab) {
      console.log(`  ${concept}`);
      console.log(`    10-K: ${kLab}`);
      console.log(`    10-Q: ${qLab}`);
    }
  }
  for (const [concept, qLab] of qConcepts) {
    if (!kConcepts.has(concept)) {
      console.log(`  concept only in 10-Q: ${concept} → "${qLab}"`);
    }
  }
  for (const [concept, kLab] of kConcepts) {
    if (!qConcepts.has(concept)) {
      console.log(`  concept only in 10-K: ${concept} → "${kLab}"`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
