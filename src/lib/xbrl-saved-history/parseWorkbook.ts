import * as XLSX from "xlsx";
import type {
  ParsedSavedWorkbook,
  ParsedSavedWorkbookFull,
  ParsedStatementTable,
  ParsedStatementTableFull,
  ParsedStatementRowFull,
  StatementKind,
  WorkbookMeta,
} from "@/lib/xbrl-saved-history/types";

export function sheetKindFromName(name: string): StatementKind | null {
  const n = name.toLowerCase();
  if (n.includes("xbrl raw")) return null;
  if (n.includes("comprehensive")) return null;
  if (n.includes("cash") && n.includes("flow")) return "cf";
  if (n.includes("balance") || n.includes("financial position")) return "bs";
  if (
    n.includes("income statement") ||
    (n.includes("statement") && (n.includes("operations") || n.includes("earnings"))) ||
    (n.includes("profit") && n.includes("loss") && n.includes("statement"))
  ) {
    return "is";
  }
  return null;
}

function readMeta(aoa: (string | number | null | undefined)[][]): Partial<WorkbookMeta> {
  const out: Record<string, string> = {};
  for (const row of aoa) {
    const k = String(row[0] ?? "").trim();
    const v = row[1];
    if (k && v !== undefined && v !== null && String(v).trim()) {
      out[k.toLowerCase().replace(/\s+/g, "_")] = String(v).trim();
    }
  }
  return {
    ticker: out.ticker ?? "",
    company: out.company ?? "",
    cik: out.cik ?? "",
    form: out.form ?? "",
    filingDate: out.filing_date ?? "",
    accession: out.accession ?? "",
  };
}

/** Parse `YYYY-MM-DD` at start or after arrow. */
function parseIsoDates(label: string): { start: string | null; end: string | null; durationDays: number } {
  const t = String(label).trim();
  const arrow = t.includes("→") || t.includes("->");
  const parts = t.split(/\s*(?:→|->)\s*/).map((s) => s.trim());
  const endMatch = (parts[parts.length - 1] ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  const end = endMatch ? endMatch[1]! : null;
  let start: string | null = null;
  if (arrow && parts[0]) {
    const sm = parts[0].match(/^(\d{4}-\d{2}-\d{2})/);
    start = sm ? sm[1]! : null;
  }
  let durationDays = 0;
  if (start && end) {
    const d0 = Date.parse(`${start}T12:00:00Z`);
    const d1 = Date.parse(`${end}T12:00:00Z`);
    if (Number.isFinite(d0) && Number.isFinite(d1)) {
      durationDays = Math.round((d1 - d0) / 86400000) + 1;
    }
  }
  return { start, end, durationDays };
}

/**
 * Pick best annual column for 10-K style data: IS/CF prefer ~1y duration; BS prefer instant (no range).
 */
export function pickAnnualColumnIndex(periodLabels: string[], kind: StatementKind): { index: number; fyEnd: string; notes: string } {
  if (!periodLabels.length) return { index: 0, fyEnd: "", notes: "no_period_columns" };

  let bestI = 0;
  let bestScore = -1;
  let bestEnd = "";
  let notes = "";

  for (let i = 0; i < periodLabels.length; i++) {
    const label = periodLabels[i] ?? "";
    const { start, end, durationDays } = parseIsoDates(label);
    let score = 0;
    if (kind === "bs") {
      if (!start && end) {
        score = 1000;
        notes = "instant_column";
      } else if (durationDays <= 1 && end) {
        score = 800;
        notes = "one_day_instant";
      } else if (end) {
        score = 100;
        notes = "fallback_end_date";
      }
    } else {
      if (start && end && durationDays >= 350 && durationDays <= 380) {
        score = 2000 + durationDays;
        notes = "annual_duration";
      } else if (start && end && durationDays >= 300 && durationDays < 350) {
        score = 1500 + durationDays;
        notes = "long_duration";
      } else if (start && end && durationDays >= 85 && durationDays <= 100) {
        score = 400;
        notes = "quarterly_fallback";
      } else if (end) {
        score = 200 + Math.min(durationDays, 400);
        notes = "any_duration_with_end";
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestI = i;
      bestEnd = end ?? "";
    }
  }

  if (!bestEnd && periodLabels[0]) {
    const { end } = parseIsoDates(periodLabels[0]!);
    bestEnd = end ?? "";
    notes = "parsed_first_column_only";
  }

  return { index: bestI, fyEnd: bestEnd, notes };
}

export type ParseSecXbrlOptions = {
  /** When true (default), only 10-K workbooks get statement rows (10-Q returns empty statements). */
  requireForm10K?: boolean;
};

function parseCellToMillions(rawVal: unknown): number | null {
  if (typeof rawVal === "number" && Number.isFinite(rawVal)) return rawVal;
  if (rawVal === "" || rawVal === undefined || rawVal === null) return null;
  const n = parseFloat(String(rawVal).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseSecXbrlSavedWorkbook(
  buffer: Buffer,
  sourceFilename: string,
  options?: ParseSecXbrlOptions
): ParsedSavedWorkbook | null {
  const requireForm10K = options?.requireForm10K !== false;
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  } catch {
    return null;
  }

  const parseNotes: string[] = [];
  const metaSheet = wb.SheetNames.find((n) => n.toLowerCase() === "meta");
  if (!metaSheet) {
    parseNotes.push(`No Meta sheet in ${sourceFilename}`);
    return null;
  }

  const metaAoa = XLSX.utils.sheet_to_json(wb.Sheets[metaSheet]!, { header: 1, defval: "" }) as (string | number)[][];
  const partial = readMeta(metaAoa);
  const meta: WorkbookMeta = {
    ticker: partial.ticker ?? "",
    company: partial.company ?? "",
    cik: partial.cik ?? "",
    form: partial.form ?? "",
    filingDate: partial.filingDate ?? "",
    accession: partial.accession ?? "",
    sourceFilename,
  };

  if (requireForm10K && (meta.form || "").trim() !== "10-K") {
    parseNotes.push(`Skipped non-10-K form "${meta.form}" in ${sourceFilename} (annual model uses 10-K only).`);
    return { meta, statements: [], parseNotes };
  }

  const statements: ParsedStatementTable[] = [];

  for (const sheetName of wb.SheetNames) {
    if (sheetName === metaSheet) continue;
    const kind = sheetKindFromName(sheetName);
    if (!kind) continue;

    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const aoa = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" }) as (string | number | null | undefined)[][];
    if (!aoa.length) continue;

    const header = (aoa[0] ?? []).map((c) => String(c ?? "").trim());
    const iLine = header.findIndex((h) => /^line$/i.test(h));
    const iConcept = header.findIndex((h) => /^concept$/i.test(h));
    const iDepth = header.findIndex((h) => /^depth$/i.test(h));
    if (iLine < 0 || iConcept < 0 || iDepth < 0) {
      parseNotes.push(`Sheet "${sheetName}": missing Line/Concept/Depth header`);
      continue;
    }

    const periodLabels = header.slice(iDepth + 1).filter((_, j) => iDepth + 1 + j < header.length);
    const { index: annualColIndex, fyEnd, notes: colNote } = pickAnnualColumnIndex(
      header.slice(iDepth + 1),
      kind
    );
    if (!fyEnd) {
      parseNotes.push(`Sheet "${sheetName}": could not infer fiscal year end from column headers`);
    }
    parseNotes.push(`Sheet "${sheetName}": column_pick=${colNote} colIndex=${annualColIndex} fyEnd=${fyEnd || "?"}`);

    const valueColIdx = iDepth + 1 + annualColIndex;
    const rows: ParsedStatementTable["rows"] = [];
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      const line = String(row[iLine] ?? "").trim();
      const concept = String(row[iConcept] ?? "").trim();
      const depthRaw = row[iDepth];
      const depth = typeof depthRaw === "number" ? depthRaw : parseInt(String(depthRaw ?? "0"), 10) || 0;
      const rawVal = row[valueColIdx];
      let valueMillions: number | null = null;
      if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
        valueMillions = rawVal;
      } else if (rawVal !== "" && rawVal !== undefined && rawVal !== null) {
        const n = parseFloat(String(rawVal).replace(/,/g, ""));
        if (Number.isFinite(n)) valueMillions = n;
      }
      if (!concept && !line) continue;
      rows.push({ line, concept, depth, valueMillions });
    }

    statements.push({
      kind,
      sheetName,
      periodLabels: header.slice(iDepth + 1),
      annualColIndex,
      fiscalYearEnd: fyEnd,
      rows,
    });
  }

  return { meta, statements, parseNotes };
}

/**
 * Parses every period column on IS/BS/CF sheets (for consolidation validation). Includes 10-Q and 10-K when present.
 */
export function parseSecXbrlSavedWorkbookFullPeriods(
  buffer: Buffer,
  sourceFilename: string,
  options?: ParseSecXbrlOptions
): ParsedSavedWorkbookFull | null {
  const requireForm10K = options?.requireForm10K !== false;
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  } catch {
    return null;
  }

  const parseNotes: string[] = [];
  const metaSheet = wb.SheetNames.find((n) => n.toLowerCase() === "meta");
  if (!metaSheet) {
    parseNotes.push(`No Meta sheet in ${sourceFilename}`);
    return null;
  }

  const metaAoa = XLSX.utils.sheet_to_json(wb.Sheets[metaSheet]!, { header: 1, defval: "" }) as (string | number)[][];
  const partial = readMeta(metaAoa);
  const meta: WorkbookMeta = {
    ticker: partial.ticker ?? "",
    company: partial.company ?? "",
    cik: partial.cik ?? "",
    form: partial.form ?? "",
    filingDate: partial.filingDate ?? "",
    accession: partial.accession ?? "",
    sourceFilename,
  };

  if (requireForm10K && (meta.form || "").trim() !== "10-K") {
    parseNotes.push(`Skipped non-10-K form "${meta.form}" in ${sourceFilename} (full-period parser requires all forms).`);
    return { meta, statements: [], parseNotes };
  }

  const statements: ParsedStatementTableFull[] = [];

  for (const sheetName of wb.SheetNames) {
    if (sheetName === metaSheet) continue;
    const kind = sheetKindFromName(sheetName);
    if (!kind) continue;

    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const aoa = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" }) as (string | number | null | undefined)[][];
    if (!aoa.length) continue;

    const header = (aoa[0] ?? []).map((c) => String(c ?? "").trim());
    const iLine = header.findIndex((h) => /^line$/i.test(h));
    const iConcept = header.findIndex((h) => /^concept$/i.test(h));
    const iDepth = header.findIndex((h) => /^depth$/i.test(h));
    if (iLine < 0 || iConcept < 0 || iDepth < 0) {
      parseNotes.push(`Sheet "${sheetName}": missing Line/Concept/Depth header`);
      continue;
    }

    const periodLabels = header.slice(iDepth + 1).filter((_, j) => iDepth + 1 + j < header.length);
    const nPeriods = periodLabels.length;
    const rows: ParsedStatementRowFull[] = [];

    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      const line = String(row[iLine] ?? "").trim();
      const concept = String(row[iConcept] ?? "").trim();
      const depthRaw = row[iDepth];
      const depth = typeof depthRaw === "number" ? depthRaw : parseInt(String(depthRaw ?? "0"), 10) || 0;
      if (!concept && !line) continue;

      const valuesByPeriod: Record<string, number | null> = {};
      for (let pi = 0; pi < nPeriods; pi++) {
        const label = String(periodLabels[pi] ?? "").trim();
        if (!label) continue;
        const rawVal = row[iDepth + 1 + pi];
        valuesByPeriod[label] = parseCellToMillions(rawVal);
      }

      rows.push({ line, concept, depth, valuesByPeriod });
    }

    statements.push({
      kind,
      sheetName,
      periodLabels,
      rows,
    });
  }

  return { meta, statements, parseNotes };
}
