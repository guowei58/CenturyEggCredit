import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  parsePrimaryFilingStatementsFromHtml,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_findStatementClusterInPrimaryItemSection,
  __test_validateSinglePrimaryStatementShape,
  __test_flatAccFromHtml,
} from "@/lib/sec-filing-financials";
import { tableTextMatchesPrimaryFaceKind, tenQSectionHasFaceTrio } from "@/lib/sec-statement-locator/faceProof";
import { ITEM1_START_PATTERN, TEN_Q_MIN_SECTION_CHARS } from "@/lib/sec-statement-locator/signals";
import { locateFinancialStatementsSection } from "@/lib/sec-statement-locator/section";

const CASES = [
  { ticker: "CABO", acc: "0001437749-22-025850", label: "CABO OK 2022-Q3" },
  { ticker: "CABO", acc: "0001632127-23-000010", label: "CABO FAIL 2023-Q1" },
  { ticker: "CABO", acc: "0001632127-25-000094", label: "CABO OK 2025-Q2" },
  { ticker: "CABO", acc: "0001632127-25-000100", label: "CABO FAIL 2025-Q3" },
  { ticker: "OPTU", acc: "0001628280-19-005707", label: "OPTU OK 2019-Q1" },
  { ticker: "OPTU", acc: "0001628280-19-013363", label: "OPTU FAIL 2019-Q3" },
  { ticker: "OPTU", acc: "0001628280-23-015294", label: "OPTU FAIL 2023-Q1" },
  { ticker: "OPTU", acc: "0001702780-26-000035", label: "OPTU FAIL 2026-Q1 (new CIK)" },
];

async function diagCase(ticker: string, accSuffix: string, label: string) {
  const res = await getAllFilingsByTickerCached(ticker);
  const f = res?.filings.find((x) => x.accessionNumber.includes(accSuffix.replace(/^0+/, "").slice(0, 10)) || x.accessionNumber === accSuffix || x.accessionNumber.includes(accSuffix.split("-").slice(1).join("-")));
  // flexible match
  const filing = res?.filings.find((x) => x.form === "10-Q" && x.accessionNumber.replace(/-/g, "").includes(accSuffix.replace(/-/g, "").slice(-10)));
  if (!filing) {
    console.log(`\n=== ${label} === NOT FOUND (acc ${accSuffix})`);
    return;
  }

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    primaryDocument: filing.primaryDocument,
    docUrl: filing.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html);
  const acc = ctx?.acc ?? __test_flatAccFromHtml(html);

  console.log(`\n=== ${label} ===`);
  console.log("filing", filing.filingDate, filing.reportDate, filing.accessionNumber);
  console.log("primaryDocument", filing.primaryDocument);
  console.log("sourceUrl", bundle.primarySourceUrl?.slice(0, 120));
  console.log("html bytes", html.length, "acc len", acc.length, "tables", ctx?.tables.length ?? 0);

  const patterns = ["PART I", "ITEM 1", "Financial Statements", "statements of operations", "balance sheet", "cash flows", "incorporated by reference", "cross reference", "table of contents"];
  for (const p of patterns) {
    const idx = acc.toLowerCase().indexOf(p.toLowerCase());
    if (idx >= 0) console.log(`  anchor "${p}" @${idx}:`, acc.slice(idx, idx + 100).replace(/\s+/g, " "));
  }

  const item1Re = new RegExp(ITEM1_START_PATTERN.source, "gi");
  const item1Hits: number[] = [];
  for (let m = item1Re.exec(acc); m; m = item1Re.exec(acc)) item1Hits.push(m.index);
  console.log("item1 pattern hits", item1Hits.length, item1Hits.slice(0, 5));

  if (ctx) {
    for (const start of item1Hits.slice(0, 3)) {
      const len = acc.length - start;
      const trio = tenQSectionHasFaceTrio(ctx.$, ctx.tables, start, Math.min(acc.length, start + 42_000));
      console.log(`  item1@${start} sectionLen=${len} minOk=${len >= TEN_Q_MIN_SECTION_CHARS} trio=${trio}`);
    }

    const section = locateFinancialStatementsSection(ctx, "10-Q");
    console.log("locateFinancialStatementsSection", section?.strategy ?? null, section?.section);

    const legacySection = __test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-Q");
    console.log("legacy Item1 bounds", legacySection);

    const cluster = ctx ? __test_findStatementClusterInPrimaryItemSection(ctx, "10-Q") : null;
    console.log(
      "legacy cluster",
      cluster
        ? {
            score: cluster.cluster.score,
            span: cluster.cluster.end - cluster.cluster.start,
            isOff: cluster.cluster.is.table.offset,
            bsOff: cluster.cluster.bs.table.offset,
            cfOff: cluster.cluster.cf.table.offset,
          }
        : null
    );

    const stmts = parsePrimaryFilingStatementsFromHtml(html, {
      form: "10-Q",
      primaryDocument: filing.primaryDocument,
      sourceUrl: bundle.primarySourceUrl,
    });
    console.log(
      "parsed",
      stmts.length,
      stmts.map((s) => `${s.id}(${s.rows.length}r)`).join(", ") || "none"
    );
    for (const id of ["income-statement", "balance-sheet", "cash-flow"] as const) {
      const stmt = stmts.find((s) => s.id === id);
      if (stmt) {
        console.log(`  shape ${id}`, __test_validateSinglePrimaryStatementShape(stmt, "10-Q"));
        console.log(`  top rows ${id}`, stmt.rows.slice(0, 6).map((r) => r.label).join(" | "));
      }
    }

    // TOC false-positive check on first item1 hit
    if (item1Hits[0] != null) {
      const s = item1Hits[0];
      const early = acc.slice(s, s + 1200);
      const itemCount = (early.match(/\bitem\s+\d+[a-z]?\b/gi) ?? []).length;
      const nextItem = item1Hits[1] ?? acc.length;
      const preview = acc.slice(s, Math.min(nextItem, s + 15_000));
      const hasTocPhrase = /\b(table\s+of\s+contents)\b/i.test(early);
      console.log("toc check first item1", { itemCount, hasTocPhrase, previewLen: preview.length });
    }

    // Face-kind tables in first 80k
    let faceCounts = { is: 0, bs: 0, cf: 0 };
    for (const t of ctx.tables.filter((t) => t.offset < 120_000)) {
      const parts: string[] = [];
      for (const tr of ctx.$(t.el).find("tr").toArray().slice(0, 8)) {
        for (const cell of ctx.$(tr).find("th,td").toArray()) {
          const tx = ctx.$(cell).text().trim();
          if (tx) parts.push(tx);
        }
      }
      const text = parts.join(" ").toLowerCase();
      for (const kind of ["is", "bs", "cf"] as const) {
        if (tableTextMatchesPrimaryFaceKind(kind, text)) faceCounts[kind] += 1;
      }
    }
    console.log("face tables in first 120k", faceCounts);

    // Sample first 8 tables
    for (const t of ctx.tables.slice(0, 8)) {
      const parts: string[] = [];
      for (const tr of ctx.$(t.el).find("tr").toArray().slice(0, 4)) {
        for (const cell of ctx.$(tr).find("th,td").toArray()) {
          const tx = ctx.$(cell).text().trim();
          if (tx) parts.push(tx);
        }
      }
      console.log(`  table@${t.offset}`, parts.join(" | ").slice(0, 100));
    }
  }
}

async function main() {
  for (const c of CASES) {
    await diagCase(c.ticker, c.acc, c.label);
  }
}

main().catch(console.error);
