import { prisma } from "@/lib/prisma";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { parseFinancialCellValue, parseMarkdownTablesForExcel } from "@/lib/markdown-tables-to-xlsx";
import { parseSecXbrlSavedWorkbookFullPeriods } from "@/lib/xbrl-saved-history/parseWorkbook";
import type { ParsedSavedWorkbookFull, StatementKind } from "@/lib/xbrl-saved-history/types";

const EPS = 0.02;

export type SourceFact = {
  kind: StatementKind;
  concept: string;
  line: string;
  periodLabel: string;
  value: number;
  filingDate: string;
  form: string;
  accession: string;
  filename: string;
};

export type ConsolidationValidation = {
  ok: boolean;
  mergedFactCount: number;
  numericChecks: number;
  mismatches: string[];
  conceptsMissingFromMarkdown: string[];
  unmatchedPeriodsSample: string[];
};

function normalizeLabel(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .toLowerCase()
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function periodKeysCompatible(sourcePeriod: string, mdHeader: string): boolean {
  const a = sourcePeriod.trim();
  const b = mdHeader.trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return true;

  const rangeEnd = a.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|→|->)\s*(\d{4}-\d{2}-\d{2})/i);
  const endIso = rangeEnd ? rangeEnd[2]! : /^(\d{4}-\d{2}-\d{2})$/.test(a.trim()) ? a.trim() : null;

  if (endIso) {
    const q = bl.match(/\b(?:q([1-4])|([1-4])q)\s*'?(\d{2}|\d{4})\b/i);
    if (q) {
      const quarter = parseInt(q[1] || q[2] || "0", 10);
      let y = parseInt(q[3]!, 10);
      if (y < 100) y += 2000;
      const month = quarter === 1 ? 3 : quarter === 2 ? 6 : quarter === 3 ? 9 : 12;
      const day = month === 3 ? 31 : month === 6 ? 30 : month === 9 ? 30 : 31;
      const guess = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (guess === endIso) return true;
    }
    if (bl.includes(endIso)) return true;
  }

  return false;
}

export function kindFromMarkdownTitle(title: string): StatementKind | null {
  const t = title.toLowerCase();
  if (t.includes("cash flow") || t.includes("cashflow")) return "cf";
  if (t.includes("balance") || t.includes("financial position")) return "bs";
  if (
    t.includes("income") ||
    t.includes("operations") ||
    t.includes("earnings") ||
    t.includes("p&l") ||
    t.includes("profit and loss")
  ) {
    return "is";
  }
  return null;
}

function flattenWorkbooksToFacts(workbooks: ParsedSavedWorkbookFull[]): {
  allFacts: SourceFact[];
  conceptToLines: Map<string, Set<string>>;
} {
  const allFacts: SourceFact[] = [];
  const conceptToLines = new Map<string, Set<string>>();

  for (const parsed of workbooks) {
    const { meta } = parsed;
    for (const st of parsed.statements) {
      for (const row of st.rows) {
        if (!row.concept) continue;
        const ck = `${st.kind}\t${row.concept}`;
        let set = conceptToLines.get(ck);
        if (!set) {
          set = new Set<string>();
          conceptToLines.set(ck, set);
        }
        if (row.line) set.add(normalizeLabel(row.line));

        for (const [periodLabel, val] of Object.entries(row.valuesByPeriod)) {
          if (val === null || typeof val !== "number" || !Number.isFinite(val)) continue;
          allFacts.push({
            kind: st.kind,
            concept: row.concept,
            line: row.line,
            periodLabel,
            value: val,
            filingDate: meta.filingDate,
            form: meta.form,
            accession: meta.accession,
            filename: meta.sourceFilename,
          });
        }
      }
    }
  }

  return { allFacts, conceptToLines };
}

/** Latest filing wins: `facts` must be ordered newest workbook first. */
export function mergeLatestFilingWins(facts: SourceFact[]): SourceFact[] {
  const seen = new Set<string>();
  const out: SourceFact[] = [];
  for (const f of facts) {
    const key = `${f.kind}\t${f.concept}\t${f.periodLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export async function buildMergedFactsAndLineIndex(
  userId: string,
  ticker: string
): Promise<{ merged: SourceFact[]; conceptToLines: Map<string, Set<string>> } | null> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return null;

  const docs = await prisma.userSavedDocument.findMany({
    where: { userId, ticker: sym },
    select: { filename: true, body: true, savedAtIso: true },
    orderBy: { savedAtIso: "desc" },
  });

  const xbrlDocs = docs.filter(
    (d) => d.filename.toLowerCase().includes("sec-xbrl-financials") && d.filename.toLowerCase().endsWith(".xlsx")
  );

  const withMeta = xbrlDocs.map((d) => {
    const p = parseSecXbrlSavedWorkbookFullPeriods(Buffer.from(d.body), d.filename, { requireForm10K: false });
    return {
      d,
      p,
      filingDate: p?.meta.filingDate ?? "",
      savedAt: d.savedAtIso,
    };
  });

  withMeta.sort((a, b) => {
    if (a.filingDate !== b.filingDate) return b.filingDate.localeCompare(a.filingDate);
    return b.savedAt.localeCompare(a.savedAt);
  });

  const parsedList: ParsedSavedWorkbookFull[] = [];
  for (const x of withMeta) {
    if (x.p) parsedList.push(x.p);
  }

  if (!parsedList.length) return null;

  const { allFacts, conceptToLines } = flattenWorkbooksToFacts(parsedList);
  return { merged: mergeLatestFilingWins(allFacts), conceptToLines };
}

export function validateConsolidatedMarkdownAgainstXbrl(
  markdown: string,
  merged: SourceFact[],
  conceptToLines: Map<string, Set<string>>
): ConsolidationValidation {
  const mismatches: string[] = [];
  const conceptsMissingFromMarkdown: string[] = [];
  const unmatchedPeriods = new Set<string>();

  const tables = parseMarkdownTablesForExcel(markdown);
  const mdByKind = new Map<StatementKind, string[][]>();
  for (const t of tables) {
    const k = kindFromMarkdownTitle(t.sheetTitle);
    if (!k) continue;
    if (!t.rows.length) continue;
    mdByKind.set(k, t.rows);
  }

  for (const ck of Array.from(conceptToLines.keys())) {
    const lines = conceptToLines.get(ck);
    if (!lines?.size) continue;
    const kind = ck.split("\t")[0] as StatementKind;
    const grid = mdByKind.get(kind);
    if (!grid?.length) {
      conceptsMissingFromMarkdown.push(`${ck} (no matching ${kind.toUpperCase()} section/table)`);
      continue;
    }
    const mdLabels = grid.slice(1).map((row) => normalizeLabel(String(row[0] ?? "")));
    const any = Array.from(lines).some(
      (ln) =>
        ln &&
        mdLabels.some((m) => m && (m === ln || m.includes(ln) || ln.includes(m)))
    );
    if (!any) conceptsMissingFromMarkdown.push(ck);
  }

  let numericChecks = 0;

  for (const fact of merged) {
    const grid = mdByKind.get(fact.kind);
    if (!grid || grid.length < 2) {
      unmatchedPeriods.add(fact.periodLabel);
      continue;
    }

    const header = grid[0] ?? [];
    let colIdx = -1;
    for (let c = 1; c < header.length; c++) {
      if (periodKeysCompatible(fact.periodLabel, String(header[c] ?? ""))) {
        colIdx = c;
        break;
      }
    }
    if (colIdx < 0) {
      unmatchedPeriods.add(fact.periodLabel);
      continue;
    }

    const ck = `${fact.kind}\t${fact.concept}`;
    const lineSet = conceptToLines.get(ck);
    const want = normalizeLabel(fact.line);

    let rowIdx = -1;
    for (let r = 1; r < grid.length; r++) {
      const lab = normalizeLabel(String(grid[r]?.[0] ?? ""));
      if (!lab) continue;
      if (want && (lab === want || lab.includes(want) || want.includes(lab))) {
        rowIdx = r;
        break;
      }
      if (lineSet) {
        for (const candidate of Array.from(lineSet)) {
          if (candidate && (lab === candidate || lab.includes(candidate) || candidate.includes(lab))) {
            rowIdx = r;
            break;
          }
        }
      }
      if (rowIdx >= 0) break;
    }
    if (rowIdx < 0) continue;

    const rawCell = String(grid[rowIdx]?.[colIdx] ?? "").trim();
    const parsed = parseFinancialCellValue(rawCell);
    if (parsed === null) continue;

    numericChecks++;
    if (Math.abs(parsed - fact.value) > EPS) {
      mismatches.push(
        `${fact.kind.toUpperCase()} ${fact.concept.slice(0, 56)} | ${fact.periodLabel.slice(0, 44)}: XBRL ${fact.value.toFixed(2)} vs model ${parsed.toFixed(2)}`
      );
    }
  }

  const ok = mismatches.length === 0 && conceptsMissingFromMarkdown.length === 0;

  return {
    ok,
    mergedFactCount: merged.length,
    numericChecks,
    mismatches: mismatches.slice(0, 80),
    conceptsMissingFromMarkdown: conceptsMissingFromMarkdown.slice(0, 80),
    unmatchedPeriodsSample: Array.from(unmatchedPeriods).slice(0, 20),
  };
}

export async function validateConsolidationForTicker(
  userId: string,
  ticker: string,
  markdown: string
): Promise<ConsolidationValidation | null> {
  const built = await buildMergedFactsAndLineIndex(userId, ticker);
  if (!built) return null;
  return validateConsolidatedMarkdownAgainstXbrl(markdown, built.merged, built.conceptToLines);
}
