/**
 * HTML-first "as-presented" primary statements for the TEST tab.
 * Rows, labels, order, and displayed signs come from the filed Inline XBRL HTML table —
 * not from presentation linkbase layout or display sign normalization.
 */

import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";

import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  resolveEdgarArchivesDataCikForSubmission,
  type FilingHtmlStatement,
  type FilingHtmlStatementRow,
  type PrimaryFaceShapeTemplates,
} from "@/lib/sec-filing-financials";
import {
  extractInlineIxForMatrixAmountCell,
  findInlineIxInRowByVisibleText,
  listInlineIxOnRow,
  primaryHtmlHasInlineIxTags,
  type InlineIxCellMeta,
} from "@/lib/sec-ixbrl-inline-cell";
import { fetchFilingIndexItems } from "@/lib/sec/filingIndex";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";
import {
  conceptsReferencedInCalculationArcs,
  parseCalculationLinkbase,
  type CalculationArcRow,
} from "@/lib/sec-xbrl-calculation";
import type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";
import { runCalculationRollupValidations, type ExportValidationStatement } from "@/lib/sec-xbrl-export-validation";

export type FaceCellIxMeta = {
  visibleText: string;
  xbrlConcept: string | null;
  contextRef: string | null;
  unitRef: string | null;
  decimals: string | null;
  scale: number | null;
  format: string | null;
  sign: string | null;
};

export type FacePresentedStatementRow = {
  concept: string;
  label: string;
  depth: number;
  preferredLabelRole: null;
  /** `usd_millions` = numeric already in $M (from HTML table parser); `native` = per-share / share count scale. */
  valueFormat?: "usd_millions" | "native";
  /** Numeric value as shown on the filing face (parentheses → negative). USD. */
  values: Record<string, number | null>;
  /** Raw Inline XBRL fact in USD when the cell is tagged; otherwise null. */
  rawValues: Record<string, number | null>;
  visibleTextByPeriod: Record<string, string>;
  cellIxByPeriod: Record<string, FaceCellIxMeta | null>;
  rowKind: "data" | "heading" | "total";
};

export type FacePresentedStatement = {
  id: string;
  title: string;
  role: string;
  sourceHtmlFile?: string;
  sourceHtmlUrl?: string;
  units?: string;
  periods: Array<{ key: string; label: string; shortLabel?: string; end: string; start: string | null }>;
  rows: FacePresentedStatementRow[];
};

export type FaceStatementExtractionQa = {
  statementId: string;
  rowCount: number;
  numericCells: number;
  taggedCells: number;
  untaggedNumericCells: number;
  cellsWithSignMismatch: number;
  extractionMethod: "html_table_ixbrl";
  confidenceScore: number;
};

export type FacePresentedStatementsPayload = {
  statements: FacePresentedStatement[];
  validation: XbrlExportValidationIssue[];
  extractionQa: FaceStatementExtractionQa[];
  calculationLinkbaseLoaded: boolean;
  /** Primary document HTML contains `ix:nonFraction` tags (inline XBRL). */
  inlineIxDetected: boolean;
};

function inlineIxToFaceMeta(meta: InlineIxCellMeta | null | undefined, visibleFallback: string): FaceCellIxMeta {
  if (!meta) {
    return {
      visibleText: visibleFallback,
      xbrlConcept: null,
      contextRef: null,
      unitRef: null,
      decimals: null,
      scale: null,
      format: null,
      sign: null,
    };
  }
  return {
    visibleText: meta.visibleText || visibleFallback,
    xbrlConcept: meta.xbrlConcept,
    contextRef: meta.contextRef,
    unitRef: meta.unitRef,
    decimals: meta.decimals,
    scale: meta.scale,
    format: meta.format,
    sign: meta.sign,
  };
}

function filingRowToFaceRow(r: FilingHtmlStatementRow, stmt: FilingHtmlStatement): FacePresentedStatementRow {
  const cellIxByPeriod: Record<string, FaceCellIxMeta | null> = {};
  const rawValues: Record<string, number | null> = Object.fromEntries(
    stmt.periods.map((p) => [p.key, null as number | null])
  );

  for (const p of stmt.periods) {
    const visibleText = r.displayValues[p.key] ?? "";
    const ix = r.ixByPeriod?.[p.key];
    cellIxByPeriod[p.key] = inlineIxToFaceMeta(ix, visibleText);
    if (ix?.rawValue != null && Number.isFinite(ix.rawValue)) rawValues[p.key] = ix.rawValue;
  }

  const primaryConcept =
    stmt.periods.map((p) => r.ixByPeriod?.[p.key]?.xbrlConcept).find(Boolean) ?? r.concept;

  return {
    concept: primaryConcept,
    label: r.label,
    depth: r.depth,
    preferredLabelRole: null,
    valueFormat: r.valueFormat,
    values: { ...r.values },
    rawValues,
    visibleTextByPeriod: { ...r.displayValues },
    cellIxByPeriod,
    rowKind: r.rowKind,
  };
}

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Prefer the table the Item 1 / Item 8 parser already chose — do not re-scan the whole filing. */
function findStatementTableForEnrichment(
  $: cheerio.CheerioAPI,
  stmt: FilingHtmlStatement,
  tables: Array<{ el: DomElement; offset: number }>
): cheerio.Cheerio<DomElement> | null {
  if (stmt.sourceTableOffset != null) {
    const hit = tables.find((t) => t.offset === stmt.sourceTableOffset);
    if (hit) return $(hit.el);
  }
  return null;
}

function dataRowTrsForStatement(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<DomElement>,
  stmt: FilingHtmlStatement
): DomElement[] {
  const trs = $table.find("tr").toArray();
  const valueCols = stmt.valueColumnIndices ?? [];
  const dataStart = stmt.dataStartRowIndex ?? 0;
  const out: DomElement[] = [];

  for (let rowIdx = dataStart; rowIdx < trs.length; rowIdx += 1) {
    const tr = trs[rowIdx] as DomElement | undefined;
    if (!tr) continue;
    const cells = $(tr).children("th,td").toArray();
    const labelParts: string[] = [];
    for (const cell of cells) {
      const t = $(cell).text().replace(/\s+/g, " ").trim();
      if (!t || t === "$" || t === "—" || t === "-") continue;
      if (/^\(?\d[\d,.\s]*\)?$/.test(t.replace(/\$/g, ""))) break;
      labelParts.push(t);
    }
    const label = labelParts.join(" ").trim();
    if (label) out.push(tr);
  }
  return out;
}

function enrichStatementRowsFromHtmlTable(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<DomElement>,
  stmt: FilingHtmlStatement
): FacePresentedStatementRow[] {
  const valueCols = stmt.valueColumnIndices ?? [];
  const dataTrs = dataRowTrsForStatement($, $table, stmt);
  const labelToTr = new Map<string, DomElement>();
  for (const tr of dataTrs) {
    const cells = $(tr).children("th,td").toArray();
    const labelParts: string[] = [];
    for (const cell of cells) {
      const t = $(cell).text().replace(/\s+/g, " ").trim();
      if (!t || t === "$" || t === "—" || t === "-") continue;
      if (/^\(?\d[\d,.\s]*\)?$/.test(t.replace(/\$/g, ""))) break;
      labelParts.push(t);
    }
    const label = labelParts.join(" ").trim();
    if (label) labelToTr.set(normalizeLabel(label), tr);
  }

  let dataTrCursor = 0;

  return stmt.rows.map((r) => {
    const base = filingRowToFaceRow(r, stmt);

    const tr =
      labelToTr.get(normalizeLabel(r.label)) ??
      (r.rowKind !== "heading" && dataTrCursor < dataTrs.length ? dataTrs[dataTrCursor++] : null);
    if (!tr || valueCols.length === 0) return base;

    const rowIxOrdered = listInlineIxOnRow($, tr);
    let rowIxCursor = 0;

    for (const [idx, p] of stmt.periods.entries()) {
      if (base.cellIxByPeriod[p.key]?.xbrlConcept) continue;
      if (r.values[p.key] === null || !Number.isFinite(r.values[p.key])) continue;

      const visibleText = r.displayValues[p.key] ?? "";
      const col = valueCols[idx] ?? valueCols[valueCols.length - 1] ?? -1;
      if (col < 0) continue;

      let meta = extractInlineIxForMatrixAmountCell($, tr, col, visibleText);
      if (!meta.xbrlConcept) meta = findInlineIxInRowByVisibleText($, tr, visibleText) ?? meta;
      if (!meta.xbrlConcept && rowIxCursor < rowIxOrdered.length) {
        meta = rowIxOrdered[rowIxCursor]!;
        rowIxCursor += 1;
      }

      base.cellIxByPeriod[p.key] = inlineIxToFaceMeta(meta, visibleText);
      if (meta.rawValue != null && Number.isFinite(meta.rawValue)) base.rawValues[p.key] = meta.rawValue;
    }

    const taggedConcept = stmt.periods.map((p) => base.cellIxByPeriod[p.key]?.xbrlConcept).find(Boolean);
    if (taggedConcept) base.concept = taggedConcept;
    return base;
  });
}

function buildQa(stmt: FacePresentedStatement): FaceStatementExtractionQa {
  let numericCells = 0;
  let taggedCells = 0;
  let cellsWithSignMismatch = 0;

  for (const r of stmt.rows) {
    for (const p of stmt.periods) {
      const v = r.values[p.key];
      if (v === null || !Number.isFinite(v)) continue;
      numericCells += 1;
      const meta = r.cellIxByPeriod[p.key];
      if (meta?.xbrlConcept) taggedCells += 1;
      const raw = r.rawValues[p.key];
      if (meta?.xbrlConcept && raw !== null && Number.isFinite(raw) && v !== null) {
        const visNeg = v < 0;
        const rawNeg = raw < 0;
        if (visNeg !== rawNeg && Math.abs(v) > 1 && Math.abs(raw) > 1) cellsWithSignMismatch += 1;
      }
    }
  }

  let untaggedNumericCells = 0;
  for (const r of stmt.rows) {
    for (const p of stmt.periods) {
      const v = r.values[p.key];
      if (v === null || !Number.isFinite(v)) continue;
      if (!r.cellIxByPeriod[p.key]?.xbrlConcept) untaggedNumericCells += 1;
    }
  }

  const tagRatio = numericCells > 0 ? taggedCells / numericCells : 0;
  const confidenceScore = Math.round(50 + tagRatio * 45 - (cellsWithSignMismatch > 0 ? 10 : 0));

  return {
    statementId: stmt.id,
    rowCount: stmt.rows.length,
    numericCells,
    taggedCells,
    untaggedNumericCells,
    cellsWithSignMismatch,
    extractionMethod: "html_table_ixbrl",
    confidenceScore: Math.max(0, Math.min(100, confidenceScore)),
  };
}

function htmlStmtToFace(
  stmt: FilingHtmlStatement,
  $: cheerio.CheerioAPI,
  tables: Array<{ el: DomElement; offset: number }>
): FacePresentedStatement {
  const $table = findStatementTableForEnrichment($, stmt, tables);
  const rows = $table ? enrichStatementRowsFromHtmlTable($, $table, stmt) : stmt.rows.map((r) => filingRowToFaceRow(r, stmt));

  return {
    id: stmt.id,
    title: stmt.title,
    role: stmt.role,
    sourceHtmlFile: stmt.sourceHtmlFile,
    sourceHtmlUrl: stmt.sourceHtmlUrl,
    units: stmt.units,
    periods: stmt.periods.map((p) => ({
      key: p.key,
      label: p.label,
      shortLabel: p.shortLabel,
      end: p.key.includes("..") ? p.key.split("..")[1]! : p.key,
      start: p.key.includes("..") ? p.key.split("..")[0]! : null,
    })),
    rows,
  };
}

async function loadCalculationArcs(
  cik: string,
  accessionNumber: string,
  docUrl?: string | null
): Promise<{ arcs: CalculationArcRow[]; loaded: boolean }> {
  const archiveCik = resolveEdgarArchivesDataCikForSubmission({
    issuerCik: cik,
    accessionNumber,
    docUrl,
  });
  const cikPadded = archiveCik.replace(/\D/g, "").padStart(10, "0");
  const items = await fetchFilingIndexItems(cikPadded, accessionNumber);
  const calName = items.find((i) => /_cal\.xml$/i.test(i.name))?.name;
  if (!calName) return { arcs: [], loaded: false };
  const acc = accessionNumber.replace(/-/g, "");
  const cikNum = parseInt(cikPadded, 10);
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${calName}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() }, cache: "no-store" });
    if (!res.ok) return { arcs: [], loaded: false };
    const xml = await res.text();
    return { arcs: parseCalculationLinkbase(xml), loaded: true };
  } catch {
    return { arcs: [], loaded: false };
  }
}

function faceStatementsToValidationInput(stmts: FacePresentedStatement[]): ExportValidationStatement[] {
  return stmts.map((s) => ({
    kind: s.id === "income-statement" ? "is" : s.id === "balance-sheet" ? "bs" : "cf",
    periods: s.periods.map((p) => ({ key: p.key, label: p.label, shortLabel: p.shortLabel })),
    rows: s.rows.map((r) => ({
      concept: r.cellIxByPeriod[Object.keys(r.values)[0] ?? ""]?.xbrlConcept ?? r.concept,
      label: r.label,
      depth: r.depth,
      values: r.values,
    })),
  }));
}

function runFaceCalcValidationOnly(
  stmts: FacePresentedStatement[],
  calcArcs: CalculationArcRow[]
): XbrlExportValidationIssue[] {
  if (!calcArcs.length) return [];
  const exportStmts = faceStatementsToValidationInput(stmts);
  const conceptSet = new Set<string>();
  for (const s of exportStmts) {
    for (const r of s.rows) conceptSet.add(r.concept);
  }
  conceptsReferencedInCalculationArcs(calcArcs).forEach((c) => conceptSet.add(c));

  const resolveValue = (concept: string, periodKey: string, _kind: "is" | "bs" | "cf") => {
    const stmt = exportStmts.find((s) => s.rows.some((r) => r.concept === concept));
    const row = stmt?.rows.find((r) => r.concept === concept);
    return row?.values[periodKey] ?? null;
  };

  const resolveRaw = (concept: string, periodKey: string, kind: "is" | "bs" | "cf") => {
    const faceStmt = stmts.find((s) => s.id === (kind === "is" ? "income-statement" : kind === "bs" ? "balance-sheet" : "cash-flow"));
    const row = faceStmt?.rows.find(
      (r) => (r.cellIxByPeriod[periodKey]?.xbrlConcept ?? r.concept) === concept
    );
    if (!row) return null;
    const raw = row.rawValues[periodKey];
    if (raw !== null && Number.isFinite(raw)) return raw;
    return row.values[periodKey] ?? null;
  };

  const issues = runCalculationRollupValidations(calcArcs, exportStmts, resolveRaw);

  return issues.map((v) => ({
    ...v,
    detail: `[calc validation only; face display unchanged] ${v.detail}`,
  }));
}

export async function fetchFacePresentedStatements(params: {
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  primaryDocument: string;
  docUrl?: string | null;
  shapeTemplates?: PrimaryFaceShapeTemplates;
}): Promise<FacePresentedStatementsPayload> {
  const [htmlBundle, calcLoad] = await Promise.all([
    fetchHtmlFilingStatementsBundle({
      cik: params.cik,
      accessionNumber: params.accessionNumber,
      form: params.form,
      primaryDocument: params.primaryDocument,
      docUrl: params.docUrl,
      shapeTemplates: params.shapeTemplates,
    }),
    loadCalculationArcs(params.cik, params.accessionNumber, params.docUrl),
  ]);

  const htmlStatements = htmlBundle.statements;
  const $ = htmlBundle.primaryHtml ? cheerio.load(htmlBundle.primaryHtml) : null;
  const tables =
    htmlBundle.parsedTables ??
    ($ ? buildParsedFilingHtmlContext(htmlBundle.primaryHtml!)?.tables : undefined) ??
    [];
  const statements: FacePresentedStatement[] = htmlStatements.map((s) =>
    $ ? htmlStmtToFace(s, $, tables) : htmlStmtToFace(s, cheerio.load("<table></table>"), [])
  );

  const extractionQa = statements.map(buildQa);
  const validation = runFaceCalcValidationOnly(statements, calcLoad.arcs);

  return {
    statements,
    validation,
    extractionQa,
    calculationLinkbaseLoaded: calcLoad.loaded,
    inlineIxDetected: htmlBundle.primaryHtml ? primaryHtmlHasInlineIxTags(htmlBundle.primaryHtml) : false,
  };
}
