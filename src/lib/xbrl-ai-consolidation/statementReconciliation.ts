import { parseFinancialCellValue, parseMarkdownTablesForExcel } from "@/lib/markdown-tables-to-xlsx";
import { kindFromMarkdownTitle } from "@/lib/xbrl-ai-consolidation/sourceFacts";
import type { StatementKind } from "@/lib/xbrl-saved-history/types";

/** USD millions; CF may need slack for FX / non-cash lines presented separately. */
const EPS = 1.0;

export type ReconciliationLine = {
  statement: StatementKind;
  period: string;
  check: string;
  ok: boolean;
  detail: string;
};

function padGrid(rows: string[][]): string[][] {
  const w = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => {
    const o = [...r];
    while (o.length < w) o.push("");
    return o;
  });
}

function strip(s: string): string {
  return s.replace(/\*\*/g, "").trim();
}

function findConceptCol(header: string[]): number {
  return header.findIndex((h) => /^concept$/i.test(strip(h)));
}

function valuesByConceptForColumn(grid: string[][], conceptCol: number, valueCol: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let r = 1; r < grid.length; r++) {
    const concept = strip(String(grid[r]?.[conceptCol] ?? ""));
    if (!concept) continue;
    const n = parseFinancialCellValue(String(grid[r]?.[valueCol] ?? ""));
    if (n === null) continue;
    m.set(concept, n);
  }
  return m;
}

function firstConceptMatch(vals: Map<string, number>, pattern: RegExp): number | null {
  for (const [k, v] of vals) {
    if (pattern.test(k)) return v;
  }
  return null;
}

function reconcileIsColumn(period: string, vals: Map<string, number>): ReconciliationLine[] {
  const stated =
    firstConceptMatch(vals, /:NetIncomeLoss$/i) ??
    firstConceptMatch(vals, /:ProfitLoss$/i) ??
    firstConceptMatch(vals, /NetIncomeLossAvailableToCommonStockholdersBasic/i);

  const ebt =
    firstConceptMatch(vals, /IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest$/i) ??
    firstConceptMatch(vals, /IncomeLossFromContinuingOperationsBeforeIncomeTaxes$/i);

  const tax = firstConceptMatch(vals, /:IncomeTaxExpenseBenefit$/i);

  if (stated !== null && ebt !== null && tax !== null) {
    const dPlus = Math.abs(ebt + tax - stated);
    const dMinus = Math.abs(ebt - tax - stated);
    const delta = Math.min(dPlus, dMinus);
    const calc = dPlus <= dMinus ? ebt + tax : ebt - tax;
    const form = dPlus <= dMinus ? "EBT + tax" : "EBT − tax";
    return [
      {
        statement: "is",
        period,
        check: "Net income vs EBT ± income tax (SEC-style display)",
        ok: delta <= EPS,
        detail: `${form}: ${calc.toFixed(2)} vs stated net income ${stated.toFixed(2)} (Δ ${delta.toFixed(2)}).`,
      },
    ];
  }

  return [
    {
      statement: "is",
      period,
      check: "Net income vs EBT ± income tax (SEC-style display)",
      ok: true,
      detail: "Skipped — need NetIncomeLoss (or ProfitLoss), pretax, and IncomeTaxExpenseBenefit rows with values.",
    },
  ];
}

function reconcileBsColumn(period: string, vals: Map<string, number>): ReconciliationLine[] {
  const assets = firstConceptMatch(vals, /:Assets$/i);
  const leq = firstConceptMatch(vals, /LiabilitiesAndStockholdersEquity$/i);

  if (assets !== null && leq !== null) {
    const delta = Math.abs(assets - leq);
    return [
      {
        statement: "bs",
        period,
        check: "Total assets vs liabilities + equity (single line)",
        ok: delta <= EPS,
        detail: `Assets ${assets.toFixed(2)} vs LiabilitiesAndStockholdersEquity ${leq.toFixed(2)} (Δ ${delta.toFixed(2)}).`,
      },
    ];
  }

  return [
    {
      statement: "bs",
      period,
      check: "Total assets vs liabilities + equity (single line)",
      ok: true,
      detail: "Skipped — need us-gaap:Assets and us-gaap:LiabilitiesAndStockholdersEquity with values.",
    },
  ];
}

function reconcileCfColumn(period: string, vals: Map<string, number>): ReconciliationLine[] {
  const op = firstConceptMatch(vals, /NetCashProvidedByUsedInOperatingActivities/i);
  const inv = firstConceptMatch(vals, /NetCashProvidedByUsedInInvestingActivities/i);
  const fin = firstConceptMatch(vals, /NetCashProvidedByUsedInFinancingActivities/i);
  const net =
    firstConceptMatch(vals, /CashCashEquivalentsPeriodIncreaseDecrease$/i) ??
    firstConceptMatch(vals, /CashCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect$/i) ??
    firstConceptMatch(vals, /CashAndCashEquivalentsPeriodIncreaseDecrease/i);

  if (op !== null && inv !== null && fin !== null && net !== null) {
    const calc = op + inv + fin;
    const delta = Math.abs(calc - net);
    return [
      {
        statement: "cf",
        period,
        check: "Operating + investing + financing vs net cash change",
        ok: delta <= EPS,
        detail: `Op ${op.toFixed(2)} + Inv ${inv.toFixed(2)} + Fin ${fin.toFixed(2)} = ${calc.toFixed(2)}; stated net change ${net.toFixed(2)} (Δ ${delta.toFixed(2)}).`,
      },
    ];
  }

  return [
    {
      statement: "cf",
      period,
      check: "Operating + investing + financing vs net cash change",
      ok: true,
      detail: "Skipped — need operating, investing, financing totals and period change in cash with values.",
    },
  ];
}

export function reconcileConsolidatedMarkdown(markdown: string): ReconciliationLine[] {
  const tables = parseMarkdownTablesForExcel(markdown);
  const results: ReconciliationLine[] = [];

  for (const t of tables) {
    const kind = kindFromMarkdownTitle(t.sheetTitle);
    if (!kind || (kind !== "is" && kind !== "bs" && kind !== "cf")) continue;
    const grid = padGrid(t.rows);
    if (grid.length < 2) continue;
    const header = grid[0]!.map((c) => strip(String(c)));
    const conceptCol = findConceptCol(header);
    if (conceptCol < 0) continue;
    const lineCol = header.findIndex((h) => /^line(\s+item)?$/i.test(strip(h)));
    const labelCols = new Set([conceptCol, lineCol].filter((x) => x >= 0));

    for (let c = 0; c < header.length; c++) {
      if (labelCols.has(c)) continue;
      const period = strip(String(header[c] ?? ""));
      if (!period) continue;
      const vals = valuesByConceptForColumn(grid, conceptCol, c);
      if (vals.size === 0) continue;
      if (kind === "is") results.push(...reconcileIsColumn(period, vals));
      else if (kind === "bs") results.push(...reconcileBsColumn(period, vals));
      else results.push(...reconcileCfColumn(period, vals));
    }
  }

  return results;
}

export function formatReconciliationAppendix(lines: ReconciliationLine[]): string {
  if (!lines.length) {
    return [
      "",
      "---",
      "",
      "## Automated statement reconciliation",
      "",
      "_No primary statement tables with a `Concept` column were found, or tables were empty._",
      "",
    ].join("\n");
  }

  const byStmt: Record<"is" | "bs" | "cf", ReconciliationLine[]> = { is: [], bs: [], cf: [] };
  for (const ln of lines) {
    byStmt[ln.statement].push(ln);
  }

  const parts: string[] = [
    "",
    "---",
    "",
    "## Automated statement reconciliation",
    "",
    "_These checks run on the consolidated markdown only. They do not change figures in the tables above. Threshold: ±1.00 $ millions (cash flow may diverge when FX / non-cash lines are separate)._",
    "",
  ];

  const emitBlock = (title: string, key: "is" | "bs" | "cf") => {
    const block = byStmt[key];
    if (!block.length) return;
    parts.push(`### ${title}`);
    parts.push("");
    for (const ln of block) {
      const badge = ln.ok ? "OK" : "**MISMATCH**";
      parts.push(`- (${badge}) **${ln.period}** — ${ln.check}: ${ln.detail}`);
    }
    parts.push("");
  };

  emitBlock("Income statement", "is");
  emitBlock("Balance sheet", "bs");
  emitBlock("Cash flow statement", "cf");

  return parts.join("\n");
}
