/**
 * SEC XBRL as-presented statements from a specific filing.
 *
 * Strategy:
 * - Use SEC Archives `index.json` for the filing folder to locate XBRL instance + linkbases.
 * - When `*_pre.xml` / `*_lab.xml` are missing from the folder listing, also scan `*-xbrl.zip` entry names (some filers only ship linkbases inside the zip).
 * - When linkbases are still absent (common for iXBRL-only packages like some NXST filings), build presentation + labels from `FilingSummary.xml` and SEC IDEA `R*.htm` viewer tables (`defref_…` anchors), then join to the `*_htm.xml` instance.
 * - Parse presentation linkbase to get row order + hierarchy.
 * - Parse label linkbase for human-readable labels (company-provided).
 * - Parse instance for fact values and contexts to build columns.
 * - Optional calculation linkbase widens the fact set and enables rollup checks (Σ weight×child **raw** instance facts vs
 *   parent; see export validation).
 * - When **`_cal.xml`** lists arithmetic children under **`CostsAndExpenses`** that are absent from **`_pre.xml`** (common
 *   for disposal‑group tagging), splice those tagged lines ahead of the parent so displayed components foot to totals.
 * - **Display** values use `sec-xbrl-display-normalize`: **negated** presentation arcs (all three primary
 *   statements) show **−instance**; other arcs keep the instance sign. **raw** picks stay on each row.
 */

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

import {
  type CalculationArcRow,
  conceptsReferencedInCalculationArcs,
  parseCalculationLinkbase,
} from "@/lib/sec-xbrl-calculation";
import { normalizeXbrlFactForStatementModel } from "@/lib/sec-xbrl-display-normalize";
import {
  incomeStatementCellNumeric,
  incomeStatementValuesForExport,
} from "@/lib/sec-xbrl-income-statement-numeric";
import { runSelfDiagnosticValidations, type SelfDiagnosticCheckResult } from "@/lib/sec-self-diagnostic-checklist";
import {
  type CalculationRollupResolveContext,
  type ExportValidationStatement,
  type XbrlExportValidationIssue,
} from "@/lib/sec-xbrl-export-validation";
import {
  coalesceDuplicateBalanceSheetConceptRows,
  dedupeBalanceSheetNearDuplicateCaptionRows,
  mergeBalanceSheetPeriodCompatibleCaptionDuplicates,
  mergeTaxonomyPrefixDuplicateBalanceSheetRows,
} from "@/lib/sec-xbrl-balance-sheet-dedupe";
import { reorderBalanceSheetRowsForPresentationSemantics } from "@/lib/sec-xbrl-balance-sheet-reorder";
import { isBalanceSheetShareCountRow } from "@/lib/sec-xbrl-balance-sheet-shares";
import { filterNonFinancialIncomeStatementRows } from "@/lib/sec-xbrl-is-presentation-filter";
import { isFinancialServicesFromInstanceXml } from "@/lib/sec-xbrl-instance-financial-sector";
import { parseFilerCikFromAccession } from "@/lib/sec-edgar";

/** User-facing when this EDGAR package has no XBRL instance or linkbases in the index (older or non‑interactive filings). */
export const SEC_XBRL_FILING_NO_XBRL_ARTIFACTS_MESSAGE =
  "XBRL financials not available / company did not file any XBRL documents.";

export type { ExportValidationStatement } from "@/lib/sec-xbrl-export-validation";

const USER_AGENT = "CenturyEggCredit research app (mailto:support@example.com)";

export type PresentedFiling = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
};

export type PeriodNormalizationMeta = {
  rule: string;
  confidence: "high" | "medium" | "low";
};

export type PresentedStatementRow = {
  concept: string; // e.g. us-gaap:Revenues
  label: string;
  depth: number;
  preferredLabelRole: string | null;
  /**
   * When set, only instance facts whose context includes this `srt:ProductOrServiceAxis` member are used.
   * Matrix-style tables on the income statement, balance sheet, or cash flow (StatementTable + product/service domain in `*_pre.xml`).
   */
  productOrServiceMember?: string | null;
  /** Statement-ready / consolidation values (analytical IS, cash-direction CF). */
  values: Record<string, number | null>;
  /** Exact instance fact after duplicate pick (before display normalization). */
  rawValues: Record<string, number | null>;
  /** Per-period normalization audit trail (aligned keys with `values`). */
  normalizationByPeriod: Record<string, PeriodNormalizationMeta | null>;
};

export type PresentedStatement = {
  id: string;
  title: string;
  role: string;
  periods: Array<{ key: string; label: string; shortLabel?: string; end: string; start: string | null }>;
  rows: PresentedStatementRow[];
};

export type PresentedStatementsPayload = {
  ok: true;
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  statements: PresentedStatement[];
  /** Structural + calculation rollup failures (empty if all checks pass within tolerance). */
  validation: XbrlExportValidationIssue[];
  /** Pass / fail / skipped status for each of the 15 canonical self-diagnostic tie-outs. */
  selfDiagnosticChecklist: SelfDiagnosticCheckResult[];
  calculationLinkbaseLoaded: boolean;
  /** Calculation linkbase arcs when `_cal.xml` loaded; else `[]`. */
  calculationArcs: CalculationArcRow[];
};

export type AsPresentedValidationContext = {
  payload: PresentedStatementsPayload;
  exportStmts: ExportValidationStatement[];
  /** Display grid values (presentation-normalized). */
  resolveValue: (concept: string, periodKey: string, kind: "is" | "bs" | "cf") => number | null;
  /** Instance **raw** numerics for `_cal.xml` rollup checks (`Σ weight×child` vs parent). */
  resolveCalculationRollupValue: (
    concept: string,
    periodKey: string,
    kind: "is" | "bs" | "cf",
    rollupCtx?: CalculationRollupResolveContext
  ) => number | null;
};

type IndexItem = { name?: string; type?: string; size?: string };

function normalizeIndexItems(data: unknown): IndexItem[] {
  if (!data || typeof data !== "object") return [];
  const dir = (data as Record<string, unknown>).directory;
  if (!dir || typeof dir !== "object") return [];
  const item = (dir as Record<string, unknown>).item;
  if (Array.isArray(item)) return item.filter((x) => x && typeof x === "object") as IndexItem[];
  if (item && typeof item === "object") return [item as IndexItem];
  return [];
}

function accNoDashes(acc: string): string {
  return (acc ?? "").replace(/-/g, "");
}

function asArr<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseHrefToConcept(href: string): string | null {
  // href like "aapl-20230930x10k.xsd#us-gaap_Revenues"
  const hash = href.indexOf("#");
  if (hash < 0) return null;
  const frag = href.slice(hash + 1);
  const u = frag.indexOf("_");
  if (u < 1) return null;
  const prefix = frag.slice(0, u);
  const name = frag.slice(u + 1);
  if (!prefix || !name) return null;
  return `${prefix}:${name}`;
}

function periodKey(end: string, start: string | null): string {
  return start ? `${start}..${end}` : end;
}

/** Inclusive calendar span; `0` = instant (no start). */
function periodDurationDays(p: { start: string | null; end: string }): number {
  if (p.start == null || p.start === "") return 0;
  const t0 = Date.parse(`${p.start}T12:00:00Z`);
  const t1 = Date.parse(`${p.end}T12:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0;
  const days = Math.round((t1 - t0) / 86400000) + 1;
  return days > 0 ? days : 0;
}

/** Oldest first (left-to-right time series). */
function sortPeriodsOldestFirst<T extends { end: string; start: string | null }>(periods: T[]): T[] {
  return [...periods].sort((a, b) => {
    if (a.end !== b.end) return a.end.localeCompare(b.end);
    const aStart = a.start ?? "";
    const bStart = b.start ?? "";
    return aStart.localeCompare(bStart);
  });
}

function parseIsoDateUtc(iso: string): { y: number; m: number; d: number } | null {
  const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1]!, 10);
  const mo = parseInt(m[2]!, 10);
  const d = parseInt(m[3]!, 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

/** Month/day of fiscal year-end from DEI `CurrentFiscalYearEndDate` (e.g. `--09-30`). */
type FiscalYearEndMd = { month: number; day: number };

function parseDeiFiscalYearEndText(raw: string): FiscalYearEndMd | null {
  const s = raw.trim();
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) {
    const mo = parseInt(full[2]!, 10);
    const d = parseInt(full[3]!, 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { month: mo, day: d };
    return null;
  }
  const md = s.match(/^--(\d{2})-(\d{2})$/);
  if (md) {
    const mo = parseInt(md[1]!, 10);
    const d = parseInt(md[2]!, 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { month: mo, day: d };
    return null;
  }
  return null;
}

function stripXmlLocalName(name: string): string {
  const c = name.indexOf(":");
  return c >= 0 ? name.slice(c + 1) : name;
}

function extractXmlTextContent(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (v && typeof v === "object" && "#text" in (v as object)) {
    const t = (v as { "#text"?: unknown })["#text"];
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return null;
}

function extractDeiCurrentFiscalYearEndFromParsedInstance(root: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown): string | null => {
    if (node == null || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const x of node) {
        const t = walk(x);
        if (t) return t;
      }
      return null;
    }
    const o = node as Record<string, unknown>;
    const nameAttr = o["@_name"];
    if (typeof nameAttr === "string" && stripXmlLocalName(nameAttr) === "CurrentFiscalYearEndDate") {
      const tx = extractXmlTextContent(o);
      if (tx) return tx;
    }
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith("@_")) continue;
      if (stripXmlLocalName(k) === "CurrentFiscalYearEndDate") {
        const tx = extractXmlTextContent(v);
        if (tx) return tx;
      }
      const t = walk(v);
      if (t) return t;
    }
    return null;
  };
  return walk(root);
}

function extractDeiCurrentFiscalYearEndFromRawXml(xml: string): string | null {
  const m = xml.match(/CurrentFiscalYearEndDate[^>]{0,240}>([^<]+)</i);
  return m?.[1]?.trim() ? m[1].trim() : null;
}

/** Subtract calendar months from an ISO date; use end-of-month logic so that
 *  fiscal quarter-end dates always land on the last day of the target month
 *  when the source date is the last day of its month (e.g. Sep 30 − 9 months
 *  must give Dec 31, not Dec 30). */
function subMonthsFromIsoEnd(ymd: string, months: number): string | null {
  const p = parseIsoDateUtc(ymd);
  if (!p) return null;
  const total = p.y * 12 + (p.m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const lastOfTarget = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const lastOfSource = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  const nd = p.d >= lastOfSource ? lastOfTarget : Math.min(p.d, lastOfTarget);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** True when ISO dates match or are within a few calendar days (SEC / week-based quarters, weekends). */
function isoEndDatesEquivalent(a: string, b: string, maxDaysApart: number): boolean {
  if (a === b) return true;
  const ta = Date.parse(`${a}T12:00:00Z`);
  const tb = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(ta - tb) <= maxDaysApart * 86400000;
}

/** Fiscal quarter-end dates for FY labeled `fyLabelYear` (the calendar year in which that FY ends). */
function fiscalQuarterEndYmds(fyLabelYear: number, fye: FiscalYearEndMd): [string, string, string, string] {
  const q4 = `${fyLabelYear}-${String(fye.month).padStart(2, "0")}-${String(fye.day).padStart(2, "0")}`;
  const q3 = subMonthsFromIsoEnd(q4, 3);
  const q2 = subMonthsFromIsoEnd(q4, 6);
  const q1 = subMonthsFromIsoEnd(q4, 9);
  if (!q3 || !q2 || !q1) return [q4, q4, q4, q4];
  return [q1, q2, q3, q4];
}

function findFiscalYearLabelForPeriodEnd(endYmd: string, fye: FiscalYearEndMd): number | null {
  const p = parseIsoDateUtc(endYmd);
  if (!p) return null;
  const y = p.y;
  for (const labelY of [y - 1, y, y + 1, y + 2]) {
    const fyEnd = `${labelY}-${String(fye.month).padStart(2, "0")}-${String(fye.day).padStart(2, "0")}`;
    const prevFyEnd = `${labelY - 1}-${String(fye.month).padStart(2, "0")}-${String(fye.day).padStart(2, "0")}`;
    if (endYmd > prevFyEnd && endYmd <= fyEnd) return labelY;
  }
  return null;
}

function isFiscalYearEndYmd(endYmd: string, fye: FiscalYearEndMd): boolean {
  const p = parseIsoDateUtc(endYmd);
  if (p === null) return false;
  if (p.m === fye.month && p.d === fye.day) return true;
  for (const y of [p.y - 1, p.y, p.y + 1]) {
    const candidate = `${y}-${String(fye.month).padStart(2, "0")}-${String(fye.day).padStart(2, "0")}`;
    if (isoEndDatesEquivalent(endYmd, candidate, 2)) return true;
  }
  return false;
}

function matchFiscalQuarterColumnLabel(endYmd: string, fye: FiscalYearEndMd): string | null {
  const TOL = 4;
  const fyLabel = findFiscalYearLabelForPeriodEnd(endYmd, fye);
  if (fyLabel == null) return null;
  const tryLabel = (label: number): string | null => {
    if (label < 1990 || label > 2100) return null;
    const ends = fiscalQuarterEndYmds(label, fye);
    for (let i = 0; i < 4; i++) {
      if (isoEndDatesEquivalent(endYmd, ends[i]!, TOL)) {
        const yy = String(label).slice(-2);
        return `${i + 1}Q${yy}`;
      }
    }
    return null;
  };
  const primary = tryLabel(fyLabel);
  if (primary) return primary;
  for (const adj of [fyLabel - 1, fyLabel + 1]) {
    const s = tryLabel(adj);
    if (s) return s;
  }
  return null;
}

/**
 * Short labels using DEI fiscal year-end when available; otherwise falls back to calendar quarters.
 */
function inferFiscalPeriodShortLabel(
  end: string,
  start: string | null,
  kind: "is" | "bs" | "cf",
  fye: FiscalYearEndMd,
  durationDays: number,
  yFull: number | undefined
): string | null {
  if (fye.month === 12 && fye.day === 31) return null;

  if (!start || start === "") {
    if (kind === "bs") {
      if (yFull !== undefined && isFiscalYearEndYmd(end, fye)) return `FY${String(yFull).slice(-2)}`;
      const fq = matchFiscalQuarterColumnLabel(end, fye);
      if (fq) return fq;
      return null;
    }
    return null;
  }

  if (kind === "is" || kind === "cf") {
    /* Week-based quarters and leap-year FY can fall slightly outside narrow bands. */
    if (durationDays >= 340 && durationDays <= 400) {
      if (yFull !== undefined && isFiscalYearEndYmd(end, fye)) return `FY${String(yFull).slice(-2)}`;
      return null;
    }
    if (durationDays >= 70 && durationDays <= 105) {
      return matchFiscalQuarterColumnLabel(end, fye);
    }
    if (durationDays >= 150 && durationDays <= 215) {
      const fyLabel = findFiscalYearLabelForPeriodEnd(end, fye);
      if (fyLabel == null) return null;
      const [, q2e] = fiscalQuarterEndYmds(fyLabel, fye);
      if (isoEndDatesEquivalent(end, q2e, 4)) return `6M${String(fyLabel).slice(-2)}`;
      return null;
    }
    if (durationDays >= 235 && durationDays <= 325) {
      const fyLabel = findFiscalYearLabelForPeriodEnd(end, fye);
      if (fyLabel == null) return null;
      const [, , q3e] = fiscalQuarterEndYmds(fyLabel, fye);
      if (isoEndDatesEquivalent(end, q3e, 4)) return `9M${String(fyLabel).slice(-2)}`;
      return null;
    }
  }

  /* End-date matches fiscal quarter but duration fell outside bands (reporting / odd fiscal calendars). */
  if ((kind === "is" || kind === "cf") && start) {
    const qByEnd = matchFiscalQuarterColumnLabel(end, fye);
    if (qByEnd && durationDays >= 28 && durationDays <= 125) {
      return qByEnd;
    }
  }

  return null;
}

/** US-style quarter-end calendar dates (December fiscal year-end). */
function calendarQuarterFromEndDate(end: string): { q: 1 | 2 | 3 | 4; yy: string } | null {
  const dt = parseIsoDateUtc(end);
  if (!dt) return null;
  const { y, m, d } = dt;
  if (m === 3 && d === 31) return { q: 1, yy: String(y).slice(-2) };
  if (m === 6 && d === 30) return { q: 2, yy: String(y).slice(-2) };
  if (m === 9 && d === 30) return { q: 3, yy: String(y).slice(-2) };
  if (m === 12 && d === 31) return { q: 4, yy: String(y).slice(-2) };
  return null;
}

/**
 * Short header like 1Q24 / FY24. Uses `dei:CurrentFiscalYearEndDate` when present so non-December FY
 * (e.g. Sep 30) maps quarter-ends correctly; otherwise calendar quarter-ends (Dec FY).
 */
function inferPeriodShortLabel(
  end: string,
  start: string | null,
  kind: "is" | "bs" | "cf",
  fiscalYearEnd: FiscalYearEndMd | null
): string | null {
  const durationDays = periodDurationDays({ start, end });
  const cq = calendarQuarterFromEndDate(end);
  const yFull = parseIsoDateUtc(end)?.y;

  if (fiscalYearEnd) {
    const f = inferFiscalPeriodShortLabel(end, start, kind, fiscalYearEnd, durationDays, yFull);
    if (f !== null) return f;
  }

  if (!start || start === "") {
    if (kind === "bs" && cq) {
      if (cq.q === 4) return `FY${cq.yy}`;
      return `${cq.q}Q${cq.yy}`;
    }
    return null;
  }

  if (kind === "is" || kind === "cf") {
    if (durationDays >= 350 && durationDays <= 380 && yFull !== undefined) {
      return `FY${String(yFull).slice(-2)}`;
    }
    if (durationDays >= 82 && durationDays <= 98 && cq) {
      return `${cq.q}Q${cq.yy}`;
    }
    if (durationDays >= 170 && durationDays <= 200 && yFull !== undefined) {
      return `6M${String(yFull).slice(-2)}`;
    }
    if (durationDays >= 260 && durationDays <= 295 && yFull !== undefined) {
      return `9M${String(yFull).slice(-2)}`;
    }
  }

  return null;
}

function assignPeriodDisplayFields(
  periodsChrono: Array<{ key: string; end: string; start: string | null; score: number }>,
  kind: "is" | "bs" | "cf",
  fiscalYearEnd: FiscalYearEndMd | null
): Array<{ key: string; label: string; shortLabel?: string; end: string; start: string | null }> {
  const used = new Map<string, number>();
  return periodsChrono.map((p) => {
    const longLabel = p.start ? `${p.start} → ${p.end}` : p.end;
    const base = inferPeriodShortLabel(p.end, p.start, kind, fiscalYearEnd);
    if (!base) {
      return { key: p.key, label: longLabel, end: p.end, start: p.start };
    }
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const shortLabel = n === 1 ? base : `${base} · ${p.start ?? p.end}`;
    return { key: p.key, label: longLabel, shortLabel, end: p.end, start: p.start };
  });
}

/** IS / CF / equity rollforwards are duration statements; omit 1-day & instant columns when FY columns exist. */
const MIN_DURATION_DAYS_FOR_RANGE_STATEMENT = 28;

function filterPeriodEntriesForStatementTitle<T extends { start: string | null; end: string; key: string }>(
  entries: Array<T & { score: number }>,
  statementTitle: string
): Array<T & { score: number }> {
  const rangeHeavy =
    statementTitle === "Income Statement" ||
    statementTitle === "Cash Flow" ||
    statementTitle === "Equity";
  if (!rangeHeavy) return entries;

  const multiDay = entries.filter((e) => periodDurationDays(e) >= MIN_DURATION_DAYS_FOR_RANGE_STATEMENT);
  if (multiDay.length >= 3) return multiDay;
  return entries;
}

/** Fewer explicit XBRL dimensions → closer to consolidated statement totals (not a segment slice). */
function explicitMemberCount(ctxEl: any): number {
  const ent = ctxEl?.["xbrli:entity"] ?? ctxEl?.["entity"];
  if (!ent || typeof ent !== "object") return 0;
  const seg = ent["xbrli:segment"] ?? ent["segment"];
  if (!seg) return 0;
  const em = seg["xbrldi:explicitMember"] ?? seg["explicitMember"];
  return asArr(em).length;
}

function conceptLocalName(concept: string): string {
  const i = concept.lastIndexOf(":");
  return i >= 0 ? concept.slice(i + 1) : concept;
}

function isStatementTableConcept(concept: string): boolean {
  return conceptLocalName(concept) === "StatementTable";
}

function isProductOrServiceAxisConcept(concept: string): boolean {
  return conceptLocalName(concept).replace(/_/g, "").toLowerCase().includes("productorserviceaxis");
}

function isProductsAndServicesDomainConcept(concept: string): boolean {
  return conceptLocalName(concept).replace(/_/g, "").toLowerCase().includes("productsandservicesdomain");
}

/** `srt:ProductOrServiceAxis` explicit member QName (`prefix:Member`), if present. */
function parseContextProductOrServiceMember(ctxEl: any): string | null {
  const ent = ctxEl?.["xbrli:entity"] ?? ctxEl?.["entity"];
  if (!ent || typeof ent !== "object") return null;
  const seg = ent["xbrli:segment"] ?? ent["segment"];
  if (!seg) return null;
  const em = seg["xbrldi:explicitMember"] ?? seg["explicitMember"];
  for (const m of asArr(em)) {
    const dim = m?.["@_dimension"];
    if (typeof dim !== "string") continue;
    if (!/ProductOrServiceAxis$/i.test(dim.trim())) continue;
    const raw = extractXmlTextContent(m);
    if (!raw) continue;
    const t = raw.trim();
    if (!t) continue;
    if (t.includes(":")) return t;
    const u = t.indexOf("_");
    if (u >= 1) return `${t.slice(0, u)}:${t.slice(u + 1)}`;
  }
  return null;
}

function extractOrderedProductOrServiceDomainMembers(role: PreParse["roles"][number]): string[] {
  const children = new Map<string, Array<{ to: string; order: number }>>();
  const incoming = new Set<string>();
  for (const a of role.arcs) {
    const arr = children.get(a.from) ?? [];
    arr.push({ to: a.to, order: a.order });
    children.set(a.from, arr);
    incoming.add(a.to);
  }
  for (const arr of Array.from(children.values())) arr.sort((a, b) => a.order - b.order);

  let tableLabel: string | null = null;
  for (const [lbl, concept] of Object.entries(role.locs)) {
    if (isStatementTableConcept(concept)) {
      tableLabel = lbl;
      break;
    }
  }
  if (!tableLabel) return [];

  const fromTable = children.get(tableLabel) ?? [];
  const axisLbl = fromTable.map((x) => x.to).find((lbl) => {
    const c = role.locs[lbl];
    return c ? isProductOrServiceAxisConcept(c) : false;
  });
  if (!axisLbl) return [];

  const domainLbl = (children.get(axisLbl) ?? [])
    .map((x) => x.to)
    .find((lbl) => {
      const c = role.locs[lbl];
      return c ? isProductsAndServicesDomainConcept(c) : false;
    });
  if (!domainLbl) return [];

  const members: string[] = [];
  for (const { to } of children.get(domainLbl) ?? []) {
    const c = role.locs[to];
    if (c && conceptLocalName(c).endsWith("Member")) members.push(c);
  }
  return members;
}

type PresentationWalkNode = {
  concept: string;
  depth: number;
  preferredLabelRole: string | null;
  label: string;
};

/**
 * Duplicate presentation line items per `srt:ProductOrServiceAxis` member when the instance tags the
 * same QName for multiple product/service slices (matrix-style tables). Used for income statement,
 * balance sheet, and cash flow roles that include a StatementTable + ProductsAndServicesDomain in `*_pre.xml`.
 */
function expandStatementNodesForProductServiceAxis(
  nodes: PresentationWalkNode[],
  presRole: PreParse["roles"][number],
  inst: InstanceParse,
  periodKeys: string[],
  labels: Map<string, Map<string, string>>
): Array<PresentationWalkNode & { productOrServiceMember: string | null }> {
  const presentationMembers = extractOrderedProductOrServiceDomainMembers(presRole);
  const presSet = new Set(presentationMembers);
  const pkSet = new Set(periodKeys);

  const memberLabel = (memberConcept: string): string => {
    const m = labels.get(memberConcept);
    if (m?.get(XBRL_TERSE_LABEL_ROLE)) return m.get(XBRL_TERSE_LABEL_ROLE)!;
    if (m?.get(XBRL_STD_LABEL_ROLE)) return m.get(XBRL_STD_LABEL_ROLE)!;
    const first = m ? Array.from(m.values())[0] : undefined;
    if (first) return first;
    return conceptLocalName(memberConcept).replace(/Member$/i, "");
  };

  const distinctMembersInPresentation = (concept: string): Set<string> => {
    const found = new Set<string>();
    for (const f of inst.facts.get(concept) ?? []) {
      const p = inst.contextPeriod.get(f.contextRef);
      if (!p?.end) continue;
      if (!pkSet.has(periodKey(p.end, p.start))) continue;
      const m = inst.contextProductOrServiceMember.get(f.contextRef) ?? null;
      if (m && presSet.has(m)) found.add(m);
    }
    return found;
  };

  const distinctMembersAny = (concept: string): Set<string> => {
    const found = new Set<string>();
    for (const f of inst.facts.get(concept) ?? []) {
      const p = inst.contextPeriod.get(f.contextRef);
      if (!p?.end) continue;
      if (!pkSet.has(periodKey(p.end, p.start))) continue;
      const m = inst.contextProductOrServiceMember.get(f.contextRef) ?? null;
      if (m) found.add(m);
    }
    return found;
  };

  const hasFactMissingProductMember = (concept: string): boolean => {
    for (const f of inst.facts.get(concept) ?? []) {
      const p = inst.contextPeriod.get(f.contextRef);
      if (!p?.end) continue;
      if (!pkSet.has(periodKey(p.end, p.start))) continue;
      const m = inst.contextProductOrServiceMember.get(f.contextRef);
      if (m === null || m === undefined) return true;
    }
    return false;
  };

  const out: Array<PresentationWalkNode & { productOrServiceMember: string | null }> = [];

  for (const n of nodes) {
    if (presentationMembers.length === 0 || !(inst.facts.get(n.concept)?.length)) {
      out.push({ ...n, productOrServiceMember: null });
      continue;
    }

    const mixedOrConsolidated = hasFactMissingProductMember(n.concept);
    const distinctPres = distinctMembersInPresentation(n.concept);
    const distinctAny = distinctMembersAny(n.concept);

    if (!mixedOrConsolidated && distinctPres.size >= 2) {
      const ordered = presentationMembers.filter((m) => distinctPres.has(m));
      const order =
        ordered.length >= 2 ? ordered : [...distinctAny].sort((a, b) => a.localeCompare(b));
      for (const mem of order) {
        if (!distinctAny.has(mem)) continue;
        out.push({
          ...n,
          label: memberLabel(mem),
          productOrServiceMember: mem,
        });
      }
    } else if (!mixedOrConsolidated && distinctPres.size === 1) {
      out.push({ ...n, productOrServiceMember: [...distinctPres][0]! });
    } else {
      out.push({ ...n, productOrServiceMember: null });
    }
  }

  return out;
}

/**
 * Hard cap on distinct period columns per statement (pathological filings only).
 * Normal behavior: keep every period that has ≥1 fact on the presentation (score > 0), oldest → newest.
 */
const MAX_STATEMENT_PERIODS = 4000;

function isNilFact(item: any): boolean {
  const nilRaw = item?.["@_xsi:nil"] ?? item?.["@_nil"];
  return nilRaw === true || nilRaw === "true" || nilRaw === 1 || nilRaw === "1";
}

/**
 * Parses `#text` on a fact element (inline or standalone). Inline XBRL may put the magnitude in `#text`
 * and the economic sign in `@sign` — see iXBRL spec / SEC inline tagging guidance.
 */
function numericFromXbrlFactItem(item: any): number | null {
  if (isNilFact(item)) return null;
  const raw = item?.["#text"];
  let num = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(String(raw).replace(/,/g, "")) : NaN;
  if (!Number.isFinite(num)) return null;
  const signAttr = item?.["@_sign"];
  if (signAttr === "-" || signAttr === -1 || signAttr === "-1") {
    num = -Math.abs(num);
  }
  return num;
}

/** One of three primary financials, or null = skip (parenthetical, disclosure, equity, OCI, etc.). */
export function primaryStatementKind(role: string): "is" | "bs" | "cf" | null {
  const u = role.toLowerCase();
  const c = u.replace(/[\s_-]/g, "");
  const stem = (() => {
    const slash = c.lastIndexOf("/");
    return slash >= 0 ? c.slice(slash + 1) : c;
  })();
  const statementOfIdx = stem.indexOf("statementof");
  const statementsOfIdx = stem.indexOf("statementsof");
  const statementIdx =
    statementsOfIdx >= 0 ? statementsOfIdx : statementOfIdx >= 0 ? statementOfIdx : -1;
  const isFaceStatementRole = statementIdx >= 0 && statementIdx <= 24;
  if (u.includes("parenthetical")) return null;
  if (/\/role\/disclosure/i.test(role) || c.includes("disclosureoperating") || c.includes("disclosurestock") || c.includes("disclosuredebt")) return null;
  if (c.includes("documentdocument") || c.includes("documentandentity")) return null;
  if (/\/ecd\//i.test(role) || c.includes("insidertrading")) return null;
  /**
   * OCI / AOCI footnote schedules (not the face consolidated statement of comprehensive income or loss).
   * Issuers like NN only tag `CONSOLIDATEDSTATEMENTSOFCOMPREHENSIVELOSS` as the primary P&L — that must stay eligible.
   */
  if (c.includes("othercomprehensive") || c.includes("accumulatedothercomprehensive")) return null;
  if (
    c.includes("statementofequity") ||
    c.includes("statementsofequity") ||
    c.includes("stockholdersequity") ||
    c.includes("shareholdersequity")
  ) {
    return null;
  }

  /**
   * Footnote / breakout tables: role text references the main statement but URI ends in `…Details`
   * (e.g. FICO derivative gains “…RecordedInConsolidatedStatementsOfIncomeDetails”). Those are not the primary IS/BS/CF.
   */
  if (c.endsWith("details") || c.endsWith("detail")) return null;

  if (c.includes("cashflow") || (c.includes("cash") && c.includes("flow"))) return "cf";
  if (c.includes("balancesheet") || c.includes("financialposition") || (c.includes("balance") && c.includes("sheet"))) return "bs";
  /**
   * Income statement: use concrete substrings. Avoid `(statement && income)` — it matches disclosure roles that
   * contain `…StatementsOfIncome…` in the company extension URI without being the face financial.
   */
  if (
    c.includes("incomestatement") ||
    c.includes("statementofincome") ||
    c.includes("statementsofincome") ||
    c.includes("statementofincomeloss") ||
    c.includes("statementsofincomeloss") ||
    c.includes("incomeloss") ||
    c.includes("statementsofoperations") ||
    c.includes("statementofoperations") ||
    c.includes("consolidatedstatementsofcomprehensive") ||
    c.includes("statementofcomprehensiveincome") ||
    c.includes("statementsofcomprehensiveincome") ||
    c.includes("statementofcomprehensiveincomeloss") ||
    c.includes("statementsofcomprehensiveincomeloss") ||
    c.includes("comprehensiveincomeloss") ||
    (isFaceStatementRole && stem.includes("income")) ||
    (isFaceStatementRole && stem.includes("operations")) ||
    (isFaceStatementRole && stem.includes("earnings")) ||
    (isFaceStatementRole && stem.includes("profitloss")) ||
    (c.includes("statement") && c.includes("operations")) ||
    (c.includes("statement") && c.includes("earnings")) ||
    (c.includes("profit") && c.includes("loss"))
  ) {
    return "is";
  }
  return null;
}

export function isComprehensiveIncomeRole(role: string): boolean {
  const c = role.toLowerCase().replace(/[\s_-]/g, "");
  const slash = c.lastIndexOf("/");
  const stem = slash >= 0 ? c.slice(slash + 1) : c;
  const statementOfIdx = stem.indexOf("statementof");
  const statementsOfIdx = stem.indexOf("statementsof");
  const statementIdx =
    statementsOfIdx >= 0 ? statementsOfIdx : statementOfIdx >= 0 ? statementOfIdx : -1;
  const isFaceStatementRole = statementIdx >= 0 && statementIdx <= 24;
  return (
    c.includes("consolidatedstatementsofcomprehensive") ||
    c.includes("statementofcomprehensiveincome") ||
    c.includes("statementsofcomprehensiveincome") ||
    c.includes("statementofcomprehensiveincomeloss") ||
    c.includes("statementsofcomprehensiveincomeloss") ||
    c.includes("comprehensiveincomeloss") ||
    (isFaceStatementRole && stem.includes("comprehensive"))
  );
}

/**
 * Use **Comprehensive Income** as the UI title only for a *standalone* statement of comprehensive income
 * (typically Net income + OCI). Exclude **combined** roles such as “Statement of Income **and** Comprehensive
 * Income,” which share one presentation tree for Revenue → net income — the face title is still an income
 * statement for users even when the role URI mentions comprehensive.
 */
export function useComprehensiveIncomeStatementTitle(role: string): boolean {
  if (!isComprehensiveIncomeRole(role)) return false;
  const c = role.toLowerCase().replace(/[\s_-]/g, "");
  return !roleUriIsCombinedIncomeAndComprehensiveStatement(c);
}

/** Normalized role URI / path fragment (no spaces/dashes/underscores), lowercase. */
function roleUriIsCombinedIncomeAndComprehensiveStatement(c: string): boolean {
  return (
    c.includes("incomeandcomprehensive") ||
    c.includes("incomelossandcomprehensive") ||
    c.includes("operationsandcomprehensive") ||
    c.includes("earningandcomprehensive") ||
    c.includes("earningsandcomprehensive")
  );
}

export function incomeStatementSelectionPriority(role: string): number {
  const u = role.toLowerCase();
  const c = u.replace(/[\s_-]/g, "");
  const slash = c.lastIndexOf("/");
  const stem = slash >= 0 ? c.slice(slash + 1) : c;
  const statementOfIdx = stem.indexOf("statementof");
  const statementsOfIdx = stem.indexOf("statementsof");
  const statementIdx =
    statementsOfIdx >= 0 ? statementsOfIdx : statementOfIdx >= 0 ? statementOfIdx : -1;
  const isFaceStatementRole = statementIdx >= 0 && statementIdx <= 24;

  if (isComprehensiveIncomeRole(role)) return 0;
  let tier = 1;
  if (
    c.includes("incomestatement") ||
    c.includes("statementofincome") ||
    c.includes("statementsofincome") ||
    c.includes("statementofincomeloss") ||
    c.includes("statementsofincomeloss") ||
    c.includes("incomeloss") ||
    c.includes("statementsofoperations") ||
    c.includes("statementofoperations") ||
    (isFaceStatementRole && stem.includes("income")) ||
    (isFaceStatementRole && stem.includes("operations")) ||
    (isFaceStatementRole && stem.includes("earnings")) ||
    (isFaceStatementRole && stem.includes("profitloss")) ||
    (c.includes("statement") && c.includes("operations")) ||
    (c.includes("statement") && c.includes("earnings")) ||
    (c.includes("profit") && c.includes("loss"))
  ) {
    tier = 2;
  }
  /**
   * Filers often publish both a **condensed** and a **full** operations statement in XBRL; the
   * condensed tree omits segment lines (e.g. energy / services revenue and matching cost lines).
   * Prefer the non-condensed role when both match otherwise (see also primary candidate tie-break).
   */
  if (c.includes("condensed")) tier = Math.min(tier, 1);
  return tier;
}

function displayTitleForPrimaryKind(kind: "is" | "bs" | "cf"): string {
  if (kind === "is") return "Income Statement";
  if (kind === "bs") return "Balance Sheet";
  return "Cash Flow";
}

function gridNonNullCount(rows: PresentedStatementRow[], periodKeys: string[]): number {
  let n = 0;
  for (const row of rows) {
    for (const pk of periodKeys) {
      const v = row.values[pk];
      if (v !== null && Number.isFinite(v)) n++;
    }
  }
  return n;
}

function likelyStatementRole(role: string): boolean {
  const r = role.toLowerCase();
  if (!r.includes("role")) return true;
  return (
    r.includes("statement") ||
    r.includes("balancesheet") ||
    r.includes("financialposition") ||
    r.includes("income") ||
    r.includes("operations") ||
    r.includes("cashflow") ||
    r.includes("equity")
  );
}

/**
 * SEC XBRL uses many character/entity expansions. fast-xml-parser v5 only applies limits under
 * `processEntities` (object); top-level maxTotalExpansions is ignored when processEntities is `true`.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,
  textNodeName: "#text",
  processEntities: {
    enabled: true,
    maxTotalExpansions: 2_000_000,
    maxEntityCount: 50_000,
    maxExpandedLength: 50_000_000,
  },
});

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" } });
  if (!res.ok) throw new Error(`SEC fetch failed (${res.status})`);
  return res.text();
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`SEC fetch failed (${res.status})`);
  return res.json();
}

/**
 * SEC may mirror `index.json` under a successor issuer CIK while the filing’s HTML index and downloadable
 * artifacts live only under the accession-prefix (filer) CIK — e.g. `0001288776-…` documents under
 * `…/data/1288776/…` even when `index.json` is also available under Alphabet’s CIK.
 *
 * Accessions filed by agent (`0001193125-…`) put the *agent* in the accession prefix; the HTML filing index
 * still links to `/Archives/edgar/data/{issuerCik}/{accession}/…` (e.g. old Google under `1288776`).
 */
function parseCanonicalArtifactFolderCikFromIndexHtml(html: string, accClean: string): number | null {
  if (!html || !accClean) return null;
  const re = new RegExp(`/Archives/edgar/data/(\\d+)/${accClean}/`, "i");
  const m = re.exec(html);
  if (!m) return null;
  const n = parseInt(m[1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function tryCanonicalArtifactFolderCikFromFilingIndexHtml(
  indexPageBase: string,
  acc: string,
  accClean: string,
  namesFlat: string[],
): Promise<number | null> {
  const accTrim = acc.trim();
  const primaryName =
    namesFlat.find((n) => n === `${accTrim}-index.html`) ??
    namesFlat.find((n) => /-index\.html$/i.test(n) && !/headers/i.test(n)) ??
    null;
  if (!primaryName) return null;
  try {
    const html = await fetchText(`${indexPageBase}/${primaryName}`);
    return parseCanonicalArtifactFolderCikFromIndexHtml(html, accClean);
  } catch {
    return null;
  }
}

function uniquePositiveCikCandidates(...nums: Array<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const raw of nums) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

async function probeSecArtifactFolderCik(
  candidates: readonly number[],
  accClean: string,
  fileName: string,
): Promise<number> {
  let lastErr: Error | null = null;
  for (const c of candidates) {
    const url = `https://www.sec.gov/Archives/edgar/data/${c}/${accClean}/${fileName}`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "*/*", Range: "bytes=0-0" },
      });
      if (res.ok) return c;
      lastErr = new Error(`SEC fetch failed (${res.status})`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("SEC fetch failed");
}

function findBestXbrlFiles(names: string[]): {
  instance: string | null;
  pre: string | null;
  lab: string | null;
  cal: string | null;
} {
  const lower = names.map((n) => n.toLowerCase());
  const pick = (re: RegExp) => {
    const idx = lower.findIndex((n) => re.test(n));
    return idx >= 0 ? names[idx]! : null;
  };
  // Instance: prefer *_htm.xml or *.xml that isn't linkbase
  const pre = pick(/_pre\.xml$/i);
  const lab = pick(/_lab\.xml$/i);
  const cal = pick(/_cal\.xml$/i);
  let instance = pick(/_htm\.xml$/i);
  if (!instance) {
    const candidates = names.filter((name) => {
      const n = name.toLowerCase();
      if (!n.endsWith(".xml")) return false;
      if (n.endsWith("_pre.xml") || n.endsWith("_lab.xml") || n.endsWith("_cal.xml") || n.endsWith("_def.xml")) return false;
      if (n === "filingsummary.xml" || n === "defnref.xml") return false;
      if (/^r\d+\.xml$/i.test(name)) return false;
      return true;
    });
    instance =
      candidates.find((name) => /(_ins\.xml|instance\.xml)$/i.test(name)) ??
      candidates.find((name) => /-\d{8}\.xml$/i.test(name) || /_\d{8}\.xml$/i.test(name)) ??
      candidates[0] ??
      null;
  }
  return { instance, pre, lab, cal };
}

type PreParse = {
  roles: Array<{ role: string; locs: Record<string, string>; arcs: Array<{ from: string; to: string; order: number; preferredLabel?: string | null }> }>;
};

function parsePresentation(preXml: string): PreParse {
  const o = parser.parse(preXml) as any;
  const linkbase = o["link:linkbase"] ?? o["linkbase"] ?? o;
  /** Default linkbase NS → unprefixed `presentationLink` / `loc` (common on SEC filings). */
  const pres = asArr(linkbase["link:presentationLink"] ?? linkbase["presentationLink"]);
  const roles: PreParse["roles"] = [];
  for (const pl of pres) {
    const role = pl?.["@_xlink:role"] ?? pl?.["@_role"] ?? "";
    if (!role || (typeof role === "string" && !likelyStatementRole(role))) continue;
    const locs: Record<string, string> = {};
    for (const loc of asArr(pl["link:loc"] ?? pl["loc"])) {
      const label = loc?.["@_xlink:label"];
      const href = loc?.["@_xlink:href"];
      if (typeof label !== "string" || typeof href !== "string") continue;
      const concept = parseHrefToConcept(href);
      if (!concept) continue;
      locs[label] = concept;
    }
    const arcs: Array<{ from: string; to: string; order: number; preferredLabel?: string | null }> = [];
    for (const arc of asArr(pl["link:presentationArc"] ?? pl["presentationArc"])) {
      const from = arc?.["@_xlink:from"];
      const to = arc?.["@_xlink:to"];
      const orderRaw = arc?.["@_order"];
      const pref = arc?.["@_preferredLabel"];
      const order = typeof orderRaw === "string" ? parseFloat(orderRaw) : typeof orderRaw === "number" ? orderRaw : 0;
      if (typeof from !== "string" || typeof to !== "string") continue;
      arcs.push({ from, to, order: Number.isFinite(order) ? order : 0, preferredLabel: typeof pref === "string" ? pref : null });
    }
    roles.push({ role, locs, arcs });
  }
  return { roles };
}

function parseLabels(labXml: string): Map<string, Map<string, string>> {
  // concept -> role -> label
  const o = parser.parse(labXml) as any;
  const linkbase = o["link:linkbase"] ?? o["linkbase"] ?? o;
  const links = asArr(linkbase["link:labelLink"] ?? linkbase["labelLink"]);
  const labelByLinkLabel = new Map<string, { role: string; text: string }>();
  const conceptByLocLabel = new Map<string, string>();
  const out = new Map<string, Map<string, string>>();

  for (const ll of links) {
    for (const loc of asArr(ll["link:loc"] ?? ll["loc"])) {
      const label = loc?.["@_xlink:label"];
      const href = loc?.["@_xlink:href"];
      if (typeof label !== "string" || typeof href !== "string") continue;
      const concept = parseHrefToConcept(href);
      if (!concept) continue;
      conceptByLocLabel.set(label, concept);
    }
    for (const lab of asArr(ll["link:label"] ?? ll["label"])) {
      const label = lab?.["@_xlink:label"];
      const role = lab?.["@_xlink:role"] ?? "";
      const text = typeof lab?.["#text"] === "string" ? lab["#text"] : typeof lab === "string" ? lab : "";
      if (typeof label !== "string" || !text) continue;
      labelByLinkLabel.set(label, { role: typeof role === "string" ? role : "", text: String(text).trim() });
    }
    for (const arc of asArr(ll["link:labelArc"] ?? ll["labelArc"])) {
      const from = arc?.["@_xlink:from"];
      const to = arc?.["@_xlink:to"];
      if (typeof from !== "string" || typeof to !== "string") continue;
      const concept = conceptByLocLabel.get(from);
      const lab = labelByLinkLabel.get(to);
      if (!concept || !lab?.text) continue;
      const m = out.get(concept) ?? new Map<string, string>();
      if (!m.has(lab.role)) m.set(lab.role, lab.text);
      out.set(concept, m);
    }
  }

  return out;
}

const XBRL_STD_LABEL_ROLE = "http://www.xbrl.org/2003/role/label";
const XBRL_TERSE_LABEL_ROLE = "http://www.xbrl.org/2003/role/terseLabel";

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" } });
  if (!res.ok) throw new Error(`SEC fetch failed (${res.status})`);
  return res.arrayBuffer();
}

/** Loose `*_pre.xml` / `*_lab.xml` sometimes appear only inside `*-xbrl.zip`; add basenames to the pick list. */
async function expandIndexNamesWithZipBasenames(baseUrl: string, names: string[]): Promise<string[]> {
  const zipNames = names.filter((n) => /\.zip$/i.test(n) && /xbrl/i.test(n));
  if (zipNames.length === 0) return names;
  const extra = new Set<string>();
  for (const zn of zipNames) {
    try {
      const buf = await fetchArrayBuffer(`${baseUrl}/${zn}`);
      const zip = await JSZip.loadAsync(buf);
      for (const rel of Object.keys(zip.files)) {
        const f = zip.files[rel];
        if (!f || f.dir) continue;
        const base = rel.split(/[/\\]/).pop();
        if (base) extra.add(base);
      }
    } catch {
      /* ignore */
    }
  }
  if (extra.size === 0) return names;
  return [...names, ...extra];
}

/** Map IDEA `defref_us-gaap_FooBar` to `us-gaap:FooBar`. */
export function ideaViewerDefrefToConcept(defrefBody: string): string | null {
  const s = defrefBody.trim();
  const u = s.indexOf("_");
  if (u < 1) return null;
  const prefix = s.slice(0, u);
  const local = s.slice(u + 1);
  if (!prefix || !local) return null;
  if (!/^[a-z0-9-]+$/i.test(prefix)) return null;
  return `${prefix}:${local}`;
}

function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

function decodeSecViewerText(s: string): string {
  return stripHtmlTags(s)
    .replace(/&#160;/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse SEC IDEA viewer HTML (`R*.htm`) for ordered row concepts + anchor labels. */
export function parseIdeaViewerDefrefRows(html: string): Array<{ concept: string; label: string }> {
  const out: Array<{ concept: string; label: string }> = [];
  const seen = new Set<string>();
  const re = /Show\.showAR\(\s*this,\s*'defref_([^']+)'[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const concept = ideaViewerDefrefToConcept(m[1] ?? "");
    if (!concept) continue;
    if (seen.has(concept)) continue;
    seen.add(concept);
    const label = decodeSecViewerText(m[2] ?? "");
    out.push({ concept, label: label || concept });
  }
  return out;
}

function extractIdeaHtmlDocument(raw: string): string {
  const htmlBlock = raw.match(/<html[\s\S]*?<\/html>/i);
  return htmlBlock ? htmlBlock[0] : raw;
}

type FilingSummarySheetReport = {
  htmlFileName: string;
  role: string;
  menuCategory: string;
  reportType: string;
  position: number;
};

function parseFilingSummarySheetReports(filingSummaryXml: string): FilingSummarySheetReport[] {
  const o = parser.parse(filingSummaryXml) as Record<string, unknown>;
  const fs = (o.FilingSummary ?? o) as Record<string, unknown>;
  const my = (fs.MyReports ?? fs.myReports) as Record<string, unknown> | undefined;
  const rawReports = my?.Report ?? my?.report;
  const reports = asArr(rawReports as object);
  const rows: FilingSummarySheetReport[] = [];
  for (const r of reports) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const htmlFileName = typeof x.HtmlFileName === "string" ? x.HtmlFileName.trim() : "";
    const role = typeof x.Role === "string" ? x.Role.trim() : "";
    const menuCategory = typeof x.MenuCategory === "string" ? x.MenuCategory.trim() : "";
    const reportType = typeof x.ReportType === "string" ? x.ReportType.trim() : "";
    const posRaw = x.Position;
    const position =
      typeof posRaw === "number" ? posRaw : typeof posRaw === "string" ? parseInt(posRaw, 10) : 0;
    if (!htmlFileName || !role) continue;
    rows.push({ htmlFileName, role, menuCategory, reportType, position: Number.isFinite(position) ? position : 0 });
  }
  rows.sort((a, b) => a.position - b.position);
  return rows;
}

function buildSyntheticPresentationFromViewer(
  parts: Array<{ role: string; rows: Array<{ concept: string; label: string }> }>
): PreParse {
  const roles: PreParse["roles"] = [];
  for (const p of parts) {
    const locs: Record<string, string> = {};
    p.rows.forEach((r, i) => {
      locs[`L${i}`] = r.concept;
    });
    roles.push({ role: p.role, locs, arcs: [] });
  }
  return { roles };
}

function buildSyntheticLabelsFromViewer(
  parts: Array<{ role: string; rows: Array<{ concept: string; label: string }> }>
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const p of parts) {
    for (const r of p.rows) {
      const m = out.get(r.concept) ?? new Map<string, string>();
      if (!m.has(XBRL_STD_LABEL_ROLE)) m.set(XBRL_STD_LABEL_ROLE, r.label);
      out.set(r.concept, m);
    }
  }
  return out;
}

async function loadViewerPresentationFallback(baseUrl: string): Promise<{
  pres: PreParse;
  labs: Map<string, Map<string, string>>;
}> {
  const fsumXml = await fetchText(`${baseUrl}/FilingSummary.xml`);
  const reports = parseFilingSummarySheetReports(fsumXml);
  const parts: Array<{ role: string; rows: Array<{ concept: string; label: string }> }> = [];
  for (const rep of reports) {
    if (rep.reportType !== "Sheet") continue;
    if (rep.menuCategory !== "Statements") continue;
    if (!primaryStatementKind(rep.role)) continue;
    let raw: string;
    try {
      raw = await fetchText(`${baseUrl}/${rep.htmlFileName}`);
    } catch {
      continue;
    }
    const html = extractIdeaHtmlDocument(raw);
    const rows = parseIdeaViewerDefrefRows(html);
    if (rows.length < 2) continue;
    parts.push({ role: rep.role, rows });
  }
  if (parts.length === 0) {
    throw new Error(
      "XBRL presentation and label linkbases are missing from the filing folder, and SEC IDEA viewer tables could not be parsed (expected FilingSummary.xml plus R*.htm with defref anchors)."
    );
  }
  return {
    pres: buildSyntheticPresentationFromViewer(parts),
    labs: buildSyntheticLabelsFromViewer(parts),
  };
}

type InstanceParse = {
  contextPeriod: Map<string, { end: string; start: string | null }>;
  /** Count of xbrldi:explicitMember in context (0 = entity-wide, preferred for primary columns). */
  contextDimCount: Map<string, number>;
  /**
   * When the context's segment includes `srt:ProductOrServiceAxis`, the explicit member QName
   * (e.g. `tsla:EnergyGenerationAndStorageMember`); otherwise `null`.
   */
  contextProductOrServiceMember: Map<string, string | null>;
  unitMeasure: Map<string, string>;
  facts: Map<
    string,
    Array<{ contextRef: string; unitRef: string | null; value: number; decimals: number | null }>
  >;
  /** From `dei:CurrentFiscalYearEndDate` when present (e.g. Sep 30 FY). */
  fiscalYearEnd: FiscalYearEndMd | null;
};

function parseInstance(instanceXml: string, conceptSet: Set<string>): InstanceParse {
  const o = parser.parse(instanceXml) as any;
  const x = o["xbrli:xbrl"] ?? o["xbrl"] ?? o;

  const contextPeriod = new Map<string, { end: string; start: string | null }>();
  const contextDimCount = new Map<string, number>();
  const contextProductOrServiceMember = new Map<string, string | null>();
  for (const c of asArr(x["xbrli:context"] ?? x["context"])) {
    const id = c?.["@_id"];
    if (typeof id !== "string") continue;
    contextDimCount.set(id, explicitMemberCount(c));
    contextProductOrServiceMember.set(id, parseContextProductOrServiceMember(c));
    const period = c?.["xbrli:period"] ?? c?.["period"];
    const instant = period?.["xbrli:instant"] ?? period?.["instant"];
    const start = period?.["xbrli:startDate"] ?? period?.["startDate"];
    const end = period?.["xbrli:endDate"] ?? period?.["endDate"];
    const instantStr = typeof instant === "string" ? instant.trim() : typeof instant === "number" ? String(instant) : "";
    const endStr = typeof end === "string" ? end.trim() : typeof end === "number" ? String(end) : "";
    const startStr = typeof start === "string" ? start.trim() : typeof start === "number" ? String(start) : null;
    if (instantStr) {
      contextPeriod.set(id, { end: instantStr, start: null });
    } else if (endStr) {
      contextPeriod.set(id, { end: endStr, start: startStr });
    }
  }

  const unitMeasure = new Map<string, string>();
  for (const u of asArr(x["xbrli:unit"] ?? x["unit"])) {
    const id = u?.["@_id"];
    const measure = u?.["xbrli:measure"] ?? u?.["measure"];
    if (typeof id !== "string") continue;
    if (typeof measure === "string") unitMeasure.set(id, measure.trim());
  }

  const facts = new Map<string, Array<{ contextRef: string; unitRef: string | null; value: number; decimals: number | null }>>();

  const parseDecimalsAttr = (item: unknown): number | null => {
    if (!item || typeof item !== "object") return null;
    const raw = (item as Record<string, unknown>)["@_decimals"];
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const s = String(raw).trim().toUpperCase();
    if (s === "INF") return Number.POSITIVE_INFINITY;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };

  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (conceptSet.has(k)) {
        for (const item of asArr(v)) {
          if (isNilFact(item)) continue;
          const ctx = item?.["@_contextRef"];
          const unit = typeof item?.["@_unitRef"] === "string" ? item["@_unitRef"] : null;
          const num = numericFromXbrlFactItem(item);
          if (typeof ctx !== "string" || num === null) continue;
          const arr = facts.get(k) ?? [];
          arr.push({ contextRef: ctx, unitRef: unit, value: num, decimals: parseDecimalsAttr(item) });
          facts.set(k, arr);
        }
      } else if (typeof v === "object") {
        walk(v);
      }
    }
  };
  walk(x);

  const fyRaw =
    extractDeiCurrentFiscalYearEndFromParsedInstance(x) ?? extractDeiCurrentFiscalYearEndFromRawXml(instanceXml);
  const fiscalYearEnd = fyRaw ? parseDeiFiscalYearEndText(fyRaw) : null;

  return { contextPeriod, contextDimCount, contextProductOrServiceMember, unitMeasure, facts, fiscalYearEnd };
}

function scorePeriodForStatement(
  key: string,
  nodes: Array<{ concept: string; depth: number; preferredLabelRole: string | null }>,
  inst: InstanceParse
): number {
  let score = 0;
  for (const n of nodes) {
    const factList = inst.facts.get(n.concept) ?? [];
    for (const f of factList) {
      const p = inst.contextPeriod.get(f.contextRef);
      if (!p?.end) continue;
      if (periodKey(p.end, p.start) !== key) continue;
      const dim = inst.contextDimCount.get(f.contextRef) ?? 99;
      if (dim === 0) score += 3;
      else score += 1;
    }
  }
  return score;
}

/**
 * XBRL `decimals` attribute: larger numeric value = finer precision (e.g. -6 vs -8); `INF` is finest.
 * Facts missing `decimals` lose ties vs those that have it.
 */
function decimalsPrecisionRank(d: number | null): number {
  if (d === null) return Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(d)) return 1e18;
  return d;
}

/**
 * When SEC filings expose multiple facts for the same concept + period (e.g. different contexts that still look
 * consolidated), picking the first tie is arbitrary and often lands on the wrong magnitude. Prefer conservative
 * choices: smaller positive for typical expense/cost tags, larger positive for revenue-like tags, median for totals/NI.
 */
function tieBreakDuplicateFactValues(concept: string, values: number[]): number | null {
  const uniq = Array.from(new Set(values.filter((v) => Number.isFinite(v))));
  if (uniq.length === 0) return null;
  if (uniq.length === 1) return uniq[0]!;
  const c = concept.toLowerCase();

  if (/:sharebasedcompensation$/i.test(c) || /:allocatedsharebasedcompensationexpense$/i.test(c)) {
    const pos = uniq.filter((v) => v > 0);
    const neg = uniq.filter((v) => v < 0);
    return pos.length ? Math.min(...pos) : neg.length ? Math.max(...neg) : uniq.sort((a, b) => Math.abs(a) - Math.abs(b))[0]!;
  }
  const pos = uniq.filter((v) => v > 0);
  const neg = uniq.filter((v) => v < 0);

  if (/:assets$/i.test(c) || /liabilitiesandstockholdersequity$/i.test(c) || /stockholdersequity$/i.test(c)) {
    return pos.length ? Math.max(...pos) : uniq.sort((a, b) => Math.abs(b) - Math.abs(a))[0]!;
  }

  if (
    /netincome|profitloss$/i.test(c) ||
    /incomelossfromcontinuingoperationsbefore/i.test(c) ||
    /operatingincomeloss$/i.test(c) ||
    /earningsbefore/i.test(c)
  ) {
    const sorted = [...uniq].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  if (/\brevenue\b/i.test(c) || /\bsalesrevenue/i.test(c) || /\b(us-gaap:)?sales\b/i.test(c)) {
    return pos.length ? Math.max(...pos) : Math.max(...uniq);
  }

  if (/nonoperatingincomeexpense|otherincomeexpense|othernonoperatingincome/i.test(c)) {
    const sorted = [...uniq].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  if (
    /expense/i.test(c) ||
    /cost/i.test(c) ||
    /charge/i.test(c) ||
    /fee/i.test(c) ||
    /payment/i.test(c) ||
    /depreciation/i.test(c) ||
    /amortization/i.test(c) ||
    /impairment/i.test(c)
  ) {
    return pos.length ? Math.min(...pos) : neg.length ? Math.max(...neg) : uniq.sort((a, b) => Math.abs(a) - Math.abs(b))[0]!;
  }

  return uniq.sort((a, b) => Math.abs(b) - Math.abs(a))[0]!;
}

function pickValueForPeriod(
  candidates: Array<{ value: number; measure: string | null; dim: number; decimals?: number | null }>,
  concept: string
): number | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    const aud = a.measure?.toLowerCase().includes("usd") ? 0 : 1;
    const bud = b.measure?.toLowerCase().includes("usd") ? 0 : 1;
    if (aud !== bud) return aud - bud;
    if (a.dim !== b.dim) return a.dim - b.dim;
    return 0;
  });
  const best = sorted[0]!;
  const bestUsd = best.measure?.toLowerCase().includes("usd") ? 0 : 1;
  const pool = sorted.filter(
    (x) =>
      x.dim === best.dim &&
      (x.measure?.toLowerCase().includes("usd") ? 0 : 1) === bestUsd
  );
  const maxPrec = Math.max(...pool.map((p) => decimalsPrecisionRank(p.decimals ?? null)));
  const tier = pool.filter((p) => decimalsPrecisionRank(p.decimals ?? null) === maxPrec);
  const distinct = Array.from(new Set(tier.map((p) => p.value)));
  if (distinct.length <= 1) return tier[0]!.value;
  return tieBreakDuplicateFactValues(concept, tier.map((p) => p.value));
}

function resolveRawNumericFact(
  inst: InstanceParse,
  concept: string,
  targetPeriodKey: string
): number | null {
  const facts = inst.facts.get(concept) ?? [];
  const candidates: Array<{ value: number; measure: string | null; dim: number; decimals: number | null }> = [];
  for (const f of facts) {
    const p = inst.contextPeriod.get(f.contextRef);
    if (!p?.end) continue;
    if (periodKey(p.end, p.start) !== targetPeriodKey) continue;
    const measure = f.unitRef ? inst.unitMeasure.get(f.unitRef) ?? null : null;
    const dim = inst.contextDimCount.get(f.contextRef) ?? 99;
    candidates.push({ value: f.value, measure, dim, decimals: f.decimals });
  }
  return pickValueForPeriod(candidates, concept);
}

/**
 * For `_cal.xml` rollup checks: when **every** instance fact for this concept/period has a
 * `srt:ProductOrServiceAxis` member and there are multiple distinct members, sum the per-member
 * {@link pickValueForPeriod} results. Otherwise delegate to {@link resolveRawNumericFact}.
 *
 * Filers such as Tesla tag line items like `CostOfGoodsAndServicesSold` only on dimensional
 * contexts (energy, services, …); picking a single slice undercounts Σ(children) vs `CostOfRevenue`.
 *
 * When `_cal.xml` lists `AutomotiveRevenues` (or automotive COGS) as a **sibling** arc, the same tag
 * often also carries **automotive** `ProductOrServiceAxis` members — summing those again double-counts
 * automotive vs the sibling line. In that case we sum only **non-automotive** members.
 */
function rollupConceptLocalNorm(concept: string): string {
  const i = concept.lastIndexOf(":");
  return (i >= 0 ? concept.slice(i + 1) : concept).replace(/_/g, "").toLowerCase();
}

function rollupShouldOmitAutomotiveProductMembers(
  concept: string,
  rollupCtx: CalculationRollupResolveContext | undefined
): boolean {
  const sibs = rollupCtx?.calculationSiblingConcepts;
  if (!sibs?.length) return false;
  const sibsNorm = sibs.map(rollupConceptLocalNorm);
  const local = rollupConceptLocalNorm(concept);

  if (
    local.includes("revenuefromcontractwithcustomerexcludingassessedtax") &&
    sibsNorm.some((s) => s.includes("automotiverevenues"))
  ) {
    return true;
  }
  if (
    local.includes("costofgoodsandservicessold") &&
    sibsNorm.some((s) => s.includes("automotivecostofrevenues") || s.includes("automotivecostofrevenue"))
  ) {
    return true;
  }
  return false;
}

function productServiceMemberLooksAutomotive(mem: string): boolean {
  const n = mem.replace(/[:_-]/g, "").toLowerCase();
  return n.includes("automotive");
}

/**
 * For `_cal.xml` **Revenues** = `RevenueFromContract…` + `AutomotiveRevenues`, the contract line often
 * repeats energy **sub**-members (sales / leasing) alongside `EnergyGenerationAndStorageMember`. Only the
 * latter pairs with `ServicesAndOther…` as non-automotive segment totals.
 */
function productServiceMemberIsNonAutoRevenueSegmentTotal(mem: string): boolean {
  const n = mem.replace(/[:_-]/g, "").toLowerCase();
  if (n.includes("automotive")) return false;
  if (n.endsWith("servicesandothermember")) return true;
  return n.endsWith("energygenerationandstoragemember") && !n.includes("leasing") && !n.includes("sales");
}

function normalizeStatementLabelKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Map axis members that share a single printed caption (energy/storage segment COGS sub-lines) so rows
 * tagged with different `ProductOrServiceAxis` members still merge when QNames differ by period.
 */
function productServiceMemberPresentationMergeKey(member: string, concept: string): string {
  const mn = member.replace(/[:_-]/g, "").toLowerCase();
  const cn = rollupConceptLocalNorm(concept);
  const costish =
    cn.includes("costofgoodsandservicessold") ||
    cn.includes("costofrevenue") ||
    (/cost/.test(cn) && /good|service|revenue/.test(cn));
  if (costish && mn.includes("energygenerationandstorage")) {
    return "__energy_generation_and_storage_cost__";
  }
  return member;
}

function nonNullPeriodCellCount(row: PresentedStatementRow, periodKeys: string[]): number {
  return periodKeys.filter((pk) => {
    const v = row.values[pk];
    return v !== null && v !== undefined && Number.isFinite(v);
  }).length;
}

/**
 * Fallback label when a concept is used in `_cal.xml` arithmetic but lacks a `_pre.xml` locator (no preferred label arc).
 */
function labelForStandaloneCalcConcept(labels: Map<string, Map<string, string>>, concept: string): string {
  const m = labels.get(concept);
  if (m?.size) {
    const std = "http://www.xbrl.org/2003/role/label";
    const v = m.get(std) ?? Array.from(m.values())[0];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const tail = concept.includes(":") ? concept.slice(concept.indexOf(":") + 1) : concept;
  return tail.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim() || concept;
}

function buildPresentedRowFromUnsegmentedConcept(params: {
  kind: "is" | "bs" | "cf";
  concept: string;
  label: string;
  depth: number;
  preferredLabelRole: string | null;
  inst: InstanceParse;
  periodsSorted: PresentedStatement["periods"];
}): PresentedStatementRow {
  const { kind, concept, label, depth, preferredLabelRole, inst, periodsSorted } = params;
  const outDisplay: Record<string, number | null> = {};
  const outRaw: Record<string, number | null> = {};
  const outNorm: Record<string, PeriodNormalizationMeta | null> = {};
  for (const p of periodsSorted) {
    outDisplay[p.key] = null;
    outRaw[p.key] = null;
    outNorm[p.key] = null;
  }

  const facts = inst.facts.get(concept) ?? [];
  const byPeriod = new Map<
    string,
    Array<{ value: number; measure: string | null; dim: number; decimals: number | null }>
  >();
  for (const f of facts) {
    const p = inst.contextPeriod.get(f.contextRef);
    if (!p?.end) continue;
    const k = periodKey(p.end, p.start);
    if (!Object.prototype.hasOwnProperty.call(outDisplay, k)) continue;
    const measure = f.unitRef ? inst.unitMeasure.get(f.unitRef) ?? null : null;
    const dim = inst.contextDimCount.get(f.contextRef) ?? 99;
    const arr = byPeriod.get(k) ?? [];
    arr.push({ value: f.value, measure, dim, decimals: f.decimals });
    byPeriod.set(k, arr);
  }
  for (const [k, arr] of Array.from(byPeriod.entries())) {
    const picked = pickValueForPeriod(arr, concept);
    outRaw[k] = picked;
    const norm = normalizeXbrlFactForStatementModel({
      kind,
      concept,
      label,
      preferredLabelRole,
      raw: picked,
    });
    outDisplay[k] = norm.display;
    outNorm[k] =
      picked !== null && Number.isFinite(picked) ? { rule: norm.rule, confidence: norm.confidence } : null;
  }

  return {
    concept,
    label,
    depth,
    preferredLabelRole,
    values: outDisplay,
    rawValues: outRaw,
    normalizationByPeriod: outNorm,
  };
}

/** `_cal.xml` children that filers tag but often omit from the primary CF `_pre.xml` tree. */
const CALC_GAP_INJECTION_BY_KIND: Record<
  "is" | "cf",
  readonly { parentConcept: string; matchParent?: RegExp }[]
> = {
  is: [{ parentConcept: "us-gaap:CostsAndExpenses" }],
  cf: [
    {
      parentConcept: "us-gaap:NetCashProvidedByUsedInOperatingActivities",
      matchParent: /NetCashProvidedByUsedInOperatingActivities(?:ContinuingOperations)?$/i,
    },
    {
      parentConcept: "us-gaap:NetCashProvidedByUsedInInvestingActivities",
      matchParent: /NetCashProvidedByUsedInInvestingActivities(?:ContinuingOperations)?$/i,
    },
    {
      parentConcept: "us-gaap:NetCashProvidedByUsedInFinancingActivities",
      matchParent: /NetCashProvidedByUsedInFinancingActivities(?:ContinuingOperations)?$/i,
    },
  ],
};

function findCalcGapInjectionParentIndex(
  rows: PresentedStatementRow[],
  spec: { parentConcept: string; matchParent?: RegExp },
  kind: "is" | "cf"
): number {
  const pickLast = kind === "cf";
  let lastExact = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.concept === spec.parentConcept) lastExact = i;
  }
  if (lastExact >= 0) return pickLast ? lastExact : rows.findIndex((r) => r.concept === spec.parentConcept);
  if (!spec.matchParent) return -1;
  let lastMatch = -1;
  for (let i = 0; i < rows.length; i++) {
    if (spec.matchParent!.test(rows[i]!.concept)) lastMatch = i;
  }
  if (lastMatch >= 0) return lastMatch;
  return -1;
}

function rowHasFiniteValueInAnyPeriod(row: PresentedStatementRow, periodKeys: string[]): boolean {
  return periodKeys.some((pk) => {
    const v = row.values[pk];
    return v !== null && v !== undefined && Number.isFinite(v);
  });
}

function xbrlConceptLocalName(concept: string): string {
  const i = concept.indexOf(":");
  return i >= 0 ? concept.slice(i + 1) : concept;
}

function rowIndicesMatchingConcept(rows: PresentedStatementRow[], concept: string): number[] {
  const local = xbrlConceptLocalName(concept);
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i]!.concept;
    if (c === concept || xbrlConceptLocalName(c) === local) out.push(i);
  }
  return out;
}

function rowNonZeroValueCount(row: PresentedStatementRow, periodKeys: string[]): number {
  return periodKeys.filter((pk) => {
    const v = row.values[pk];
    return v !== null && v !== undefined && Number.isFinite(v) && v !== 0;
  }).length;
}

function pickBestPresentedRowMatch(
  rows: PresentedStatementRow[],
  indices: number[],
  periodKeys: string[]
): PresentedStatementRow {
  let best = rows[indices[0]!]!;
  let bestNonZero = -1;
  let bestFinite = -1;
  for (const i of indices) {
    const r = rows[i]!;
    const nonZero = rowNonZeroValueCount(r, periodKeys);
    const finite = periodKeys.filter((pk) => Number.isFinite(r.values[pk])).length;
    if (
      nonZero > bestNonZero ||
      (nonZero === bestNonZero && finite > bestFinite) ||
      (nonZero === bestNonZero && finite === bestFinite && (r.preferredLabelRole?.length ?? 0) > (best.preferredLabelRole?.length ?? 0))
    ) {
      bestNonZero = nonZero;
      bestFinite = finite;
      best = r;
    }
  }
  return best;
}

function preferredLabelRoleForConcept(
  nodes: ReadonlyArray<{ concept: string; preferredLabelRole: string | null }>,
  concept: string
): string | null {
  for (const n of nodes) {
    if (n.concept === concept) return n.preferredLabelRole;
  }
  const local = xbrlConceptLocalName(concept);
  for (const n of nodes) {
    if (xbrlConceptLocalName(n.concept) === local) return n.preferredLabelRole;
  }
  return null;
}

/** All `_cal.xml` arcs grouped by parent (not limited to face-statement roles). */
function groupCalcArcsByParentUnfiltered(arcs: CalculationArcRow[]): Map<string, CalculationArcRow[]> {
  const byParent = new Map<string, CalculationArcRow[]>();
  const seen = new Set<string>();
  for (const a of arcs) {
    const dedupe = `${a.parentConcept}\t${a.childConcept}\t${a.weight}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const arr = byParent.get(a.parentConcept) ?? [];
    arr.push(a);
    byParent.set(a.parentConcept, arr);
  }
  return byParent;
}

/** Insert `_cal.xml` arithmetic children missing from the primary presentation tree (face grid). */
function injectMissingCalculationChildren(params: {
  kind: "is" | "cf";
  rows: PresentedStatementRow[];
  calcArcs: CalculationArcRow[];
  inst: InstanceParse;
  periodsSorted: PresentedStatement["periods"];
  labels: Map<string, Map<string, string>>;
  presentationNodes?: ReadonlyArray<{ concept: string; preferredLabelRole: string | null }>;
}): PresentedStatementRow[] {
  const { kind, rows: incoming, calcArcs, inst, periodsSorted, labels: labelMap, presentationNodes } = params;
  if (incoming.length === 0 || calcArcs.length === 0 || !labelMap) return incoming;

  const byParent = groupCalcArcsByParentUnfiltered(calcArcs);
  const periodKeys = periodsSorted.map((p) => p.key);
  let rows = [...incoming];

  for (const spec of CALC_GAP_INJECTION_BY_KIND[kind] ?? []) {
    const arcs =
      byParent.get(spec.parentConcept) ??
      Array.from(byParent.entries()).find(([p]) => spec.matchParent?.test(p))?.[1];
    if (!arcs?.length) continue;
    const ix = findCalcGapInjectionParentIndex(rows, spec, kind);
    if (ix < 0) continue;

    const sortedArcs = [...arcs].sort((a, b) => a.order - b.order || a.childConcept.localeCompare(b.childConcept));
    const toInsert: PresentedStatementRow[] = [];
    const childDepth = Math.max(0, rows[ix]!.depth + 1);

    for (const arc of sortedArcs) {
      const c = arc.childConcept;
      const lbl = labelForStandaloneCalcConcept(labelMap, c);
      const prefRole =
        presentationNodes !== undefined ? preferredLabelRoleForConcept(presentationNodes, c) : null;
      const built = buildPresentedRowFromUnsegmentedConcept({
        kind,
        concept: c,
        label: lbl,
        depth: childDepth,
        preferredLabelRole: prefRole,
        inst,
        periodsSorted,
      });
      const builtHasValues = rowHasFiniteValueInAnyPeriod(built, periodKeys);
      if (kind === "cf") {
        const matchingIdxs = rowIndicesMatchingConcept(rows, c);
        if (matchingIdxs.length > 0) {
          const prior = pickBestPresentedRowMatch(rows, matchingIdxs, periodKeys);
        const priorHasValues = rowHasFiniteValueInAnyPeriod(prior, periodKeys);
        const priorHasNonZero = rowNonZeroValueCount(prior, periodKeys) > 0;
        if (!builtHasValues && !priorHasValues) continue;
        const useBuiltValues = builtHasValues && (!priorHasNonZero || !priorHasValues);
        const enriched: PresentedStatementRow = {
          ...prior,
          concept: c,
          label: prior.label?.trim() ? prior.label : built.label,
          depth: childDepth,
          preferredLabelRole: prior.preferredLabelRole ?? prefRole,
          ...(useBuiltValues
            ? {
                values: built.values,
                rawValues: built.rawValues,
                normalizationByPeriod: built.normalizationByPeriod,
              }
            : {}),
        };
          rows = rows.filter((_, i) => !matchingIdxs.includes(i));
          toInsert.push(enriched);
          continue;
        }
        if (!builtHasValues) continue;
        toInsert.push(built);
        continue;
      }

      const existingIx = rows.findIndex((r) => r.concept === c);
      if (existingIx >= 0) {
        const prior = rows[existingIx]!;
        const priorHasValues = rowHasFiniteValueInAnyPeriod(prior, periodKeys);
        if (!builtHasValues && !priorHasValues) continue;
        const needsValues = !priorHasValues && builtHasValues;
        const needsReorder = existingIx > ix;
        if (needsValues || needsReorder) {
          const enriched: PresentedStatementRow = needsValues
            ? {
                ...prior,
                label: prior.label?.trim() ? prior.label : built.label,
                depth: childDepth,
                values: built.values,
                rawValues: built.rawValues,
                normalizationByPeriod: built.normalizationByPeriod,
              }
            : { ...prior, depth: childDepth };
          rows = rows.filter((_, i) => i !== existingIx);
          toInsert.push(enriched);
        }
        continue;
      }
      if (!builtHasValues) continue;
      toInsert.push(built);
    }
    if (toInsert.length === 0) continue;
    rows = [...rows.slice(0, ix), ...toInsert, ...rows.slice(ix)];
  }

  return rows;
}

function cashFlowCalcSectionBounds(
  rows: PresentedStatementRow[],
  spec: (typeof CALC_GAP_INJECTION_BY_KIND.cf)[number]
): { fromIx: number; parentIx: number } | null {
  const parentIx = findCalcGapInjectionParentIndex(rows, spec, "cf");
  if (parentIx < 0) return null;
  let fromIx = -1;
  if (/Investing/i.test(spec.parentConcept)) {
    const opSpec = CALC_GAP_INJECTION_BY_KIND.cf[0]!;
    const opIx = findCalcGapInjectionParentIndex(rows, opSpec, "cf");
    if (opIx >= 0) fromIx = opIx;
  } else if (/Financing/i.test(spec.parentConcept)) {
    const invSpec = CALC_GAP_INJECTION_BY_KIND.cf[1]!;
    const invIx = findCalcGapInjectionParentIndex(rows, invSpec, "cf");
    if (invIx >= 0) fromIx = invIx;
  }
  return { fromIx, parentIx };
}

/**
 * Filers sometimes hang calc-linked CF children on `StatementOfCashFlowsAbstract` (presentation order 1)
 * while `_cal.xml` rolls them into investing/financing. Move those rows into the correct section band.
 */
function relocateMisplacedCashFlowCalcLines(params: {
  rows: PresentedStatementRow[];
  calcArcs: CalculationArcRow[];
  inst: InstanceParse;
  periodsSorted: PresentedStatement["periods"];
  labels: Map<string, Map<string, string>>;
  presentationNodes?: ReadonlyArray<{ concept: string; preferredLabelRole: string | null }>;
}): PresentedStatementRow[] {
  const { rows: incoming, calcArcs, inst, periodsSorted, labels: labelMap, presentationNodes } = params;
  if (incoming.length === 0 || calcArcs.length === 0) return incoming;

  const byParent = groupCalcArcsByParentUnfiltered(calcArcs);
  const periodKeys = periodsSorted.map((p) => p.key);
  let rows = [...incoming];

  for (const spec of CALC_GAP_INJECTION_BY_KIND.cf ?? []) {
    const bounds = cashFlowCalcSectionBounds(rows, spec);
    if (!bounds) continue;
    const arcs =
      byParent.get(spec.parentConcept) ??
      Array.from(byParent.entries()).find(([p]) => spec.matchParent?.test(p))?.[1];
    if (!arcs?.length) continue;

    const { fromIx, parentIx } = bounds;
    const childDepth = Math.max(0, rows[parentIx]!.depth + 1);
    const toInsert: PresentedStatementRow[] = [];

    for (const arc of arcs) {
      const c = arc.childConcept;
      const matchingIdxs = rowIndicesMatchingConcept(rows, c);
      if (matchingIdxs.length === 0) continue;
      const misplaced = matchingIdxs.some((i) => i <= fromIx || i >= parentIx);
      if (!misplaced) continue;

      const lbl = labelForStandaloneCalcConcept(labelMap, c);
      const prefRole =
        presentationNodes !== undefined ? preferredLabelRoleForConcept(presentationNodes, c) : null;
      const built = buildPresentedRowFromUnsegmentedConcept({
        kind: "cf",
        concept: c,
        label: lbl,
        depth: childDepth,
        preferredLabelRole: prefRole,
        inst,
        periodsSorted,
      });
      const builtHasValues = rowHasFiniteValueInAnyPeriod(built, periodKeys);
      const prior = pickBestPresentedRowMatch(rows, matchingIdxs, periodKeys);
      const priorHasValues = rowHasFiniteValueInAnyPeriod(prior, periodKeys);
      const priorHasNonZero = rowNonZeroValueCount(prior, periodKeys) > 0;
      if (!builtHasValues && !priorHasValues) continue;
      const useBuiltValues = builtHasValues && (!priorHasNonZero || !priorHasValues);
      const enriched: PresentedStatementRow = {
        ...prior,
        concept: c,
        label: prior.label?.trim() ? prior.label : built.label,
        depth: childDepth,
        preferredLabelRole: prior.preferredLabelRole ?? prefRole,
        ...(useBuiltValues
          ? {
              values: built.values,
              rawValues: built.rawValues,
              normalizationByPeriod: built.normalizationByPeriod,
            }
          : {}),
      };
      rows = rows.filter((_, i) => !matchingIdxs.includes(i));
      toInsert.push(enriched);
    }

    if (toInsert.length > 0) {
      rows = [...rows.slice(0, parentIx), ...toInsert, ...rows.slice(parentIx)];
    }
  }

  return rows;
}

/**
 * Merge axis-expanded rows that share depth + `ProductOrServiceAxis` member + caption but use **different**
 * QNames with **disjoint** period coverage (filers sometimes substitute an extension cost/revenue element for
 * some columns only — e.g. TSLA energy COGS: `us-gaap:CostOfGoodsAndServicesSold` vs extension segment cost).
 */
function mergeAxisExpandedRowsWithDisjointPeriods(
  rows: PresentedStatementRow[],
  periodKeys: string[]
): PresentedStatementRow[] {
  if (rows.length <= 1 || periodKeys.length === 0) return rows;

  const bucketFor = (r: PresentedStatementRow): string | null => {
    const mem = r.productOrServiceMember;
    if (mem === null || mem === undefined) return null;
    const mergeMem = productServiceMemberPresentationMergeKey(mem, r.concept);
    return `${r.depth}\0${mergeMem}\0${normalizeStatementLabelKey(r.label)}`;
  };

  const buckets = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const k = bucketFor(rows[i]!);
    if (k === null) continue;
    const arr = buckets.get(k) ?? [];
    arr.push(i);
    buckets.set(k, arr);
  }

  const absorbed = new Set<number>();

  const preferConcept = (a: string, b: string): string => {
    const score = (c: string) => {
      const isStd = c.startsWith("us-gaap:") || c.startsWith("ifrs-full:");
      const tail = c.includes(":") ? c.slice(c.indexOf(":") + 1) : c;
      return (isStd ? 1_000_000 : 0) + Math.min(tail.length, 9_999);
    };
    return score(a) >= score(b) ? a : b;
  };

  for (const idxs of buckets.values()) {
    if (idxs.length < 2) continue;

    let conflict = false;
    for (let a = 0; a < idxs.length && !conflict; a++) {
      for (let b = a + 1; b < idxs.length && !conflict; b++) {
        for (const pk of periodKeys) {
          const va = rows[idxs[a]!]!.values[pk];
          const vb = rows[idxs[b]!]!.values[pk];
          const fa = va !== null && va !== undefined && Number.isFinite(va);
          const fb = vb !== null && vb !== undefined && Number.isFinite(vb);
          if (fa && fb) {
            conflict = true;
            break;
          }
        }
      }
    }
    if (conflict) continue;

    const ordered = [...idxs].sort((a, b) => a - b);
    const keep = ordered[0]!;
    const merged: PresentedStatementRow = {
      ...rows[keep]!,
      values: { ...rows[keep]!.values },
      rawValues: { ...rows[keep]!.rawValues },
      normalizationByPeriod: { ...rows[keep]!.normalizationByPeriod },
    };

    let repConcept = merged.concept;
    let repLabel = merged.label;
    let repDepth = merged.depth;
    let repNn = nonNullPeriodCellCount(merged, periodKeys);

    for (const i of ordered.slice(1)) {
      const o = rows[i]!;
      for (const pk of periodKeys) {
        const mv = merged.values[pk];
        const hasM = mv !== null && mv !== undefined && Number.isFinite(mv);
        const ov = o.values[pk];
        const hasO = ov !== null && ov !== undefined && Number.isFinite(ov);
        if (!hasM && hasO) {
          merged.values[pk] = o.values[pk];
          merged.rawValues[pk] = o.rawValues[pk];
          merged.normalizationByPeriod[pk] = o.normalizationByPeriod[pk];
        }
      }
      const onn = nonNullPeriodCellCount(o, periodKeys);
      if (onn > repNn) {
        repNn = onn;
        repLabel = o.label;
        repDepth = o.depth;
      }
      repConcept = preferConcept(repConcept, o.concept);
      absorbed.add(i);
    }
    merged.concept = repConcept;
    merged.label = repLabel;
    merged.depth = repDepth;
    rows[keep] = merged;
  }

  return rows.filter((_, i) => !absorbed.has(i));
}

/** Issuer extension concepts used as alternate tags for the same `CostOfGoodsAndServicesSold` slice. */
function segmentCostExtensionCandidateForCogsSupplement(concept: string): boolean {
  const pe = concept.indexOf(":");
  const prefix = pe >= 0 ? concept.slice(0, pe) : "";
  if (prefix === "us-gaap" || prefix === "ifrs-full") return false;
  const o = rollupConceptLocalNorm(concept);
  if (!o.includes("cost")) return false;
  if (
    /research|development|contractwithcustomer|salesandmarketing|generalandadmin|interest|incometax|deferredtax/i.test(
      o
    )
  ) {
    return false;
  }
  return true;
}

function supplementalDimensionalFactsForCostOfGoodsSold(
  inst: InstanceParse,
  primaryConcept: string,
  rollupCtx?: CalculationRollupResolveContext
): Array<{ contextRef: string; unitRef: string | null; value: number; decimals: number | null }> {
  if (rollupConceptLocalNorm(primaryConcept) !== "costofgoodsandservicessold") return [];

  const siblingConcepts = rollupCtx?.calculationSiblingConcepts ?? [];
  const siblingSet = new Set(siblingConcepts.filter((c) => c !== primaryConcept));

  const primaryFacts = inst.facts.get(primaryConcept) ?? [];
  const ownedDim = new Set<string>();
  for (const f of primaryFacts) {
    const p = inst.contextPeriod.get(f.contextRef);
    if (!p?.end) continue;
    const pk = periodKey(p.end, p.start);
    const mem = inst.contextProductOrServiceMember.get(f.contextRef);
    if (mem === undefined || mem === null) continue;
    ownedDim.add(`${pk}\0${mem}`);
  }

  const out: Array<{ contextRef: string; unitRef: string | null; value: number; decimals: number | null }> = [];
  for (const [c, facts] of inst.facts) {
    if (c === primaryConcept) continue;
    if (siblingSet.has(c)) continue;
    if (!segmentCostExtensionCandidateForCogsSupplement(c)) continue;
    for (const f of facts) {
      const p = inst.contextPeriod.get(f.contextRef);
      if (!p?.end) continue;
      const pk = periodKey(p.end, p.start);
      const mem = inst.contextProductOrServiceMember.get(f.contextRef);
      if (mem === undefined || mem === null) continue;
      if (ownedDim.has(`${pk}\0${mem}`)) continue;
      out.push({
        contextRef: f.contextRef,
        unitRef: f.unitRef,
        value: f.value,
        decimals: f.decimals,
      });
    }
  }
  return out;
}

function resolveRawNumericFactForCalculationRollup(
  inst: InstanceParse,
  concept: string,
  targetPeriodKey: string,
  rollupCtx?: CalculationRollupResolveContext
): number | null {
  const primaryFacts = inst.facts.get(concept) ?? [];
  const extra =
    rollupConceptLocalNorm(concept) === "costofgoodsandservicessold"
      ? supplementalDimensionalFactsForCostOfGoodsSold(inst, concept, rollupCtx)
      : [];
  const facts = primaryFacts.concat(extra);
  type Cand = { value: number; measure: string | null; dim: number; decimals: number | null };
  const tagged: Array<{ cand: Cand; mem: string | null }> = [];
  for (const f of facts) {
    const p = inst.contextPeriod.get(f.contextRef);
    if (!p?.end) continue;
    if (periodKey(p.end, p.start) !== targetPeriodKey) continue;
    const measure = f.unitRef ? inst.unitMeasure.get(f.unitRef) ?? null : null;
    const dim = inst.contextDimCount.get(f.contextRef) ?? 99;
    const memRaw = inst.contextProductOrServiceMember.get(f.contextRef);
    const mem = memRaw === undefined ? null : memRaw;
    tagged.push({
      cand: { value: f.value, measure, dim, decimals: f.decimals },
      mem,
    });
  }
  if (tagged.length === 0) return null;
  const omitAutoMembers = rollupShouldOmitAutomotiveProductMembers(concept, rollupCtx);
  const localNormForRollup = rollupConceptLocalNorm(concept);
  /**
   * `_cal.xml` **GrossProfit** rolls **face** totals (`RevenueFromContract… − CostOfRevenue`). Those QNames
   * also appear on segment / `ProductOrServiceAxis` matrices; summing every member double-counts (e.g.
   * ~$55B “revenue” vs ~$19B consolidated for the same quarter). Use the same single-fact pick as
   * {@link resolveRawNumericFact} unless we need the automotiveOverlap slice logic below.
   */
  if (
    !omitAutoMembers &&
    (localNormForRollup.includes("revenuefromcontractwithcustomerexcludingassessedtax") ||
      localNormForRollup === "costofrevenue")
  ) {
    return resolveRawNumericFact(inst, concept, targetPeriodKey);
  }
  // Filings may repeat the same concept on unsegmented contexts (mem null) alongside
  // `ProductOrServiceAxis` slices. Prefer explicit slices whenever they exist and the instance
  // is mixed consolidated + dimensional, or when sibling arcs require automotive slice omission.
  const dimTagged = tagged.filter((t) => t.mem !== null);
  /**
   * Sum only explicit `ProductOrServiceAxis` slices when automotive sibling-arc logic
   * requires it (`omitAutoMembers`). Otherwise, if the instance has **both** consolidated
   * (unsegmented) and segment facts, prefer {@link resolveRawNumericFact} below — segment
   * rows alone often **do not** add to the printed total (e.g. LUMN `Revenues` rollup was
   * ~$17.9B from segments while the face line was ~$20.7B).
   */
  const rollupTagged =
    dimTagged.length > 0 && omitAutoMembers ? dimTagged : tagged;
  if (rollupTagged.some((t) => t.mem === null)) {
    return resolveRawNumericFact(inst, concept, targetPeriodKey);
  }
  const strictNonAutoRevenueSlices =
    omitAutoMembers && localNormForRollup.includes("revenuefromcontractwithcustomerexcludingassessedtax");
  const perMember = new Map<string, Cand[]>();
  for (const t of rollupTagged) {
    if (omitAutoMembers && t.mem !== null && productServiceMemberLooksAutomotive(t.mem)) continue;
    if (
      strictNonAutoRevenueSlices &&
      t.mem !== null &&
      !productServiceMemberIsNonAutoRevenueSegmentTotal(t.mem)
    )
      continue;
    const arr = perMember.get(t.mem!) ?? [];
    arr.push(t.cand);
    perMember.set(t.mem!, arr);
  }
  if (perMember.size === 0) {
    return resolveRawNumericFact(inst, concept, targetPeriodKey);
  }
  if (perMember.size === 1) {
    const only = [...perMember.values()][0]!;
    return pickValueForPeriod(only, concept);
  }
  let sum = 0;
  for (const arr of perMember.values()) {
    const v = pickValueForPeriod(arr, concept);
    if (v !== null && Number.isFinite(v)) sum += v;
  }
  return sum;
}

function resolveDisplayNumericFact(
  inst: InstanceParse,
  concept: string,
  targetPeriodKey: string,
  kind: "is" | "bs" | "cf"
): number | null {
  const picked = resolveRawNumericFact(inst, concept, targetPeriodKey);
  return normalizeXbrlFactForStatementModel({
    kind,
    concept,
    label: "",
    preferredLabelRole: null,
    raw: picked,
  }).display;
}

function buildTree(role: PreParse["roles"][number], labels: Map<string, Map<string, string>>) {
  const children = new Map<string, Array<{ to: string; order: number; preferredLabel: string | null }>>();
  const incoming = new Set<string>();
  for (const a of role.arcs) {
    const arr = children.get(a.from) ?? [];
    arr.push({ to: a.to, order: a.order, preferredLabel: a.preferredLabel ?? null });
    children.set(a.from, arr);
    incoming.add(a.to);
  }
  for (const arr of Array.from(children.values())) arr.sort((a, b) => a.order - b.order);

  const roots = Array.from(Object.keys(role.locs)).filter((lbl) => !incoming.has(lbl));

  const nodes: Array<{ concept: string; depth: number; preferredLabelRole: string | null }> = [];
  const seen = new Set<string>();

  const dfs = (locLabel: string, depth: number, prefRole: string | null) => {
    const concept = role.locs[locLabel];
    if (!concept) return;
    const key = `${locLabel}::${depth}`;
    if (seen.has(key)) return;
    seen.add(key);
    nodes.push({ concept, depth, preferredLabelRole: prefRole });
    for (const ch of children.get(locLabel) ?? []) {
      dfs(ch.to, depth + 1, ch.preferredLabel);
    }
  };

  for (const r of roots) dfs(r, 0, null);

  // pick labels
  const labelFor = (concept: string, prefRole: string | null) => {
    const m = labels.get(concept);
    if (!m) return concept;
    if (prefRole && m.get(prefRole)) return m.get(prefRole)!;
    const std = "http://www.xbrl.org/2003/role/label";
    return m.get(std) ?? Array.from(m.values())[0] ?? concept;
  };

  return nodes.map((n) => ({ ...n, label: labelFor(n.concept, n.preferredLabelRole) }));
}

async function loadPresentedStatementsValidationContext(params: {
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
}): Promise<AsPresentedValidationContext> {
  const tickerCikNum = parseInt(params.cik.replace(/\D/g, ""), 10);
  if (!Number.isFinite(tickerCikNum) || tickerCikNum <= 0) throw new Error("Invalid CIK");

  const acc = params.accessionNumber;
  const accClean = accNoDashes(acc);
  if (!accClean) throw new Error("Invalid accession number");

  /** Try issuer CIK first; fall back to accession-prefix CIK (e.g. GOOG predecessor `0001288776-…` on Alphabet ticker). */
  const accessionFilerCik = parseFilerCikFromAccession(acc);
  const accessionCikNum =
    accessionFilerCik !== null ? parseInt(accessionFilerCik.replace(/\D/g, ""), 10) : NaN;
  const cikPathCandidates: number[] = [];
  for (const n of [
    tickerCikNum,
    Number.isFinite(accessionCikNum) && accessionCikNum > 0 ? accessionCikNum : null,
  ]) {
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) continue;
    if (!cikPathCandidates.includes(n)) cikPathCandidates.push(n);
  }

  let idx: unknown;
  let cikNum = tickerCikNum;
  let indexErr: Error | null = null;
  for (const c of cikPathCandidates) {
    try {
      idx = await fetchJson(`https://www.sec.gov/Archives/edgar/data/${c}/${accClean}/index.json`);
      cikNum = c;
      indexErr = null;
      break;
    } catch (e) {
      indexErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  if (indexErr !== null) throw indexErr;
  const items = normalizeIndexItems(idx);
  const namesFlat = items.map((i) => (i.name ?? "").trim()).filter(Boolean);

  let namesExpanded = namesFlat;
  let picked = findBestXbrlFiles(namesExpanded);
  const indexPageBase = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}`;
  const canonicalFolderCikFromHtml = await tryCanonicalArtifactFolderCikFromFilingIndexHtml(
    indexPageBase,
    acc,
    accClean,
    namesFlat,
  );
  const artifactFolderCandidates = uniquePositiveCikCandidates(
    canonicalFolderCikFromHtml,
    Number.isFinite(accessionCikNum) && accessionCikNum > 0 ? accessionCikNum : null,
    cikNum,
    tickerCikNum,
  );
  const probeName =
    picked.pre ??
    picked.lab ??
    picked.instance ??
    namesFlat.find((n) => /\.zip$/i.test(n) && /xbrl/i.test(n)) ??
    namesFlat.find((n) => /^filingsummary\.xml$/i.test(n)) ??
    null;
  if (!probeName) {
    throw new Error(SEC_XBRL_FILING_NO_XBRL_ARTIFACTS_MESSAGE);
  }
  const artifactFolderCik = await probeSecArtifactFolderCik(artifactFolderCandidates, accClean, probeName);
  const base = `https://www.sec.gov/Archives/edgar/data/${artifactFolderCik}/${accClean}`;

  if (!picked.pre || !picked.lab) {
    namesExpanded = await expandIndexNamesWithZipBasenames(base, namesFlat);
    picked = findBestXbrlFiles(namesExpanded);
  }

  let pres: PreParse;
  let labs: Map<string, Map<string, string>>;
  let instanceXml: string;

  let calculationLinkbaseLoaded = false;
  let calcArcs: CalculationArcRow[] = [];
  const loadCalcIfAvailable = async () => {
    if (!picked.cal) return;
    try {
      const calXml = await fetchText(`${base}/${picked.cal}`);
      calcArcs = parseCalculationLinkbase(calXml);
      calculationLinkbaseLoaded = true;
    } catch {
      calcArcs = [];
      calculationLinkbaseLoaded = false;
    }
  };

  if (picked.pre && picked.lab && picked.instance) {
    await loadCalcIfAvailable();
    const preXml = await fetchText(`${base}/${picked.pre}`);
    const labXml = await fetchText(`${base}/${picked.lab}`);
    instanceXml = await fetchText(`${base}/${picked.instance}`);
    pres = parsePresentation(preXml);
    labs = parseLabels(labXml);
  } else if (picked.instance) {
    await loadCalcIfAvailable();
    instanceXml = await fetchText(`${base}/${picked.instance}`);
    const v = await loadViewerPresentationFallback(base);
    pres = v.pres;
    labs = v.labs;
  } else {
    throw new Error("XBRL instance document not found for this filing (no *_htm.xml or non-linkbase .xml in the index).");
  }

  // Build concept set: presentation tree ∪ calculation link (so rollups can resolve children off the face).
  const conceptSet = new Set<string>();
  for (const r of pres.roles) {
    for (const locLabel of Object.keys(r.locs)) conceptSet.add(r.locs[locLabel]!);
  }
  conceptsReferencedInCalculationArcs(calcArcs).forEach((c) => conceptSet.add(c));

  const inst = parseInstance(instanceXml, conceptSet);
  const financialFiler = isFinancialServicesFromInstanceXml(instanceXml);

  type PrimaryCandidate = {
    kind: "is" | "bs" | "cf";
    selectionPriority: number;
    density: number;
    rowsWithValues: number;
    statement: PresentedStatement;
  };
  const primaryCandidates: PrimaryCandidate[] = [];

  for (const r of pres.roles) {
    const kind = primaryStatementKind(r.role);
    if (!kind) continue;

    const nodesAll = buildTree(r, labs);
    const nodesUniq =
      kind === "bs"
        ? nodesAll.filter((n) => !isBalanceSheetShareCountRow(inst, n.concept))
        : nodesAll;
    const nodes = nodesUniq;
    const statementTitle = displayTitleForPrimaryKind(kind);

    // Collect periods from facts used in this statement.
    const periodMap = new Map<string, { end: string; start: string | null }>();
    for (const n of nodes) {
      const facts = inst.facts.get(n.concept) ?? [];
      for (const f of facts) {
        const p = inst.contextPeriod.get(f.contextRef);
        if (!p?.end) continue;
        const k = periodKey(p.end, p.start);
        periodMap.set(k, p);
      }
    }

    const scored = Array.from(periodMap.entries()).map(([k, p]) => ({
      key: k,
      ...p,
      score: scorePeriodForStatement(k, nodes, inst),
    }));
    const filtered = filterPeriodEntriesForStatementTitle(scored, statementTitle);
    const withData = filtered.filter((e) => e.score > 0);
    const pool = withData.length > 0 ? withData : filtered;
    const chrono = sortPeriodsOldestFirst(pool);
    const capped =
      chrono.length > MAX_STATEMENT_PERIODS ? chrono.slice(-MAX_STATEMENT_PERIODS) : chrono;
    const periodsSorted = assignPeriodDisplayFields(capped, kind, inst.fiscalYearEnd);

    const nodesForRows = expandStatementNodesForProductServiceAxis(
      nodes,
      r,
      inst,
      periodsSorted.map((p) => p.key),
      labs
    );

    let rows: PresentedStatementRow[] = nodesForRows.map((n) => {
      const facts = inst.facts.get(n.concept) ?? [];
      const outDisplay: Record<string, number | null> = {};
      const outRaw: Record<string, number | null> = {};
      const outNorm: Record<string, PeriodNormalizationMeta | null> = {};
      for (const p of periodsSorted) {
        outDisplay[p.key] = null;
        outRaw[p.key] = null;
        outNorm[p.key] = null;
      }

      const byPeriod = new Map<
        string,
        Array<{ value: number; measure: string | null; dim: number; decimals: number | null }>
      >();
      for (const f of facts) {
        const p = inst.contextPeriod.get(f.contextRef);
        if (!p?.end) continue;
        const k = periodKey(p.end, p.start);
        if (!Object.prototype.hasOwnProperty.call(outDisplay, k)) continue;
        if (n.productOrServiceMember !== null) {
          const mem = inst.contextProductOrServiceMember.get(f.contextRef);
          if (mem !== n.productOrServiceMember) continue;
        }
        const measure = f.unitRef ? inst.unitMeasure.get(f.unitRef) ?? null : null;
        const dim = inst.contextDimCount.get(f.contextRef) ?? 99;
        const arr = byPeriod.get(k) ?? [];
        arr.push({ value: f.value, measure, dim, decimals: f.decimals });
        byPeriod.set(k, arr);
      }
      for (const [k, arr] of Array.from(byPeriod.entries())) {
        const picked = pickValueForPeriod(arr, n.concept);
        outRaw[k] = picked;
        const norm = normalizeXbrlFactForStatementModel({
          kind,
          concept: n.concept,
          label: n.label,
          preferredLabelRole: n.preferredLabelRole,
          raw: picked,
        });
        outDisplay[k] = norm.display;
        outNorm[k] =
          picked !== null && Number.isFinite(picked)
            ? { rule: norm.rule, confidence: norm.confidence }
            : null;
      }

      return {
        concept: n.concept,
        label: n.label,
        depth: n.depth,
        preferredLabelRole: n.preferredLabelRole,
        ...(n.productOrServiceMember !== null ? { productOrServiceMember: n.productOrServiceMember } : {}),
        values: outDisplay,
        rawValues: outRaw,
        normalizationByPeriod: outNorm,
      };
    });

    if ((kind === "is" || kind === "cf") && calcArcs.length > 0) {
      rows = injectMissingCalculationChildren({
        kind,
        rows,
        calcArcs,
        inst,
        periodsSorted,
        labels: labs,
        presentationNodes: nodesForRows,
      });
      if (kind === "cf") {
        rows = relocateMisplacedCashFlowCalcLines({
          rows,
          calcArcs,
          inst,
          periodsSorted,
          labels: labs,
          presentationNodes: nodesForRows,
        });
      }
    }

    if (rows.length === 0 || periodsSorted.length === 0) continue;

    const periodKeys = periodsSorted.map((p) => p.key);
    const rowsCoalesced =
      kind === "bs" ? coalesceDuplicateBalanceSheetConceptRows(rows, periodKeys) : rows;
    const rowsPrefixMerged =
      kind === "bs" ? mergeTaxonomyPrefixDuplicateBalanceSheetRows(rowsCoalesced, periodKeys) : rowsCoalesced;
    let rowsForStatement =
      kind === "bs" ? dedupeBalanceSheetNearDuplicateCaptionRows(rowsPrefixMerged, periodKeys) : rowsPrefixMerged;
    if (kind === "bs") {
      rowsForStatement = mergeBalanceSheetPeriodCompatibleCaptionDuplicates(rowsForStatement, periodKeys);
      rowsForStatement = reorderBalanceSheetRowsForPresentationSemantics(rowsForStatement);
    }
    if (kind === "is" || kind === "cf") {
      rowsForStatement = mergeAxisExpandedRowsWithDisjointPeriods(rowsForStatement, periodKeys);
    }
    if (kind === "is") {
      rowsForStatement = filterNonFinancialIncomeStatementRows(rowsForStatement, financialFiler);
    }
    const density = gridNonNullCount(rowsForStatement, periodKeys);
    const rowsWithValues = rowsForStatement.filter((row) =>
      periodKeys.some((pk) => row.values[pk] !== null)
    ).length;

    const title =
      kind === "is" && useComprehensiveIncomeStatementTitle(r.role) && financialFiler
        ? "Comprehensive Income"
        : statementTitle;
    const statement: PresentedStatement = {
      id: `primary-${kind}`,
      title,
      role: r.role,
      periods: periodsSorted.map((p) => ({
        key: p.key,
        label: p.label,
        shortLabel: p.shortLabel,
        end: p.end,
        start: p.start,
      })),
      rows: rowsForStatement,
    };
    primaryCandidates.push({
      kind,
      selectionPriority: kind === "is" ? incomeStatementSelectionPriority(r.role) : 0,
      density,
      rowsWithValues,
      statement,
    });
  }

  const bestByKind = new Map<"is" | "bs" | "cf", PrimaryCandidate>();
  for (const c of primaryCandidates) {
    const prev = bestByKind.get(c.kind);
    let better = false;
    if (!prev) {
      better = true;
    } else if (c.selectionPriority !== prev.selectionPriority) {
      better = c.selectionPriority > prev.selectionPriority;
    } else if (c.statement.rows.length !== prev.statement.rows.length) {
      /**
       * Prefer the **wider** primary presentation (more face rows) before density for IS, BS, and CF.
       * Avoids choosing a condensed or rolled-up tree that omits segment / axis lines visible in the filing.
       */
      better = c.statement.rows.length > prev.statement.rows.length;
    } else if (c.density !== prev.density) {
      better = c.density > prev.density;
    } else if (c.rowsWithValues !== prev.rowsWithValues) {
      better = c.rowsWithValues > prev.rowsWithValues;
    }
    if (better) bestByKind.set(c.kind, c);
  }

  const cfWinner = bestByKind.get("cf");
  if (cfWinner && calcArcs.length > 0) {
    const periodKeys = cfWinner.statement.periods.map((p) => p.key);
    const reinjected = injectMissingCalculationChildren({
      kind: "cf",
      rows: cfWinner.statement.rows,
      calcArcs,
      inst,
      periodsSorted: cfWinner.statement.periods,
      labels: labs,
      presentationNodes: cfWinner.statement.rows.map((r) => ({
        concept: r.concept,
        preferredLabelRole: r.preferredLabelRole,
      })),
    });
    const reinjectedPlaced =
      periodKeys.length > 0
        ? relocateMisplacedCashFlowCalcLines({
            rows: reinjected,
            calcArcs,
            inst,
            periodsSorted: cfWinner.statement.periods,
            labels: labs,
            presentationNodes: cfWinner.statement.rows.map((r) => ({
              concept: r.concept,
              preferredLabelRole: r.preferredLabelRole,
            })),
          })
        : reinjected;
    cfWinner.statement = {
      ...cfWinner.statement,
      rows:
        periodKeys.length > 0
          ? mergeAxisExpandedRowsWithDisjointPeriods(reinjectedPlaced, periodKeys)
          : reinjectedPlaced,
    };
  }

  const statements: PresentedStatement[] = (["is", "bs", "cf"] as const)
    .map((k) => bestByKind.get(k)?.statement)
    .filter((s): s is PresentedStatement => Boolean(s));

  const exportStmts: ExportValidationStatement[] = statements.map((s) => {
    let kind: "is" | "bs" | "cf" = "is";
    if (s.id === "primary-cf") kind = "cf";
    else if (s.id === "primary-bs") kind = "bs";
    const periodKeys = s.periods.map((p) => p.key);
    return {
      kind,
      periods: s.periods.map((p) => ({ key: p.key, shortLabel: p.shortLabel, label: p.label })),
      rows: s.rows.map((r) => ({
        concept: r.concept,
        values: kind === "is" ? incomeStatementValuesForExport(r, periodKeys) : r.values,
        label: r.label,
        depth: r.depth,
      })),
    };
  });

  const kindByConcept = new Map<string, "is" | "bs" | "cf">();
  for (const s of exportStmts) {
    for (const r of s.rows) {
      if (!kindByConcept.has(r.concept)) kindByConcept.set(r.concept, s.kind);
    }
  }

  const resolveValue = (concept: string, periodKey: string, k: "is" | "bs" | "cf"): number | null => {
    const rowKind = kindByConcept.get(concept) ?? k;
    for (const s of statements) {
      const row = s.rows.find((x) => x.concept === concept);
      if (row) {
        if (s.id === "primary-is") {
          const v = incomeStatementCellNumeric(row, periodKey);
          if (v !== null) return v;
        } else {
          const v = row.values[periodKey];
          if (v !== null && v !== undefined && Number.isFinite(v)) return v;
        }
      }
    }
    return resolveDisplayNumericFact(inst, concept, periodKey, rowKind);
  };

  const resolveCalculationRollupValue = (
    concept: string,
    periodKey: string,
    k: "is" | "bs" | "cf",
    rollupCtx?: CalculationRollupResolveContext
  ): number | null => {
    void k;
    return resolveRawNumericFactForCalculationRollup(inst, concept, periodKey, rollupCtx);
  };

  const { validation, checklist: selfDiagnosticChecklist } = runSelfDiagnosticValidations(
    exportStmts,
    calcArcs,
    resolveValue,
    resolveCalculationRollupValue
  );

  const payload: PresentedStatementsPayload = {
    ok: true,
    cik: params.cik,
    accessionNumber: params.accessionNumber,
    form: params.form,
    filingDate: params.filingDate,
    statements,
    validation,
    selfDiagnosticChecklist,
    calculationLinkbaseLoaded,
    calculationArcs: calcArcs,
  };

  return { payload, exportStmts, resolveValue, resolveCalculationRollupValue };
}

export async function fetchAsPresentedStatements(params: {
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
}): Promise<PresentedStatementsPayload> {
  const { payload } = await loadPresentedStatementsValidationContext(params);
  return payload;
}

/** Same load as {@link fetchAsPresentedStatements}, plus validation resolver (for rollup debug tools). */
export async function fetchAsPresentedValidationContext(params: {
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
}): Promise<AsPresentedValidationContext> {
  return loadPresentedStatementsValidationContext(params);
}

function localConceptLower(concept: string): string {
  const i = concept.lastIndexOf(":");
  return (i >= 0 ? concept.slice(i + 1) : concept).replace(/_/g, "").toLowerCase();
}

function isOperatingIncomeLossRowConcept(concept: string): boolean {
  return /(^|:)OperatingIncomeLoss$/i.test(concept);
}

/**
 * Impairment-related captions on the income statement face (not footnotes / detail-only roles).
 * Excludes generic restructuring lines unless "impairment" appears in the concept name.
 */
function isImpairmentRelatedFaceConcept(concept: string): boolean {
  const n = localConceptLower(concept);
  if (!n || n.includes("operatingincomeloss")) return false;
  if (n.includes("restructuring") && !n.includes("impairment")) return false;
  return n.includes("impairment") || n === "assetimpairmentcharges" || n === "goodwillimpairmentloss";
}

function presentationParentRowIndex(rows: PresentedStatementRow[], rowIndex: number): number | null {
  if (rowIndex <= 0) return null;
  const d = rows[rowIndex]!.depth;
  for (let i = rowIndex - 1; i >= 0; i--) {
    if (rows[i]!.depth < d) return i;
  }
  return null;
}

/**
 * Map a fiscal duration (`start`..`end`) from companyfacts to the column key used in {@link PresentedStatement}.
 */
export function resolveIncomeStatementPeriodColumnKey(
  incomeStatement: PresentedStatement,
  periodEnd: string,
  periodStart: string | null
): string | null {
  const start = periodStart?.trim() || null;
  const exact = start ? `${start}..${periodEnd}` : null;
  if (exact && incomeStatement.periods.some((p) => p.key === exact)) return exact;
  const candidates = incomeStatement.periods.filter((p) => p.end === periodEnd);
  if (start) {
    const m = candidates.find((p) => (p.start ?? "").trim() === start);
    if (m) return m.key;
  }
  if (candidates.length === 1) return candidates[0]!.key;
  let best: (typeof incomeStatement.periods)[number] | null = null;
  for (const p of candidates) {
    const d = periodDurationDays({ start: p.start ?? null, end: p.end });
    if (d >= 300 && d <= 400) {
      best = p;
      break;
    }
  }
  return best?.key ?? candidates[0]?.key ?? null;
}

/**
 * Sum impairment lines on the **face** primary income statement that appear **above**
 * `OperatingIncomeLoss` in SEC presentation order. Skips a row when its presentation parent is also
 * impairment-related (e.g. goodwill detail nested under total asset impairment).
 */
export function sumFaceImpairmentAddbacksAboveOperatingIncomeUsd(
  payload: PresentedStatementsPayload,
  periodStart: string | null,
  periodEnd: string
): number {
  const is = payload.statements.find((s) => s.id === "primary-is");
  if (!is) return 0;

  const pk = resolveIncomeStatementPeriodColumnKey(is, periodEnd, periodStart);
  if (!pk) return 0;

  const rows = is.rows;
  let oiIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (isOperatingIncomeLossRowConcept(rows[i]!.concept)) {
      oiIdx = i;
      break;
    }
  }
  if (oiIdx < 0) return 0;

  let sum = 0;
  for (let j = 0; j < oiIdx; j++) {
    const row = rows[j]!;
    if (!isImpairmentRelatedFaceConcept(row.concept)) continue;
    const pi = presentationParentRowIndex(rows, j);
    if (pi !== null && isImpairmentRelatedFaceConcept(rows[pi]!.concept)) continue;

    const v = row.values[pk];
    if (v == null || !Number.isFinite(v)) continue;
    sum += Math.abs(v);
  }
  return sum;
}

