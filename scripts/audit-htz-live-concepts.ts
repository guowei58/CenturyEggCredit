/**
 * Latest truth: fetch HTZ 10-Q from SEC now (same path as Step 1 bulk save)
 * and count Concept tags that would be written to workbook.
 *
 * Usage: npx tsx scripts/audit-htz-live-concepts.ts
 */
import fs from "fs/promises";
import path from "path";
import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { faceStatementToWorkbookShape } from "@/lib/sec-ixbrl-face-save-client";

const STALE_BATCH = path.resolve(
  process.cwd(),
  "scripts/.audit-truth-batch/work/HTZ/in"
);

function bucket(concept: string): string {
  if (concept.startsWith("us-gaap:")) return "us-gaap";
  if (concept.startsWith("html:")) return "html";
  if (concept.startsWith("htz:") || concept.startsWith("htzz:")) return "htz/htzz";
  if (concept.includes(":")) return "other-xbrl";
  return "other";
}

function auditConcepts(rows: { concept: string; label: string }[]) {
  const mix: Record<string, number> = {};
  const samples: Record<string, string[]> = {};
  for (const r of rows) {
    const b = bucket(r.concept);
    mix[b] = (mix[b] ?? 0) + 1;
    samples[b] ??= [];
    if (samples[b]!.length < 3) samples[b]!.push(`${r.concept} (${r.label.slice(0, 40)})`);
  }
  return { mix, samples };
}

async function auditStaleFile(filename: string) {
  const fp = path.join(STALE_BATCH, filename);
  try {
    const buf = await fs.readFile(fp);
    const { default: XLSX } = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const rows: { concept: string; label: string }[] = [];
    for (const sn of wb.SheetNames) {
      if (!/income|balance|cash/i.test(sn)) continue;
      const sheet = wb.Sheets[sn];
      if (!sheet) continue;
      const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
        header: 1,
        defval: "",
      }) as (string | number | null)[][];
      const hdr = aoa[0] ?? [];
      const ci = hdr.findIndex((h) => String(h).trim().toLowerCase() === "concept");
      const li = hdr.findIndex((h) => String(h).trim().toLowerCase() === "line");
      if (ci < 0) continue;
      for (const row of aoa.slice(1)) {
        const c = String(row[ci] ?? "").trim();
        if (!c) continue;
        rows.push({ concept: c, label: String(row[li] ?? "") });
      }
    }
    return auditConcepts(rows);
  } catch {
    return null;
  }
}

async function main() {
  const res = await getAllFilingsByTicker("HTZ");
  if (!res) throw new Error("HTZ not found");

  const qs = res.filings
    .filter((f) => f.form === "10-Q")
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate))
    .slice(0, 5);

  console.log("=== LIVE fetch (current code → what Step 1 would save today) ===\n");

  for (const f of qs) {
    const payload = await fetchFacePresentedStatements({
      cik: res.cik,
      accessionNumber: f.accessionNumber,
      form: f.form,
      filingDate: f.filingDate,
      primaryDocument: f.primaryDocument,
    });

    const wbRows: { concept: string; label: string }[] = [];
    for (const stmt of payload.statements) {
      const shaped = faceStatementToWorkbookShape(stmt, f);
      for (const r of shaped.rows) {
        wbRows.push({ concept: r.concept, label: r.label });
      }
    }
    const live = auditConcepts(wbRows);
    const staleName = `HTZ_SEC-XBRL-financials_as-presented_10-Q_${f.filingDate}_${f.accessionNumber.replace(/-/g, "")}.xlsx`.replace(
      /0001657853(\d+)/,
      "0001657853-$1"
    );
    // accession in filename uses hyphens: 0001657853-24-000136
    const staleFn = `HTZ_SEC-XBRL-financials_as-presented_10-Q_${f.filingDate}_${f.accessionNumber}.xlsx`;
    const stale = await auditStaleFile(staleFn);

    console.log(`--- ${f.form} ${f.filingDate} ${f.accessionNumber} ---`);
    console.log(`  inlineIxDetected: ${payload.inlineIxDetected}`);
    for (const qa of payload.extractionQa ?? []) {
      console.log(
        `  QA ${qa.statementId}: taggedCells=${qa.taggedCells}/${qa.numericCells} untagged=${qa.untaggedNumericCells} score=${qa.confidenceScore}`
      );
    }
    console.log(`  LIVE workbook concepts:`, live.mix);
    if (live.samples["us-gaap"]?.length) console.log(`    us-gaap sample:`, live.samples["us-gaap"][0]);
    if (live.samples["htz/htzz"]?.length) console.log(`    htz sample:`, live.samples["htz/htzz"][0]);
    if (live.samples["html"]?.length) console.log(`    html sample:`, live.samples["html"][0]);
    if (stale) {
      console.log(`  STALE batch file (${staleFn}):`, stale.mix);
    } else {
      console.log(`  STALE batch file: not found`);
    }
    console.log();
  }

  // Spot-check 3Q24 Revenues row specifically
  const q324 = res.filings.find((f) => f.accessionNumber === "0001657853-24-000136");
  if (q324) {
    const payload = await fetchFacePresentedStatements({
      cik: res.cik,
      accessionNumber: q324.accessionNumber,
      form: q324.form,
      filingDate: q324.filingDate,
      primaryDocument: q324.primaryDocument,
    });
    const is = payload.statements.find((s) => s.id === "income-statement");
    const rev = is?.rows.find((r) => /revenue/i.test(r.label) && !/earning/i.test(r.label));
    const shaped = is
      ? faceStatementToWorkbookShape(is, q324).rows.find((r) => /revenue/i.test(r.label) && !/earning/i.test(r.label))
      : null;
    console.log("=== 3Q24 Revenues row (matches your screenshot values) ===");
    console.log("  label:", rev?.label);
    console.log("  LIVE concept written to workbook:", shaped?.concept);
    console.log("  values:", rev?.values);
    const stale = await auditStaleFile(
      `HTZ_SEC-XBRL-financials_as-presented_10-Q_${q324.filingDate}_${q324.accessionNumber}.xlsx`
    );
    console.log("  STALE batch was html-only:", stale?.mix.html && !stale?.mix["us-gaap"]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
