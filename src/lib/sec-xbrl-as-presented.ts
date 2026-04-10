/**
 * SEC XBRL as-presented statements from a specific filing.
 *
 * Strategy:
 * - Use SEC Archives `index.json` for the filing folder to locate XBRL instance + linkbases.
 * - Parse presentation linkbase to get row order + hierarchy.
 * - Parse label linkbase for human-readable labels (company-provided).
 * - Parse instance for fact values and contexts to build columns.
 * - Optional calculation linkbase widens the fact set and enables rollup checks.
 * - **Display** values use `sec-xbrl-display-normalize`: SEC-style instance numeric + negated presentation labels only;
 *   **raw** instance picks (before negated flip) are preserved per cell for audit.
 */

import { XMLParser } from "fast-xml-parser";

import {
  type CalculationArcRow,
  conceptsReferencedInCalculationArcs,
  parseCalculationLinkbase,
} from "@/lib/sec-xbrl-calculation";
import { normalizeXbrlFactForStatementModel } from "@/lib/sec-xbrl-display-normalize";
import {
  runAllXbrlExportValidations,
  type ExportValidationStatement,
  type XbrlExportValidationIssue,
} from "@/lib/sec-xbrl-export-validation";

export type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";

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
  calculationLinkbaseLoaded: boolean;
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

/** Subtract calendar months from an ISO date; clamp day to month length (UTC). */
function subMonthsFromIsoEnd(ymd: string, months: number): string | null {
  const p = parseIsoDateUtc(ymd);
  if (!p) return null;
  const total = p.y * 12 + (p.m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(p.d, last);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
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
  return p !== null && p.m === fye.month && p.d === fye.day;
}

function matchFiscalQuarterColumnLabel(endYmd: string, fye: FiscalYearEndMd): string | null {
  const fyLabel = findFiscalYearLabelForPeriodEnd(endYmd, fye);
  if (fyLabel == null) return null;
  const ends = fiscalQuarterEndYmds(fyLabel, fye);
  for (let i = 0; i < 4; i++) {
    if (endYmd === ends[i]) {
      const yy = String(fyLabel).slice(-2);
      return `${i + 1}Q${yy}`;
    }
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
    if (durationDays >= 350 && durationDays <= 380) {
      if (yFull !== undefined && isFiscalYearEndYmd(end, fye)) return `FY${String(yFull).slice(-2)}`;
      return null;
    }
    if (durationDays >= 82 && durationDays <= 98) {
      return matchFiscalQuarterColumnLabel(end, fye);
    }
    if (durationDays >= 170 && durationDays <= 200) {
      const fyLabel = findFiscalYearLabelForPeriodEnd(end, fye);
      if (fyLabel == null) return null;
      const [, q2e] = fiscalQuarterEndYmds(fyLabel, fye);
      if (end === q2e) return `6M${String(fyLabel).slice(-2)}`;
      return null;
    }
    if (durationDays >= 260 && durationDays <= 295) {
      const fyLabel = findFiscalYearLabelForPeriodEnd(end, fye);
      if (fyLabel == null) return null;
      const [, , q3e] = fiscalQuarterEndYmds(fyLabel, fye);
      if (end === q3e) return `9M${String(fyLabel).slice(-2)}`;
      return null;
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
function primaryStatementKind(role: string): "is" | "bs" | "cf" | null {
  const u = role.toLowerCase();
  const c = u.replace(/[\s_-]/g, "");
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
    c.includes("statementsofoperations") ||
    c.includes("statementofoperations") ||
    c.includes("consolidatedstatementsofcomprehensive") ||
    c.includes("statementofcomprehensiveincome") ||
    c.includes("statementsofcomprehensiveincome") ||
    (c.includes("statement") && c.includes("operations")) ||
    (c.includes("statement") && c.includes("earnings")) ||
    (c.includes("profit") && c.includes("loss"))
  ) {
    return "is";
  }
  return null;
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
    const idx = lower.findIndex(
      (n) =>
        n.endsWith(".xml") && !n.endsWith("_pre.xml") && !n.endsWith("_lab.xml") && !n.endsWith("_cal.xml")
    );
    instance = idx >= 0 ? names[idx]! : null;
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

type InstanceParse = {
  contextPeriod: Map<string, { end: string; start: string | null }>;
  /** Count of xbrldi:explicitMember in context (0 = entity-wide, preferred for primary columns). */
  contextDimCount: Map<string, number>;
  unitMeasure: Map<string, string>;
  facts: Map<string, Array<{ contextRef: string; unitRef: string | null; value: number }>>;
  /** From `dei:CurrentFiscalYearEndDate` when present (e.g. Sep 30 FY). */
  fiscalYearEnd: FiscalYearEndMd | null;
};

function parseInstance(instanceXml: string, conceptSet: Set<string>): InstanceParse {
  const o = parser.parse(instanceXml) as any;
  const x = o["xbrli:xbrl"] ?? o["xbrl"] ?? o;

  const contextPeriod = new Map<string, { end: string; start: string | null }>();
  const contextDimCount = new Map<string, number>();
  for (const c of asArr(x["xbrli:context"] ?? x["context"])) {
    const id = c?.["@_id"];
    if (typeof id !== "string") continue;
    contextDimCount.set(id, explicitMemberCount(c));
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

  const facts = new Map<string, Array<{ contextRef: string; unitRef: string | null; value: number }>>();

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
          arr.push({ contextRef: ctx, unitRef: unit, value: num });
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

  return { contextPeriod, contextDimCount, unitMeasure, facts, fiscalYearEnd };
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
 * When SEC filings expose multiple facts for the same concept + period (e.g. different contexts that still look
 * consolidated), picking the first tie is arbitrary and often lands on the wrong magnitude. Prefer conservative
 * choices: smaller positive for typical expense/cost tags, larger positive for revenue-like tags, median for totals/NI.
 */
function tieBreakDuplicateFactValues(concept: string, values: number[]): number | null {
  const uniq = Array.from(new Set(values.filter((v) => Number.isFinite(v))));
  if (uniq.length === 0) return null;
  if (uniq.length === 1) return uniq[0]!;
  const c = concept.toLowerCase();
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
  candidates: Array<{ value: number; measure: string | null; dim: number }>,
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
  const distinct = Array.from(new Set(pool.map((p) => p.value)));
  if (distinct.length <= 1) return pool[0]!.value;
  return tieBreakDuplicateFactValues(concept, pool.map((p) => p.value));
}

function resolveDisplayNumericFact(
  inst: InstanceParse,
  concept: string,
  targetPeriodKey: string,
  kind: "is" | "bs" | "cf"
): number | null {
  const facts = inst.facts.get(concept) ?? [];
  const candidates: Array<{ value: number; measure: string | null; dim: number }> = [];
  for (const f of facts) {
    const p = inst.contextPeriod.get(f.contextRef);
    if (!p?.end) continue;
    if (periodKey(p.end, p.start) !== targetPeriodKey) continue;
    const measure = f.unitRef ? inst.unitMeasure.get(f.unitRef) ?? null : null;
    const dim = inst.contextDimCount.get(f.contextRef) ?? 99;
    candidates.push({ value: f.value, measure, dim });
  }
  const picked = pickValueForPeriod(candidates, concept);
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

export async function fetchAsPresentedStatements(params: {
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
}): Promise<PresentedStatementsPayload> {
  const cikNum = parseInt(params.cik.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) throw new Error("Invalid CIK");

  const acc = params.accessionNumber;
  const accClean = accNoDashes(acc);
  if (!accClean) throw new Error("Invalid accession number");

  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}/index.json`;
  const idx = await fetchJson(indexUrl);
  const items = normalizeIndexItems(idx);
  const names = items.map((i) => (i.name ?? "").trim()).filter(Boolean);

  const picked = findBestXbrlFiles(names);
  if (!picked.pre || !picked.lab || !picked.instance) {
    throw new Error("XBRL linkbase files not found for this filing.");
  }

  const base = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}`;
  const preXml = await fetchText(`${base}/${picked.pre}`);
  const labXml = await fetchText(`${base}/${picked.lab}`);
  const instanceXml = await fetchText(`${base}/${picked.instance}`);

  let calculationLinkbaseLoaded = false;
  let calcArcs: CalculationArcRow[] = [];
  if (picked.cal) {
    try {
      const calXml = await fetchText(`${base}/${picked.cal}`);
      calcArcs = parseCalculationLinkbase(calXml);
      calculationLinkbaseLoaded = true;
    } catch {
      calcArcs = [];
      calculationLinkbaseLoaded = false;
    }
  }

  const pres = parsePresentation(preXml);
  const labs = parseLabels(labXml);

  // Build concept set: presentation tree ∪ calculation link (so rollups can resolve children off the face).
  const conceptSet = new Set<string>();
  for (const r of pres.roles) {
    for (const locLabel of Object.keys(r.locs)) conceptSet.add(r.locs[locLabel]!);
  }
  conceptsReferencedInCalculationArcs(calcArcs).forEach((c) => conceptSet.add(c));

  const inst = parseInstance(instanceXml, conceptSet);

  type PrimaryCandidate = {
    kind: "is" | "bs" | "cf";
    density: number;
    rowsWithValues: number;
    statement: PresentedStatement;
  };
  const primaryCandidates: PrimaryCandidate[] = [];

  for (const r of pres.roles) {
    const kind = primaryStatementKind(r.role);
    if (!kind) continue;

    const nodes = buildTree(r, labs);
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

    const rows: PresentedStatementRow[] = nodes.map((n) => {
      const facts = inst.facts.get(n.concept) ?? [];
      const outDisplay: Record<string, number | null> = {};
      const outRaw: Record<string, number | null> = {};
      const outNorm: Record<string, PeriodNormalizationMeta | null> = {};
      for (const p of periodsSorted) {
        outDisplay[p.key] = null;
        outRaw[p.key] = null;
        outNorm[p.key] = null;
      }

      const byPeriod = new Map<string, Array<{ value: number; measure: string | null; dim: number }>>();
      for (const f of facts) {
        const p = inst.contextPeriod.get(f.contextRef);
        if (!p?.end) continue;
        const k = periodKey(p.end, p.start);
        if (!Object.prototype.hasOwnProperty.call(outDisplay, k)) continue;
        const measure = f.unitRef ? inst.unitMeasure.get(f.unitRef) ?? null : null;
        const dim = inst.contextDimCount.get(f.contextRef) ?? 99;
        const arr = byPeriod.get(k) ?? [];
        arr.push({ value: f.value, measure, dim });
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
        values: outDisplay,
        rawValues: outRaw,
        normalizationByPeriod: outNorm,
      };
    });

    if (rows.length === 0 || periodsSorted.length === 0) continue;

    const periodKeys = periodsSorted.map((p) => p.key);
    const density = gridNonNullCount(rows, periodKeys);
    const rowsWithValues = rows.filter((row) => periodKeys.some((pk) => row.values[pk] !== null)).length;

    const title = statementTitle;
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
      rows,
    };
    primaryCandidates.push({ kind, density, rowsWithValues, statement });
  }

  const bestByKind = new Map<"is" | "bs" | "cf", PrimaryCandidate>();
  for (const c of primaryCandidates) {
    const prev = bestByKind.get(c.kind);
    if (
      !prev ||
      c.density > prev.density ||
      (c.density === prev.density && c.rowsWithValues > prev.rowsWithValues)
    ) {
      bestByKind.set(c.kind, c);
    }
  }

  const statements: PresentedStatement[] = (["is", "bs", "cf"] as const)
    .map((k) => bestByKind.get(k)?.statement)
    .filter((s): s is PresentedStatement => Boolean(s));

  const exportStmts: ExportValidationStatement[] = statements.map((s) => {
    let kind: "is" | "bs" | "cf" = "is";
    if (s.id === "primary-cf") kind = "cf";
    else if (s.id === "primary-bs") kind = "bs";
    return {
      kind,
      periods: s.periods.map((p) => ({ key: p.key, shortLabel: p.shortLabel, label: p.label })),
      rows: s.rows.map((r) => ({ concept: r.concept, values: r.values })),
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
        const v = row.values[periodKey];
        if (v !== null && v !== undefined && Number.isFinite(v)) return v;
      }
    }
    return resolveDisplayNumericFact(inst, concept, periodKey, rowKind);
  };

  const validation = runAllXbrlExportValidations(exportStmts, calcArcs, resolveValue);

  return {
    ok: true,
    cik: params.cik,
    accessionNumber: params.accessionNumber,
    form: params.form,
    filingDate: params.filingDate,
    statements,
    validation,
    calculationLinkbaseLoaded,
  };
}

