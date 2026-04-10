import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { mapConceptToStandard } from "@/lib/xbrl-saved-history/conceptRules";
import { parseSecXbrlSavedWorkbook } from "@/lib/xbrl-saved-history/parseWorkbook";
import type { ParsedStatementTable, StatementKind } from "@/lib/xbrl-saved-history/types";

const TARGET_YEARS = 10;

type YearPack = {
  fyEnd: string;
  filingDate: string;
  meta: { accession: string; sourceFilename: string; company: string };
  tables: ParsedStatementTable[];
};

type RowAgg = {
  standardized: string;
  displayLabel: string;
  sortOrder: number;
  byFy: Map<
    string,
    { value: number | null; concept: string; line: string; file: string }
  >;
};

function canonicalFyEnd(tables: ParsedStatementTable[]): string {
  const bs = tables.find((t) => t.kind === "bs");
  if (bs?.fiscalYearEnd) return bs.fiscalYearEnd;
  const is = tables.find((t) => t.kind === "is");
  if (is?.fiscalYearEnd) return is.fiscalYearEnd;
  const cf = tables.find((t) => t.kind === "cf");
  return cf?.fiscalYearEnd ?? "";
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(r.map((c) => csvEscape(c ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

function buildStatementGrid(kind: StatementKind, yearEnds: string[], byFy: Map<string, YearPack>, log: string[]): RowAgg[] {
  const aggs = new Map<string, RowAgg>();

  for (const fyEnd of yearEnds) {
    const pack = byFy.get(fyEnd);
    if (!pack) continue;
    const tbl = pack.tables.find((t) => t.kind === kind);
    if (!tbl) {
      log.push(`No ${kind.toUpperCase()} table for FY end ${fyEnd} (${pack.meta.sourceFilename}).`);
      continue;
    }
    const file = pack.meta.sourceFilename;
    for (const row of tbl.rows) {
      if (!row.concept?.trim()) continue;
      const m = mapConceptToStandard(row.concept, kind);
      const key = m.standardized;
      let agg = aggs.get(key);
      if (!agg) {
        agg = { standardized: key, displayLabel: m.displayLabel, sortOrder: m.sortOrder, byFy: new Map() };
        aggs.set(key, agg);
      } else {
        agg.sortOrder = Math.min(agg.sortOrder, m.sortOrder);
      }
      const prev = agg.byFy.get(fyEnd);
      if (prev && prev.value !== null && row.valueMillions !== null && prev.concept !== row.concept) {
        log.push(
          `Duplicate map to ${key} for ${fyEnd}: kept ${prev.concept}, also saw ${row.concept} in ${file}`
        );
        continue;
      }
      if (!prev || prev.value === null) {
        agg.byFy.set(fyEnd, {
          value: row.valueMillions,
          concept: row.concept,
          line: row.line,
          file,
        });
      }
      if (row.line && row.line.length > agg.displayLabel.length) {
        agg.displayLabel = row.line.slice(0, 120);
      }
    }
  }

  return Array.from(aggs.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.standardized.localeCompare(b.standardized));
}

function statementToCsv(
  kind: StatementKind,
  rows: RowAgg[],
  yearEnds: string[],
  fySlotLabel: (i: number) => string
): { body: string; mappingRows: string[][] } {
  const n = yearEnds.length;
  const valCols = Array.from({ length: n }, (_, i) => fySlotLabel(i));
  const srcConceptCols = yearEnds.map((_, i) => `source_concept_${fySlotLabel(i)}`);
  const srcLabelCols = yearEnds.map((_, i) => `source_label_${fySlotLabel(i)}`);
  const srcFileCols = yearEnds.map((_, i) => `source_file_${fySlotLabel(i)}`);

  const headers = [
    "standardized_line_item",
    "display_label",
    "sort_order",
    ...valCols,
    ...srcConceptCols,
    ...srcLabelCols,
    ...srcFileCols,
    "fiscal_year_end_by_slot",
  ];

  const mappingRows: string[][] = [];
  const dataRows: string[][] = [];

  for (const r of rows) {
    const vals: string[] = [];
    const concepts: string[] = [];
    const labels: string[] = [];
    const files: string[] = [];
    for (let i = 0; i < n; i++) {
      const fy = yearEnds[i]!;
      const cell = r.byFy.get(fy);
      vals.push(cell?.value === null || cell?.value === undefined ? "" : String(cell.value));
      concepts.push(cell?.concept ?? "");
      labels.push(cell?.line ?? "");
      files.push(cell?.file ?? "");
      if (cell?.concept) {
        mappingRows.push([
          r.standardized,
          kind,
          cell.concept,
          cell.line,
          fy,
          cell.file,
          r.standardized.startsWith("unmapped__") ? "unmapped" : "rule_or_extension",
        ]);
      }
    }
    dataRows.push([
      r.standardized,
      r.displayLabel,
      String(r.sortOrder),
      ...vals,
      ...concepts,
      ...labels,
      ...files,
      yearEnds.join("|"),
    ]);
  }

  return { body: toCsv(headers, dataRows), mappingRows };
}

function runValidation(byFy: Map<string, YearPack>, yearEnds: string[], log: string[]): void {
  log.push("## Validation checks (non-blocking)");
  log.push("");
  log.push("Sign convention: values are USD **millions** exactly as stored in saved SEC-XBRL Excel exports (no sign inversion).");
  log.push("");
  for (const fy of yearEnds) {
    const pack = byFy.get(fy);
    if (!pack) continue;
    const bs = pack.tables.find((t) => t.kind === "bs");
    if (!bs) continue;
    const getVal = (std: string) => {
      for (const row of bs.rows) {
        const m = mapConceptToStandard(row.concept, "bs");
        if (m.standardized === std && row.valueMillions !== null) return row.valueMillions;
      }
      return null;
    };
    const assets = getVal("total_assets");
    const liab = getVal("total_liabilities");
    const eq = getVal("total_equity");
    if (assets !== null && liab !== null && eq !== null) {
      const diff = Math.abs(assets - (liab + eq));
      const tol = Math.max(1, Math.abs(assets) * 0.02);
      if (diff > tol) {
        log.push(`- BS ${fy}: Total assets (${assets}) vs Liab+Equity (${liab + eq}) diff ${diff.toFixed(2)}M (tolerance ~${tol.toFixed(2)}M).`);
      } else {
        log.push(`- BS ${fy}: A ≈ L+E within tolerance.`);
      }
    } else {
      log.push(`- BS ${fy}: Could not find total_assets, total_liabilities, and total_equity mapped rows for check.`);
    }
  }
  log.push("");
}

export type HistoricalModelResult = {
  ok: true;
  zipBuffer: Buffer;
  summary: {
    fiscalYearsIncluded: string[];
    filesUsed: string[];
    rowCounts: { income: number; balance: number; cashFlow: number };
    mappingRows: number;
    logLines: string[];
  };
};

export async function buildHistoricalModelZipFromSavedXbrl(userId: string, ticker: string): Promise<
  HistoricalModelResult | { ok: false; error: string }
> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };

  const docs = await prisma.userSavedDocument.findMany({
    where: { userId, ticker: sym },
    select: { filename: true, body: true, savedAtIso: true },
    orderBy: { savedAtIso: "desc" },
  });

  const xbrlDocs = docs.filter(
    (d) =>
      d.filename.toLowerCase().includes("sec-xbrl-financials") && d.filename.toLowerCase().endsWith(".xlsx")
  );

  if (!xbrlDocs.length) {
    return {
      ok: false,
      error:
        "No saved SEC-XBRL Excel workbooks found for this ticker. Save 10-K as-presented files from SEC XBRL Financials (filename contains SEC-XBRL-financials).",
    };
  }

  const log: string[] = [`# Assembly log — ${sym}`, "", "## Source files scanned", ""];
  const byFy = new Map<string, YearPack>();
  const parseNotesAll: string[] = [];

  for (const d of xbrlDocs) {
    const buf = Buffer.from(d.body);
    const parsed = parseSecXbrlSavedWorkbook(buf, d.filename);
    if (!parsed) {
      log.push(`- SKIP (unreadable xlsx): ${d.filename}`);
      continue;
    }
    parseNotesAll.push(`### ${d.filename}`, ...parsed.parseNotes.map((p) => `- ${p}`), "");
    if (!parsed.statements.length) {
      log.push(`- SKIP: ${d.filename} (${parsed.meta.form || "unknown form"})`);
      continue;
    }

    const canEnd = canonicalFyEnd(parsed.statements);
    if (!canEnd) {
      log.push(`- SKIP (no fiscal year end): ${d.filename}`);
      continue;
    }

    log.push(`- OK: ${d.filename} → FY end ${canEnd}, form ${parsed.meta.form}, filed ${parsed.meta.filingDate}`);

    const prev = byFy.get(canEnd);
    if (!prev || parsed.meta.filingDate > prev.filingDate) {
      byFy.set(canEnd, {
        fyEnd: canEnd,
        filingDate: parsed.meta.filingDate,
        meta: {
          accession: parsed.meta.accession,
          sourceFilename: d.filename,
          company: parsed.meta.company,
        },
        tables: parsed.statements,
      });
    }
  }

  const yearEnds = Array.from(byFy.keys()).sort();
  const selected = yearEnds.slice(-TARGET_YEARS);
  const shortfall = TARGET_YEARS - selected.length;

  log.push("", "## Fiscal years in model", "");
  if (shortfall > 0) {
    log.push(`Only ${selected.length} distinct fiscal year-ends found (target ${TARGET_YEARS}).`);
  }
  for (const y of selected) {
    log.push(`- ${y} ← ${byFy.get(y)?.meta.sourceFilename ?? "?"}`);
  }
  log.push("", "## Parser notes", "", ...parseNotesAll);

  if (!selected.length) {
    return { ok: false, error: "No usable 10-K SEC-XBRL workbooks with a parsed fiscal year end." };
  }

  runValidation(byFy, selected, log);

  const fySlotLabel = (i: number) => `FY${i + 1}`;

  const isGrid = buildStatementGrid("is", selected, byFy, log);
  const bsGrid = buildStatementGrid("bs", selected, byFy, log);
  const cfGrid = buildStatementGrid("cf", selected, byFy, log);

  const isOut = statementToCsv("is", isGrid, selected, fySlotLabel);
  const bsOut = statementToCsv("bs", bsGrid, selected, fySlotLabel);
  const cfOut = statementToCsv("cf", cfGrid, selected, fySlotLabel);

  const mappingHeader = [
    "standardized_line_item",
    "statement_type",
    "source_concept",
    "source_label",
    "fiscal_year_end",
    "source_file",
    "mapping_notes",
  ];
  const mappingCsv = toCsv(mappingHeader, [...isOut.mappingRows, ...bsOut.mappingRows, ...cfOut.mappingRows]);

  const summaryJson = JSON.stringify(
    {
      ticker: sym,
      fiscalYearsIncluded: selected,
      filesUsed: selected.map((y) => byFy.get(y)?.meta.sourceFilename ?? ""),
      rowCounts: { income: isGrid.length, balance: bsGrid.length, cashFlow: cfGrid.length },
      targetYears: TARGET_YEARS,
      yearsShortfall: shortfall > 0 ? shortfall : 0,
    },
    null,
    2
  );

  log.push("", "## Output", "", `- annual_income_statement.csv (${isGrid.length} rows)`);
  log.push(`- annual_balance_sheet.csv (${bsGrid.length} rows)`);
  log.push(`- annual_cash_flow.csv (${cfGrid.length} rows)`);
  log.push(`- line_item_mapping.csv`);
  log.push(`- historical_model_summary.json`);
  log.push(`- assembly_log.md`);

  const zip = new JSZip();
  zip.file("annual_income_statement.csv", isOut.body);
  zip.file("annual_balance_sheet.csv", bsOut.body);
  zip.file("annual_cash_flow.csv", cfOut.body);
  zip.file("line_item_mapping.csv", mappingCsv);
  zip.file("assembly_log.md", log.join("\n"));
  zip.file("historical_model_summary.json", summaryJson);

  const zipBuffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

  return {
    ok: true,
    zipBuffer,
    summary: {
      fiscalYearsIncluded: selected,
      filesUsed: selected.map((y) => byFy.get(y)?.meta.sourceFilename ?? "").filter(Boolean),
      rowCounts: { income: isGrid.length, balance: bsGrid.length, cashFlow: cfGrid.length },
      mappingRows: isOut.mappingRows.length + bsOut.mappingRows.length + cfOut.mappingRows.length,
      logLines: log,
    },
  };
}
