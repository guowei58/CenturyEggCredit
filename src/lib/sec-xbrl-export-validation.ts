import type { CalculationArcRow } from "@/lib/sec-xbrl-calculation";

/** One line of explanation for a failed validation (structural or calculation rollup). */
export type XbrlValidationReconciliationLine = {
  label: string;
  valueUsd: number;
  /** Arc weight from `_cal.xml` (calculation rollups only). */
  weight?: number;
  /** `weight × valueUsd` (calculation rollups only). */
  contributionUsd?: number;
};

export type XbrlExportValidationIssue = {
  statement: "balance_sheet" | "income_statement" | "cash_flow" | "calculation";
  periodKey: string;
  periodLabel: string;
  severity: "fail" | "warn";
  check: string;
  detail: string;
  /** Absolute difference in USD (same units as raw XBRL facts). */
  absDeltaUsd?: number;
  /** Optional step-by-step numbers so users can see why the check failed. */
  reconciliation?: {
    /** Short description of what was compared (shown above the table). */
    formula: string;
    lines: XbrlValidationReconciliationLine[];
  };
};

function conceptTail(concept: string): string {
  const i = concept.lastIndexOf(":");
  return i >= 0 ? concept.slice(i + 1) : concept;
}

/** Local element name, ignoring underscores — stable across `us-gaap:Foo_Bar` vs `FooBar`. */
function normalizedLocalConcept(concept: string): string {
  const raw = concept.trim();
  const i = Math.max(raw.lastIndexOf(":"), raw.lastIndexOf("/"), raw.lastIndexOf("#"));
  const tail = i >= 0 ? raw.slice(i + 1) : raw;
  return tail.replace(/_/g, "").toLowerCase();
}

/** Prefer standard `us-gaap:Assets`, but allow `TotalAssets` and presentation-only “Assets” labels. */
const BS_TOTAL_ASSET_LOCALS = new Set(["assets", "totalassets"]);

/** Ordered: standard US GAAP, consolidated wording, IFRS-style ordering. */
const BS_TOTAL_LEQ_LOCALS = [
  "liabilitiesandstockholdersequity",
  "liabilitiesandstockholdersequityincludingportionattributabletononcontrollinginterest",
  "consolidatedliabilitiesandstockholdersequity",
  "totalliabilitiesandstockholdersequity",
  "liabilitiesandequity",
  "totalliabilitiesandequity",
  "equityandliabilities",
];

function firstMatchRowValueByNormalizedLocals(
  rows: ExportValidationStatement["rows"],
  locals: Set<string> | string[],
  periodKey: string
): number | null {
  const want = locals instanceof Set ? locals : new Set(locals);
  for (const r of rows) {
    if (!want.has(normalizedLocalConcept(r.concept))) continue;
    const v = r.values[periodKey];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

function firstMatchRowValueByPresentationLabel(
  rows: ExportValidationStatement["rows"],
  periodKey: string,
  pred: (lineNorm: string) => boolean
): number | null {
  for (const r of rows) {
    const lab = r.label?.replace(/\s+/g, " ").trim();
    if (!lab || !pred(lab)) continue;
    const v = r.values[periodKey];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

const BS_CURRENT_ASSETS_LINE_SPEC: LineMatchSpec = {
  conceptRegex: /:AssetsCurrent$/i,
  normalizedLocals: new Set(["assetscurrent"]),
  label: (t) => /^total\s+current\s+assets$/i.test(t) || /^current\s+assets$/i.test(t),
};

const BS_CURRENT_LIABILITIES_LINE_SPEC: LineMatchSpec = {
  conceptRegex: /:LiabilitiesCurrent$/i,
  normalizedLocals: new Set(["liabilitiescurrent"]),
  label: (t) => /^total\s+current\s+liabilities$/i.test(t) || /^current\s+liabilities$/i.test(t),
};

const BS_TOTAL_ASSETS_LINE_SPEC: LineMatchSpec = {
  conceptRegex: /(^|:|\/)Assets$/i,
  normalizedLocals: BS_TOTAL_ASSET_LOCALS,
  label: (t) => /^assets$/i.test(t) || /^total\s+assets$/i.test(t),
};

function findBalanceSheetTotalAssetsRowIndex(rows: ExportValidationRow[]): number | null {
  return (
    findRowIndexBySpec(rows, BS_TOTAL_ASSETS_LINE_SPEC) ??
    findRowIndexBySpec(rows, { conceptRegex: /(^|:|\/)TotalAssets$/i })
  );
}

export function balanceSheetTotalAssets(rows: ExportValidationRow[], periodKey: string): number | null {
  const idx = findBalanceSheetTotalAssetsRowIndex(rows);
  if (idx === null) return null;
  const v = rows[idx]!.values[periodKey];
  return v !== null && v !== undefined && Number.isFinite(v) ? v : null;
}

type BalanceSheetBetweenLinesRollup = {
  sumBetween: number;
  betweenLines: XbrlValidationReconciliationLine[];
};

/** Numeric face lines strictly between two row indices (endpoints excluded). */
function sumNumericRowsBetweenIndices(
  rows: ExportValidationRow[],
  fromIndex: number,
  toIndex: number,
  periodKey: string
): BalanceSheetBetweenLinesRollup {
  const collected: Array<{ label: string; displayUsd: number }> = [];
  for (let i = fromIndex + 1; i < toIndex; i++) {
    const r = rows[i]!;
    const v = r.values[periodKey];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    collected.push({ label: r.label?.trim() || conceptTail(r.concept), displayUsd: v });
  }
  const betweenLines: XbrlValidationReconciliationLine[] = collected.map((ln) => ({
    label: `+ ${ln.label}`,
    valueUsd: ln.displayUsd,
    contributionUsd: ln.displayUsd,
  }));
  const sumBetween = collected.reduce((a, ln) => a + ln.displayUsd, 0);
  return { sumBetween, betweenLines };
}

/**
 * Total assets should equal total current assets plus every numeric line printed between
 * “Total current assets” and “Total assets” on the face (non-current components / subtotals).
 */
function balanceSheetCurrentAssetsPlusBetweenToTotal(
  rows: ExportValidationRow[],
  periodKey: string
): {
  curA: number;
  totalAssets: number;
  sum: number;
  between: BalanceSheetBetweenLinesRollup;
  usedNoncurrentSubtotalFallback: boolean;
} | null {
  const curIdx = findRowIndexBySpec(rows, BS_CURRENT_ASSETS_LINE_SPEC);
  const assetsIdx = findBalanceSheetTotalAssetsRowIndex(rows);
  if (curIdx === null || assetsIdx === null || assetsIdx <= curIdx) return null;

  const curA = rows[curIdx]!.values[periodKey];
  const totalAssets = rows[assetsIdx]!.values[periodKey];
  if (
    curA === null ||
    curA === undefined ||
    !Number.isFinite(curA) ||
    totalAssets === null ||
    totalAssets === undefined ||
    !Number.isFinite(totalAssets)
  ) {
    return null;
  }

  const between = sumNumericRowsBetweenIndices(rows, curIdx, assetsIdx, periodKey);
  let sum = curA + between.sumBetween;
  let usedNoncurrentSubtotalFallback = false;

  if (between.betweenLines.length === 0) {
    const nca = matchLineValue(rows, periodKey, {
      conceptRegex: /:AssetsNoncurrent$/i,
      normalizedLocals: new Set(["assetsnoncurrent"]),
      label: (t) => /^total\s+non-?current\s+assets$/i.test(t) || /^non-?current\s+assets$/i.test(t),
    });
    if (nca === null) return null;
    sum = curA + nca;
    usedNoncurrentSubtotalFallback = true;
    between.betweenLines.push({ label: "+ AssetsNoncurrent (subtotal)", valueUsd: nca, contributionUsd: nca });
    between.sumBetween = nca;
  }

  return { curA, totalAssets, sum, between, usedNoncurrentSubtotalFallback };
}

const BS_TOTAL_LIABILITIES_LINE_SPEC: LineMatchSpec = {
  conceptRegex: /:Liabilities$/i,
  normalizedLocals: new Set(["liabilities"]),
  label: (t) => /^total\s+liabilities$/i.test(t) && !/equity/i.test(t),
};

function findBalanceSheetTotalLiabilitiesRowIndex(rows: ExportValidationRow[]): number | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (rowIsCombinedLiabilitiesAndEquityRow(r)) continue;
    if (rowMatchesLineSpec(r, BS_CURRENT_LIABILITIES_LINE_SPEC)) continue;
    if (
      rowMatchesLineSpec(r, {
        conceptRegex: /:LiabilitiesNoncurrent$/i,
        normalizedLocals: new Set(["liabilitiesnoncurrent"]),
        label: (t) => /^total\s+non-?current\s+liabilities$/i.test(t) || /^non-?current\s+liabilities$/i.test(t),
      })
    ) {
      continue;
    }
    if (rowMatchesLineSpec(r, BS_TOTAL_LIABILITIES_LINE_SPEC)) return i;
  }
  return null;
}

function balanceSheetTotalLiabilitiesDirect(rows: ExportValidationRow[], periodKey: string): number | null {
  const idx = findBalanceSheetTotalLiabilitiesRowIndex(rows);
  if (idx !== null) {
    const v = rows[idx]!.values[periodKey];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  for (const r of rows) {
    if (rowIsCombinedLiabilitiesAndEquityRow(r)) continue;
    if (rowMatchesLineSpec(r, BS_TOTAL_LIABILITIES_LINE_SPEC)) {
      const v = r.values[periodKey];
      if (v !== null && v !== undefined && Number.isFinite(v)) return v;
    }
    const lab = r.label?.replace(/\s+/g, " ").trim();
    if (
      lab &&
      /^liabilities$/i.test(lab) &&
      !/equity/i.test(lab) &&
      !/current/i.test(lab) &&
      !/non-?current/i.test(lab)
    ) {
      const v = r.values[periodKey];
      if (v !== null && v !== undefined && Number.isFinite(v)) return v;
    }
  }
  return null;
}

/** Total liabilities on the face (excludes current/noncurrent subtotals and L+E combined lines). */
export function balanceSheetTotalLiabilities(rows: ExportValidationRow[], periodKey: string): number | null {
  const direct = balanceSheetTotalLiabilitiesDirect(rows, periodKey);
  if (direct !== null) return direct;
  const leq = balanceSheetTotalLiabilitiesAndEquity(rows, periodKey);
  const equity = balanceSheetTotalEquityDirect(rows, periodKey);
  if (leq !== null && equity !== null && Number.isFinite(leq - equity)) return leq - equity;
  return null;
}

function rowIsCombinedLiabilitiesAndEquityRow(row: ExportValidationRow): boolean {
  if (/LiabilitiesAndStockholdersEquity|LiabilitiesAndEquity|EquityAndLiabilities/i.test(row.concept)) {
    return true;
  }
  const lab = row.label?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
  return lab.length > 0 && /liabilit/.test(lab) && /equity/.test(lab);
}

const BS_TOTAL_EQUITY_SPECS: LineMatchSpec[] = [
  {
    conceptRegex: /StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest$/i,
    normalizedLocals: new Set(["stockholdersequityincludingportionattributabletononcontrollinginterest"]),
  },
  {
    conceptRegex: /StockholdersEquity$/i,
    normalizedLocals: new Set([
      "stockholdersequity",
      "stockholdersequityincludingportionattributabletononcontrollinginterest",
    ]),
    label: (t) =>
      /^total\s+(?:stockholders|shareholders)(?:['\u2019])?\s+equity$/i.test(t) ||
      /^(?:stockholders|shareholders)(?:['\u2019])?\s+equity$/i.test(t),
  },
  {
    conceptRegex: /MembersEquity$/i,
    normalizedLocals: new Set(["membersequity"]),
    label: (t) => /^total\s+members(?:['\u2019])?\s+equity$/i.test(t) || /^members(?:['\u2019])?\s+equity$/i.test(t),
  },
  {
    conceptRegex: /PartnersCapital(?:IncludingPortionAttributableToNoncontrollingInterest)?$/i,
    normalizedLocals: new Set([
      "partnerscapital",
      "partnerscapitalincludingportionattributabletononcontrollinginterest",
    ]),
    label: (t) => /^total\s+partners(?:['\u2019])?\s+capital$/i.test(t) || /^partners(?:['\u2019])?\s+capital$/i.test(t),
  },
  {
    label: (t) => /^total\s+equity$/i.test(t) && !/liabilit/i.test(t),
  },
];

function balanceSheetTotalEquityDirect(rows: ExportValidationRow[], periodKey: string): number | null {
  for (const r of rows) {
    if (rowIsCombinedLiabilitiesAndEquityRow(r)) continue;
    for (const spec of BS_TOTAL_EQUITY_SPECS) {
      if (!rowMatchesLineSpec(r, spec)) continue;
      const v = r.values[periodKey];
      if (v !== null && v !== undefined && Number.isFinite(v)) return v;
    }
  }
  return null;
}

/** Total stockholders / members / partners equity on the face. */
export function balanceSheetTotalEquity(rows: ExportValidationRow[], periodKey: string): number | null {
  const direct = balanceSheetTotalEquityDirect(rows, periodKey);
  if (direct !== null) return direct;
  const leq = balanceSheetTotalLiabilitiesAndEquity(rows, periodKey);
  const liabilities = balanceSheetTotalLiabilitiesDirect(rows, periodKey);
  if (leq !== null && liabilities !== null && Number.isFinite(leq - liabilities)) return leq - liabilities;
  return null;
}

/**
 * Total liabilities should equal total current liabilities plus every numeric line printed between
 * “Total current liabilities” and “Total liabilities” on the face.
 */
function balanceSheetCurrentLiabilitiesPlusBetweenToTotal(
  rows: ExportValidationRow[],
  periodKey: string
): {
  curL: number;
  totalLiabilities: number;
  sum: number;
  between: BalanceSheetBetweenLinesRollup;
  usedNoncurrentSubtotalFallback: boolean;
} | null {
  const curIdx = findRowIndexBySpec(rows, BS_CURRENT_LIABILITIES_LINE_SPEC);
  const liabIdx = findBalanceSheetTotalLiabilitiesRowIndex(rows);
  if (curIdx === null || liabIdx === null || liabIdx <= curIdx) return null;

  const curL = rows[curIdx]!.values[periodKey];
  const totalLiabilities = rows[liabIdx]!.values[periodKey];
  if (
    curL === null ||
    curL === undefined ||
    !Number.isFinite(curL) ||
    totalLiabilities === null ||
    totalLiabilities === undefined ||
    !Number.isFinite(totalLiabilities)
  ) {
    return null;
  }

  const between = sumNumericRowsBetweenIndices(rows, curIdx, liabIdx, periodKey);
  let sum = curL + between.sumBetween;
  let usedNoncurrentSubtotalFallback = false;

  if (between.betweenLines.length === 0) {
    const ncl = matchLineValue(rows, periodKey, {
      conceptRegex: /:LiabilitiesNoncurrent$/i,
      normalizedLocals: new Set(["liabilitiesnoncurrent"]),
      label: (t) => /^total\s+non-?current\s+liabilities$/i.test(t) || /^non-?current\s+liabilities$/i.test(t),
    });
    if (ncl === null) return null;
    sum = curL + ncl;
    usedNoncurrentSubtotalFallback = true;
    between.betweenLines.push({
      label: "+ LiabilitiesNoncurrent (subtotal)",
      valueUsd: ncl,
      contributionUsd: ncl,
    });
    between.sumBetween = ncl;
  }

  return { curL, totalLiabilities, sum, between, usedNoncurrentSubtotalFallback };
}

/** True when check #7 (current + between → total assets) can run for this period. */
export function balanceSheetHasAssetsWalk(rows: ExportValidationRow[], periodKey: string): boolean {
  return balanceSheetCurrentAssetsPlusBetweenToTotal(rows, periodKey) !== null;
}

/** True when check #9 (current + between → total liabilities) can run for this period. */
export function balanceSheetHasLiabilitiesWalk(rows: ExportValidationRow[], periodKey: string): boolean {
  return balanceSheetCurrentLiabilitiesPlusBetweenToTotal(rows, periodKey) !== null;
}

function balanceSheetTotalLiabilitiesAndEquity(rows: ExportValidationRow[], periodKey: string): number | null {
  const byQName = matchLineValue(rows, periodKey, { conceptRegex: /LiabilitiesAndStockholdersEquity$/i });
  if (byQName !== null) return byQName;
  for (const loc of BS_TOTAL_LEQ_LOCALS) {
    const v = matchLineValue(rows, periodKey, { normalizedLocals: new Set([loc]) });
    if (v !== null) return v;
  }
  return matchLineValue(rows, periodKey, {
    label: (t) => {
      if (/^total\s+liabilities\s+and\s+/i.test(t) && /equity/i.test(t)) return true;
      if (/^liabilities\s+and\s+stockholders(?:['\u2019])?\s+equity$/i.test(t)) return true;
      if (/^liabilities\s+and\s+equity$/i.test(t)) return true;
      return false;
    },
  });
}

export type ExportValidationRow = {
  concept: string;
  values: Record<string, number | null>;
  label?: string;
  /** Presentation-tree indent (XBRL as-presented); enables direct-child Σ rollups on the display grid. */
  depth?: number;
};

export type ExportValidationStatement = {
  kind: "is" | "bs" | "cf";
  periods: Array<{ key: string; shortLabel?: string; label: string }>;
  rows: ExportValidationRow[];
};

type LineMatchSpec = {
  conceptRegex?: RegExp;
  normalizedLocals?: Set<string>;
  label?: (line: string) => boolean;
};

function rowMatchesLineSpec(row: ExportValidationRow, spec: LineMatchSpec): boolean {
  if (spec.conceptRegex?.test(row.concept)) return true;
  if (spec.normalizedLocals?.has(normalizedLocalConcept(row.concept))) return true;
  const lab = row.label?.replace(/\s+/g, " ").trim();
  if (lab && spec.label?.(lab)) return true;
  return false;
}

function findRowIndexBySpec(rows: ExportValidationRow[], spec: LineMatchSpec): number | null {
  for (let i = 0; i < rows.length; i++) {
    if (rowMatchesLineSpec(rows[i]!, spec)) return i;
  }
  return null;
}

/** Match a statement line by QName, normalized local name, and/or presentation label (HTML grids). */
export function matchLineValue(
  rows: ExportValidationRow[],
  periodKey: string,
  spec: LineMatchSpec
): number | null {
  for (const r of rows) {
    if (!rowMatchesLineSpec(r, spec)) continue;
    const v = r.values[periodKey];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

function matchLineRow(
  rows: ExportValidationRow[],
  periodKey: string,
  spec: LineMatchSpec
): { value: number; concept: string; label?: string } | null {
  for (const r of rows) {
    if (!rowMatchesLineSpec(r, spec)) continue;
    const v = r.values[periodKey];
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      return { value: v, concept: r.concept, label: r.label };
    }
  }
  return null;
}

/** Allowed gap for every structural / display / calculation rollup check (0.1% of largest involved amount). */
export const TOLERANCE_PCT = 0.001;

/** Human-readable tolerance for UI and validation messages (e.g. `0.1%`). */
export const TOLERANCE_PCT_LABEL = "0.1%";

export function toleranceUsd(...referenceAmounts: number[]): number {
  let ref = 0;
  for (const a of referenceAmounts) {
    if (Number.isFinite(a)) ref = Math.max(ref, Math.abs(a));
  }
  return ref * TOLERANCE_PCT;
}

/** True when any validation issue should block showing statements / saving workbooks (warn-only issues do not block). */
export function hasBlockingXbrlExportFailures(issues: XbrlExportValidationIssue[] | undefined | null): boolean {
  if (!issues?.length) return false;
  return issues.some((i) => i.severity === "fail");
}

function periodLabel(periods: ExportValidationStatement["periods"], pk: string): string {
  const p = periods.find((x) => x.key === pk);
  return (p?.shortLabel?.trim() ? p.shortLabel : p?.label) ?? pk;
}

function fmtM(usd: number): string {
  return `${(usd / 1e6).toFixed(2)}M`;
}

function firstMatchValue(rows: ExportValidationRow[], pattern: RegExp, periodKey: string): number | null {
  return matchLineValue(rows, periodKey, { conceptRegex: pattern });
}

function firstMatchRowWithConcept(
  rows: ExportValidationStatement["rows"],
  pattern: RegExp,
  periodKey: string
): { value: number; concept: string } | null {
  for (const r of rows) {
    if (!pattern.test(r.concept)) continue;
    const v = r.values[periodKey];
    if (v !== null && v !== undefined && Number.isFinite(v)) return { value: v, concept: r.concept };
  }
  return null;
}

function stmtByKind(stmts: ExportValidationStatement[], k: "is" | "bs" | "cf"): ExportValidationStatement | null {
  return stmts.find((s) => s.kind === k) ?? null;
}

/** True when at least one row has a finite numeric for this period (column is not an empty artifact). */
function gridColumnHasAnyFiniteValue(
  rows: Array<{ values: Record<string, number | null> }>,
  periodKey: string
): boolean {
  for (const r of rows) {
    const v = r.values[periodKey];
    if (v !== null && v !== undefined && Number.isFinite(v)) return true;
  }
  return false;
}

function kindForConcept(stmts: ExportValidationStatement[], concept: string): "is" | "bs" | "cf" | null {
  for (const s of stmts) {
    if (s.rows.some((r) => r.concept === concept)) return s.kind;
  }
  return null;
}

type CashFlowSectionKind = "operating" | "investing" | "financing";

const CF_OPERATING_SPECS: LineMatchSpec[] = [
  {
    conceptRegex: /NetCashProvidedByUsedInOperatingActivities(?:ContinuingOperations)?$/i,
    normalizedLocals: new Set([
      "netcashprovidedbyusedinoperatingactivities",
      "netcashprovidedbyusedinoperatingactivitiescontinuingoperations",
    ]),
  },
  { conceptRegex: /CashProvidedByUsedInOperatingActivities$/i, normalizedLocals: new Set(["cashprovidedbyusedinoperatingactivities"]) },
  { label: (t) => /\bnet cash (?:provided by|used in|from) operating activities\b/i.test(t) },
  { label: (t) => /^cash flows? from operating activities$/i.test(t) },
  { label: (t) => /^net cash from operating activities$/i.test(t) },
];

const CF_INVESTING_SPECS: LineMatchSpec[] = [
  {
    conceptRegex: /NetCashProvidedByUsedInInvestingActivities(?:ContinuingOperations)?$/i,
    normalizedLocals: new Set([
      "netcashprovidedbyusedininvestingactivities",
      "netcashprovidedbyusedininvestingactivitiescontinuingoperations",
    ]),
  },
  { conceptRegex: /CashProvidedByUsedInInvestingActivities$/i, normalizedLocals: new Set(["cashprovidedbyusedininvestingactivities"]) },
  { label: (t) => /\bnet cash (?:provided by|used in|from) investing activities\b/i.test(t) },
  { label: (t) => /^cash flows? from investing activities$/i.test(t) },
  { label: (t) => /^net cash from investing activities$/i.test(t) },
];

const CF_FINANCING_SPECS: LineMatchSpec[] = [
  {
    conceptRegex: /NetCashProvidedByUsedInFinancingActivities(?:ContinuingOperations)?$/i,
    normalizedLocals: new Set([
      "netcashprovidedbyusedinfinancingactivities",
      "netcashprovidedbyusedinfinancingactivitiescontinuingoperations",
    ]),
  },
  { conceptRegex: /CashProvidedByUsedInFinancingActivities$/i, normalizedLocals: new Set(["cashprovidedbyusedinfinancingactivities"]) },
  { label: (t) => /\bnet cash (?:provided by|used in|from) financing activities\b/i.test(t) },
  { label: (t) => /^cash flows? from financing activities$/i.test(t) },
  { label: (t) => /^net cash from financing activities$/i.test(t) },
];

const CF_NET_CHANGE_SPECS: LineMatchSpec[] = [
  {
    conceptRegex: /CashCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect$/i,
    normalizedLocals: new Set([
      "cashcashequivalentsperiodincreasedecreaseincludingexchangerateeffect",
      "cashcashequivalentsrestrictedcashandrestrictedcashequivalentsperiodincreasedecreaseincludingexchangerateeffect",
    ]),
  },
  {
    conceptRegex: /CashCashEquivalentsPeriodIncreaseDecrease$/i,
    normalizedLocals: new Set([
      "cashcashequivalentsperiodincreasedecrease",
      "cashandcashequivalentsperiodincreasedecrease",
      "cashcashequivalentsrestrictedcashandrestrictedcashequivalentsperiodincreasedecrease",
    ]),
  },
  {
    conceptRegex: /CashAndCashEquivalentsPeriodIncreaseDecrease/i,
    normalizedLocals: new Set(["cashandcashequivalentsperiodincreasedecrease"]),
  },
  {
    label: (t) =>
      /\bnet (?:increase|decrease) in cash(?: and cash equivalents)?(?:, restricted cash)?\b/i.test(t) &&
      !/operating|investing|financing/i.test(t),
  },
  {
    label: (t) =>
      /\b(?:increase|decrease) in cash(?:, cash equivalents)?(?:, and restricted cash)?\b/i.test(t) &&
      !/operating|investing|financing|beginning|end of period/i.test(t),
  },
  { label: (t) => /^net change in cash(?: and cash equivalents)?$/i.test(t) },
  { label: (t) => /^change in cash(?: and cash equivalents)?$/i.test(t) },
];

const CF_FX_SPECS: LineMatchSpec[] = [
  {
    conceptRegex: /EffectOfExchangeRateOnCashAndCashEquivalents/i,
    normalizedLocals: new Set(["effectofexchangerateoncashandcashequivalents"]),
  },
  {
    conceptRegex: /EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents/i,
    normalizedLocals: new Set(["effectofexchangerateoncashcashequivalentsrestrictedcashandrestrictedcashequivalents"]),
  },
  { label: (t) => /effect of exchange rate/i.test(t) && /cash/i.test(t) },
];

function cashFlowLabelIsSectionNetTotal(label: string, section: CashFlowSectionKind): boolean {
  const t = label.replace(/\s+/g, " ").trim();
  if (!t || !/\bnet\b/i.test(t)) return false;
  const word = section === "operating" ? "operating" : section === "investing" ? "investing" : "financing";
  if (new RegExp(`\\bnet cash (?:provided by|used in|from) ${word} activities\\b`, "i").test(t)) return true;
  if (new RegExp(`^cash flows? from ${word} activities$`, "i").test(t)) return true;
  return false;
}

function cashFlowSectionTotalFromSpecs(
  rows: ExportValidationRow[],
  periodKey: string,
  specs: LineMatchSpec[],
  section: CashFlowSectionKind
): number | null {
  for (const spec of specs) {
    const v = matchLineValue(rows, periodKey, spec);
    if (v !== null) return v;
  }
  let last: number | null = null;
  for (const r of rows) {
    const lab = r.label ?? "";
    if (!cashFlowLabelIsSectionNetTotal(lab, section)) continue;
    const v = r.values[periodKey];
    if (v !== null && v !== undefined && Number.isFinite(v)) last = v;
  }
  return last;
}

export function cashFlowNetOperating(rows: ExportValidationRow[], periodKey: string): number | null {
  return cashFlowSectionTotalFromSpecs(rows, periodKey, CF_OPERATING_SPECS, "operating");
}

export function cashFlowNetInvesting(rows: ExportValidationRow[], periodKey: string): number | null {
  return cashFlowSectionTotalFromSpecs(rows, periodKey, CF_INVESTING_SPECS, "investing");
}

export function cashFlowNetFinancing(rows: ExportValidationRow[], periodKey: string): number | null {
  return cashFlowSectionTotalFromSpecs(rows, periodKey, CF_FINANCING_SPECS, "financing");
}

export function cashFlowNetChangeRow(
  rows: ExportValidationRow[],
  periodKey: string
): { value: number; concept: string; label?: string } | null {
  for (const spec of CF_NET_CHANGE_SPECS) {
    const row = matchLineRow(rows, periodKey, spec);
    if (row) return row;
  }
  let last: { value: number; concept: string; label?: string } | null = null;
  for (const r of rows) {
    const lab = r.label?.replace(/\s+/g, " ").trim() ?? "";
    if (!lab) continue;
    if (
      /\bnet (?:increase|decrease) in cash(?: and cash equivalents)?/i.test(lab) &&
      !/operating|investing|financing/i.test(lab)
    ) {
      const v = r.values[periodKey];
      if (v !== null && v !== undefined && Number.isFinite(v)) {
        last = { value: v, concept: r.concept, label: r.label };
      }
    }
  }
  return last;
}

export function cashFlowFxEffect(rows: ExportValidationRow[], periodKey: string): number | null {
  for (const spec of CF_FX_SPECS) {
    const v = matchLineValue(rows, periodKey, spec);
    if (v !== null) return v;
  }
  return null;
}

export type CashFlowActivityBridgeParts = {
  operating: number;
  investing: number;
  financing: number;
  netChange: { value: number; concept: string; label?: string };
  fxValue: number;
  netIncludesFx: boolean;
};

/** Resolve the three activity totals + net change (and optional FX) for check #15. */
export function resolveCashFlowActivityBridgeParts(
  rows: ExportValidationRow[],
  periodKey: string
): CashFlowActivityBridgeParts | null {
  const operating = cashFlowNetOperating(rows, periodKey);
  const investing = cashFlowNetInvesting(rows, periodKey);
  const financing = cashFlowNetFinancing(rows, periodKey);
  const netChange = cashFlowNetChangeRow(rows, periodKey);
  if (operating === null || investing === null || financing === null || netChange === null) return null;
  // Net-change tags labeled "IncludingExchangeRateEffect" are the **bottom-line total** that should
  // equal Op + Inv + Fin + the separate FX line on the face — not a signal to drop FX from the sum.
  const netIncludesFx = /IncludingExchangeRateEffect/i.test(netChange.concept);
  const fxValue = cashFlowFxEffect(rows, periodKey) ?? 0;
  return { operating, investing, financing, netChange, fxValue, netIncludesFx };
}

function pushCashFlowActivityBridgeIssue(
  issues: XbrlExportValidationIssue[],
  parts: CashFlowActivityBridgeParts,
  pk: string,
  lab: string,
  severity: "fail" | "warn",
  check: string,
  formulaNote: string
): void {
  const { operating: op, investing: inv, financing: fin, netChange: netPick, fxValue: fxAddend, netIncludesFx } = parts;
  const calc = op + inv + fin + fxAddend;
  const d = Math.abs(calc - netPick.value);
  const tolCf = toleranceUsd(calc, netPick.value, op, inv, fin, fxAddend);
  if (d <= tolCf && severity === "fail") return;
  const fxNote = fxAddend !== 0 ? ` (includes FX ${fmtM(fxAddend)})` : "";
  const netTail = netPick.concept.split(":").pop() ?? netPick.concept;
  issues.push({
    statement: "cash_flow",
    periodKey: pk,
    periodLabel: lab,
    severity: d <= tolCf ? "warn" : severity,
    check,
    detail:
      d <= tolCf
        ? `Op+Inv+Fin+FX ${fmtM(calc)} vs net change ${fmtM(netPick.value)} — within 0.1% (${fmtM(tolCf)}).${fxNote}`
        : `Op+Inv+Fin+FX ${fmtM(calc)} vs net change ${fmtM(netPick.value)} (Δ ${fmtM(d)}).${fxNote} Net: ${netTail}${
            netIncludesFx ? " (tag includes exchange-rate effect)" : ""
          }.`,
    absDeltaUsd: d,
    reconciliation: {
      formula: `Cash flow bridge: operating + investing + financing + effect of exchange rate on cash should match the period net change in cash. ${formulaNote}`,
      lines: [
        { label: "Net cash — operating", valueUsd: op },
        { label: "Net cash — investing", valueUsd: inv },
        { label: "Net cash — financing", valueUsd: fin },
        { label: "Effect of exchange rate on cash", valueUsd: fxAddend },
        { label: "Computed sum", valueUsd: calc },
        { label: `Net change (${netTail})`, valueUsd: netPick.value },
        { label: "Difference (sum − net)", valueUsd: calc - netPick.value },
      ],
    },
  });
}

export function runStructuralExportValidations(stmts: ExportValidationStatement[]): XbrlExportValidationIssue[] {
  const issues: XbrlExportValidationIssue[] = [];

  const bs = stmtByKind(stmts, "bs");
  if (bs) {
    for (const p of bs.periods) {
      const pk = p.key;
      const lab = periodLabel(bs.periods, pk);
      const assets = balanceSheetTotalAssets(bs.rows, pk);
      const leq = balanceSheetTotalLiabilitiesAndEquity(bs.rows, pk);
      if (assets !== null && leq !== null) {
        const d = Math.abs(assets - leq);
        const tol = toleranceUsd(assets, leq);
        if (d <= tol) continue;
        issues.push({
          statement: "balance_sheet",
          periodKey: pk,
          periodLabel: lab,
          severity: "fail",
          check: "Assets vs liabilities + equity",
          detail: `Mismatch: Assets ${fmtM(assets)} vs LiabilitiesAndStockholdersEquity ${fmtM(leq)} (Δ ${fmtM(d)}).`,
          absDeltaUsd: d,
          reconciliation: {
            formula: "Balance sheet identity: Assets should equal liabilities + equity (same period, display grid).",
            lines: [
              { label: "Assets", valueUsd: assets },
              { label: "LiabilitiesAndStockholdersEquity", valueUsd: leq },
              { label: "Difference (Assets − L+E)", valueUsd: assets - leq },
            ],
          },
        });
      }

      const liabilities = balanceSheetTotalLiabilities(bs.rows, pk);
      const equity = balanceSheetTotalEquity(bs.rows, pk);
      if (assets !== null && liabilities !== null && equity !== null) {
        const sum = liabilities + equity;
        const d = Math.abs(sum - assets);
        const tolLe = toleranceUsd(assets, sum, liabilities, equity);
        if (d > tolLe) {
          issues.push({
            statement: "balance_sheet",
            periodKey: pk,
            periodLabel: lab,
            severity: "fail",
            check: "Total liabilities + total equity vs assets",
            detail: `Total liabilities ${fmtM(liabilities)} + total equity ${fmtM(equity)} = ${fmtM(
              sum
            )} vs total assets ${fmtM(assets)} (Δ ${fmtM(d)}).`,
            absDeltaUsd: d,
            reconciliation: {
              formula:
                "Balance sheet identity: total liabilities + total equity should equal total assets (same period, display grid). Tolerance = 0.1% of largest amount.",
              lines: [
                { label: "Total liabilities", valueUsd: liabilities },
                { label: "Total equity", valueUsd: equity },
                { label: "Σ Liabilities + Equity", valueUsd: sum },
                { label: "Total assets", valueUsd: assets },
                { label: "Difference (L+E − Assets)", valueUsd: sum - assets },
              ],
            },
          });
        }
      }
    }
  }

  const is = stmtByKind(stmts, "is");
  if (is) {
    for (const p of is.periods) {
      const pk = p.key;
      const lab = periodLabel(is.periods, pk);
      const stated =
        matchLineValue(is.rows, pk, {
          conceptRegex: /:NetIncomeLoss$/i,
          label: (t) => /^net income(?:\s*\(loss\))?$/i.test(t) || /^net earnings?$/i.test(t),
        }) ??
        firstMatchValue(is.rows, /:ProfitLoss$/i, pk) ??
        firstMatchValue(is.rows, /NetIncomeLossAvailableToCommonStockholdersBasic/i, pk);
      const ebt =
        matchLineValue(is.rows, pk, {
          conceptRegex:
            /IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest$/i,
          label: (t) =>
            /\bincome before income taxes?\b/i.test(t) ||
            /\bearnings before income taxes?\b/i.test(t) ||
            /\bpretax income\b/i.test(t),
        }) ??
        matchLineValue(is.rows, pk, {
          conceptRegex: /IncomeLossFromContinuingOperationsBeforeIncomeTaxes$/i,
        });
      const tax = matchLineValue(is.rows, pk, {
        conceptRegex: /:IncomeTaxExpenseBenefit$/i,
        label: (t) => {
          if (/before income tax/i.test(t)) return false;
          return /^income tax(?:es)?(?:\s*\(benefit\))?$/i.test(t) || /^provision for income taxes?/i.test(t);
        },
      });
      /** Income allocated to noncontrolling shareholders — bridges consolidated NI (EBT ± tax) to parent / controlling net income. */
      const nci =
        firstMatchValue(is.rows, /NetIncomeLossAttributableToNoncontrollingInterest$/i, pk) ??
        firstMatchValue(is.rows, /ProfitLossAttributableToNoncontrollingInterest$/i, pk);
      if (stated !== null && ebt !== null && tax !== null) {
        // SEC-style display: tax may appear as +expense or −expense depending on negated labels / instance.
        const netVariants: number[] = [ebt + tax, ebt - tax];
        if (nci !== null && Number.isFinite(nci)) {
          for (const base of [ebt + tax, ebt - tax]) {
            netVariants.push(base - nci, base + nci);
          }
        }
        const d = Math.min(...netVariants.map((c) => Math.abs(c - stated)));
        const tolNi = toleranceUsd(stated, ebt, tax, nci ?? 0);
        if (d <= tolNi) continue;
        const nciFrag = nci !== null && Number.isFinite(nci) ? `, NCI ${fmtM(nci)}` : "";
        issues.push({
          statement: "income_statement",
          periodKey: pk,
          periodLabel: lab,
          severity: "fail",
          check: "Net income vs EBT ± income tax (SEC-style display)",
          detail: `Neither EBT±tax nor EBT±tax±noncontrolling interest ties NI within tolerance: EBT ${fmtM(
            ebt
          )}, tax ${fmtM(tax)}${nciFrag}, NI ${fmtM(stated)} (best Δ ${fmtM(d)}).`,
          absDeltaUsd: d,
          reconciliation: {
            formula:
              "Net income bridge: stated NetIncomeLoss is often **controlling / parent** NI while EBT − tax is **consolidated**; subtract or add NetIncomeLossAttributableToNoncontrollingInterest when present. Tax sign follows the filing’s display (compare both EBT+tax and EBT−tax).",
            lines: [
              { label: "IncomeLossBeforeIncomeTax (EBT)", valueUsd: ebt },
              { label: "IncomeTaxExpenseBenefit (as shown)", valueUsd: tax },
              { label: "EBT + tax", valueUsd: ebt + tax },
              { label: "EBT − tax", valueUsd: ebt - tax },
              ...(nci !== null && Number.isFinite(nci)
                ? [
                    { label: "NI attributable to noncontrolling interest (as shown)", valueUsd: nci },
                    { label: "(EBT − tax) − NCI (typical parent NI)", valueUsd: ebt - tax - nci },
                    { label: "(EBT − tax) + NCI (alternate display sign)", valueUsd: ebt - tax + nci },
                  ]
                : []),
              { label: "NetIncomeLoss (as stated)", valueUsd: stated },
            ],
          },
        });
      }
    }
  }

  const cf = stmtByKind(stmts, "cf");
  if (cf) {
    for (const p of cf.periods) {
      const pk = p.key;
      const lab = periodLabel(cf.periods, pk);
      if (!gridColumnHasAnyFiniteValue(cf.rows, pk)) continue;
      const bridge = resolveCashFlowActivityBridgeParts(cf.rows, pk);
      if (!bridge) continue;
      pushCashFlowActivityBridgeIssue(
        issues,
        bridge,
        pk,
        lab,
        "fail",
        "Operating + investing + financing (+ FX) vs net cash change",
        "Tolerance = 0.1% of largest amount. Always includes the effect-of-exchange-rate line on the statement in the sum."
      );
    }
  }

  return issues;
}

type SignBridgeVariant = {
  /** Human-readable formula, e.g. "Rev − Costs". */
  formula: string;
  computedUsd: number;
  deltaUsd: number;
};

function signBridgeVariantLines(
  variants: SignBridgeVariant[],
  statedLabel: string,
  statedUsd: number
): XbrlValidationReconciliationLine[] {
  const sorted = [...variants].sort((a, b) => a.deltaUsd - b.deltaUsd);
  const lines: XbrlValidationReconciliationLine[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i]!;
    const best = i === 0;
    lines.push({
      label: best ? `★ ${v.formula} → computed` : `${v.formula} → computed`,
      valueUsd: v.computedUsd,
      contributionUsd: v.deltaUsd,
    });
    lines.push({
      label: best ? `★ |computed − ${statedLabel}|` : `|computed − ${statedLabel}|`,
      valueUsd: v.deltaUsd,
    });
  }
  lines.push({ label: statedLabel, valueUsd: statedUsd });
  if (sorted[0]) {
    lines.push({
      label: `Best residual (closest try vs ${statedLabel})`,
      valueUsd: sorted[0].deltaUsd,
    });
  }
  return lines;
}

/**
 * Best residual |rev ± costs ± op| with a small sign search (SEC display conventions differ).
 */
function minOperatingIncomeResidual(rev: number, costs: number, op: number): number {
  return explainOperatingIncomeBridge(rev, costs, op).bestDeltaUsd;
}

function explainOperatingIncomeBridge(rev: number, costs: number, op: number): {
  bestDeltaUsd: number;
  variants: SignBridgeVariant[];
} {
  const variants: SignBridgeVariant[] = [];
  const rc = [1, -1] as const;
  const ro = [1, -1] as const;
  const costSigns = ["−", "+"] as const;
  const opSigns = ["−", "+"] as const;
  for (let i = 0; i < rc.length; i++) {
    for (let j = 0; j < ro.length; j++) {
      const sc = rc[i]!;
      const so = ro[j]!;
      const computed = rev + sc * costs - so * op;
      variants.push({
        formula: `Rev ${costSigns[i]!} Costs ${opSigns[j]!} OperatingIncome`,
        computedUsd: computed,
        deltaUsd: Math.abs(computed),
      });
    }
  }
  const bestDeltaUsd = Math.min(...variants.map((v) => v.deltaUsd));
  return { bestDeltaUsd, variants };
}

/** Best |op ± Σ(sign×bucket) − ebt| over sign variants (SEC nonoperating display). */
function minPretaxIncomeResidual(
  op: number,
  buckets: Array<{ label: string; valueUsd: number }>,
  ebt: number
): number {
  return explainPretaxIncomeBridge(op, buckets, ebt).bestDeltaUsd;
}

/** Face IS lines often show expenses as positive amounts; bridge math subtracts them toward pretax. */
function isPretaxBridgeExpenseLike(label: string, concept: string): boolean {
  const lab = label.toLowerCase();
  const local = normalizedLocalConcept(concept);
  if (/\binterest income\b/i.test(lab) || local.includes("interestincome")) return false;
  if (/\binterest expense\b/i.test(lab) || local.includes("interestexpense")) return true;
  if (/\bincome before income taxes?\b/i.test(lab) || /\bpretax\b/i.test(lab)) return false;
  if (/\bother expense\b/i.test(lab) || /\boperating expense\b/i.test(lab)) return true;
  if (/\bexpense\b/i.test(lab) && !/\bincome\b/i.test(lab)) return true;
  if (/\bcost\b/i.test(lab) || /\bcharge\b/i.test(lab)) return true;
  if (/\bloss\b/i.test(lab) && !/\bgain\b/i.test(lab)) return true;
  return local.endsWith("expense") || local.includes("expensebenefit");
}

function isPretaxBridgeIncomeLike(label: string, concept: string): boolean {
  const lab = label.toLowerCase();
  const local = normalizedLocalConcept(concept);
  if (isPretaxBridgeExpenseLike(label, concept)) return false;
  if (/\binterest income\b/i.test(lab) || local.includes("interestincome")) return true;
  if (/\bincome\b/i.test(lab) && !/\bexpense\b/i.test(lab) && !/before income tax/i.test(lab)) return true;
  if (/\bgain\b/i.test(lab)) return true;
  return local.endsWith("income") || local.includes("investmentincome");
}

/**
 * Signed addend toward pretax: positive display expense → subtract; income → add; already-negative nets kept.
 */
export function pretaxBridgeLineContribution(displayUsd: number, label: string, concept: string): number {
  if (!Number.isFinite(displayUsd)) return displayUsd;
  if (displayUsd < 0) return displayUsd;
  if (isPretaxBridgeExpenseLike(label, concept)) return -Math.abs(displayUsd);
  if (isPretaxBridgeIncomeLike(label, concept)) return Math.abs(displayUsd);
  return displayUsd;
}

function isTreasuryStockEquityLine(label: string, concept: string): boolean {
  const lab = label.toLowerCase();
  const local = normalizedLocalConcept(concept);
  return local.includes("treasurystock") || /\btreasury stock\b/i.test(lab);
}

/** Treasury stock is contra-equity; face tables often print repurchases as a positive amount. */
export function equityComponentContribution(displayUsd: number, label: string, concept: string): number {
  if (!Number.isFinite(displayUsd)) return displayUsd;
  if (isTreasuryStockEquityLine(label, concept) && displayUsd > 0) return -Math.abs(displayUsd);
  return displayUsd;
}

const STOCKHOLDERS_EQUITY_TOTAL_SPEC: LineMatchSpec = {
  conceptRegex: /:StockholdersEquity$/i,
  normalizedLocals: new Set(["stockholdersequity"]),
  label: (t) =>
    /^total\s+(?:stockholders|shareholders)(?:['\u2019])?\s+equity$/i.test(t) ||
    /^(?:stockholders|shareholders)(?:['\u2019])?\s+equity$/i.test(t),
};

function equityComponentRollupBoundaryRow(row: ExportValidationRow): boolean {
  if (
    rowMatchesLineSpec(row, {
      conceptRegex: /:Liabilities$/i,
      normalizedLocals: new Set(["liabilities"]),
      label: (t) => /^total\s+liabilities$/i.test(t) && !/equity/i.test(t),
    })
  ) {
    return true;
  }
  if (rowIsCombinedLiabilitiesAndEquityRow(row)) return true;
  if (
    rowMatchesLineSpec(row, {
      conceptRegex: /(^|:|\/)Assets$/i,
      normalizedLocals: BS_TOTAL_ASSET_LOCALS,
      label: (t) => /^assets$/i.test(t) || /^total\s+assets$/i.test(t),
    })
  ) {
    return true;
  }
  if (
    rowMatchesLineSpec(row, {
      conceptRegex: /StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest$/i,
    })
  ) {
    return true;
  }
  return false;
}

function isStockholdersEquityTotalRow(row: ExportValidationRow): boolean {
  return rowMatchesLineSpec(row, STOCKHOLDERS_EQUITY_TOTAL_SPEC);
}

/** Omit share-count lines from monetary equity rollups (shares outstanding, etc.). */
function isEquityPresentationShareCountRow(row: ExportValidationRow): boolean {
  const local = normalizedLocalConcept(row.concept);
  if (/numberofshares|sharesauthorized|sharesissued|sharesoutstanding/i.test(local)) {
    return !/value|capital|amount/i.test(local);
  }
  if (/treasurystock/i.test(local) && /shares/i.test(local)) return true;
  return false;
}

type EquityComponentPart = {
  label: string;
  concept: string;
  displayUsd: number;
  contributionUsd: number;
};

/** Sum numeric lines printed above “Total stockholders' equity” on the face (presentation order). */
function collectEquityComponentsAboveStockholdersEquityTotal(
  rows: ExportValidationRow[],
  periodKey: string
): { eqTotal: number; parts: EquityComponentPart[] } | null {
  const eqIdx = findRowIndexBySpec(rows, STOCKHOLDERS_EQUITY_TOTAL_SPEC);
  if (eqIdx === null) return null;
  const eqTotal = rows[eqIdx]!.values[periodKey];
  if (eqTotal === null || eqTotal === undefined || !Number.isFinite(eqTotal)) return null;

  const parts: EquityComponentPart[] = [];
  for (let i = eqIdx - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (equityComponentRollupBoundaryRow(r) || isStockholdersEquityTotalRow(r)) break;
    if (isEquityPresentationShareCountRow(r)) continue;
    const v = r.values[periodKey];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const lineLabel = r.label?.trim() || conceptTail(r.concept);
    parts.push({
      label: lineLabel,
      concept: r.concept,
      displayUsd: v,
      contributionUsd: equityComponentContribution(v, lineLabel, r.concept),
    });
  }
  parts.reverse();
  if (parts.length < 2) return null;
  return { eqTotal, parts };
}

export type PretaxBridgeBetweenLine = {
  label: string;
  concept: string;
  /** As shown on the income statement grid. */
  displayUsd: number;
  /** Signed amount applied in Op + Σ → pretax (expenses subtract when shown positive). */
  contributionUsd: number;
};

/** Rows on the face IS strictly between operating income and income-before-taxes (presentation order). */
function incomeStatementBridgeBetweenOpAndPretax(
  rows: ExportValidationRow[],
  periodKey: string,
  targetPretaxUsd?: number
): {
  opIndex: number;
  ebtIndex: number;
  opUsd: number;
  ebtUsd: number;
  betweenLines: PretaxBridgeBetweenLine[];
  sumBetweenUsd: number;
} | null {
  const opIndex = findRowIndexBySpec(rows, {
    conceptRegex: /OperatingIncomeLoss/i,
    label: (t) => /^operating income(?:\s*\(loss\))?$/i.test(t) || /\bincome from operations\b/i.test(t),
  });
  const ebtIndex = findRowIndexBySpec(rows, {
    conceptRegex: /IncomeLossFromContinuingOperationsBeforeIncomeTaxes/i,
    label: (t) =>
      /\bincome before income taxes?\b/i.test(t) ||
      /\bearnings before income taxes?\b/i.test(t) ||
      /\bpretax income\b/i.test(t),
  });
  if (opIndex === null || ebtIndex === null || ebtIndex <= opIndex) return null;

  const opUsd = rows[opIndex]!.values[periodKey];
  const ebtUsd = rows[ebtIndex]!.values[periodKey];
  if (
    opUsd === null ||
    ebtUsd === null ||
    !Number.isFinite(opUsd) ||
    !Number.isFinite(ebtUsd)
  ) {
    return null;
  }

  const betweenLines: Array<{ label: string; concept: string; valueUsd: number }> = [];
  for (let i = opIndex + 1; i < ebtIndex; i++) {
    const r = rows[i]!;
    const v = r.values[periodKey];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    betweenLines.push({
      label: r.label?.trim() || conceptTail(r.concept),
      concept: r.concept,
      valueUsd: v,
    });
  }

  // When detail lines exist, skip the rolled-up NonoperatingIncomeExpense total to avoid double-counting.
  const detailCount = betweenLines.filter(
    (ln) => normalizedLocalConcept(ln.concept) !== "nonoperatingincomeexpense"
  ).length;
  const useLines =
    detailCount >= 2
      ? betweenLines.filter((ln) => normalizedLocalConcept(ln.concept) !== "nonoperatingincomeexpense")
      : betweenLines;

  let betweenWithContrib: PretaxBridgeBetweenLine[] = useLines.map((ln) => {
    const contributionUsd = pretaxBridgeLineContribution(ln.valueUsd, ln.label, ln.concept);
    return { label: ln.label, concept: ln.concept, displayUsd: ln.valueUsd, contributionUsd };
  });

  let sumBetweenUsd = betweenWithContrib.reduce((a, ln) => a + ln.contributionUsd, 0);

  // If caption-based signs still miss pretax, try ± each line (SEC display conventions vary).
  if (targetPretaxUsd !== undefined && betweenWithContrib.length > 0 && betweenWithContrib.length <= 8) {
    const n = betweenWithContrib.length;
    let bestMask = 0;
    let bestDelta = Math.abs(opUsd + sumBetweenUsd - targetPretaxUsd);
    for (let mask = 0; mask < 1 << n; mask++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const ln = betweenWithContrib[i]!;
        const flip = Boolean(mask & (1 << i));
        const base = ln.contributionUsd;
        sum += flip ? -base : base;
      }
      const delta = Math.abs(opUsd + sum - targetPretaxUsd);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestMask = mask;
      }
    }
    if (bestMask !== 0) {
      betweenWithContrib = betweenWithContrib.map((ln, i) => {
        if (!(bestMask & (1 << i))) return ln;
        return { ...ln, contributionUsd: -ln.contributionUsd };
      });
      sumBetweenUsd = betweenWithContrib.reduce((a, ln) => a + ln.contributionUsd, 0);
    }
  }

  return { opIndex, ebtIndex, opUsd, ebtUsd, betweenLines: betweenWithContrib, sumBetweenUsd };
}

function plainPretaxBridgeDetail(params: {
  periodLabel: string;
  opUsd: number;
  ebtUsd: number;
  betweenLines: PretaxBridgeBetweenLine[];
  sumBetweenUsd: number;
  computedUsd: number;
  deltaUsd: number;
}): string {
  const { periodLabel, opUsd, ebtUsd, betweenLines, sumBetweenUsd, computedUsd, deltaUsd } = params;
  const impliedBetween = ebtUsd - opUsd;
  if (betweenLines.length === 0) {
    return (
      `${periodLabel}: Income before taxes is ${fmtM(ebtUsd)} but operating income is ${fmtM(opUsd)} — ` +
      `there are no numbered lines between them on this grid, so the ~${fmtM(Math.abs(impliedBetween))} step is missing from the statement extract.`
    );
  }
  if (betweenLines.length === 1) {
    const only = betweenLines[0]!;
    return (
      `${periodLabel}: Pretax income (${fmtM(ebtUsd)}) should equal operating income (${fmtM(opUsd)}) plus everything ` +
      `below it on the income statement until "income before taxes." Only one line was in that block (${only.label}: shown ${fmtM(
        only.displayUsd
      )}, counted as ${fmtM(only.contributionUsd)}), which implies ~${fmtM(impliedBetween)} of adjustments — about ${fmtM(
        deltaUsd
      )} does not tie. Check the full income statement for other lines or sign conventions.`
    );
  }
  return (
    `${periodLabel}: Pretax income (${fmtM(ebtUsd)}) should equal operating income (${fmtM(
      opUsd
    )}) plus the sum of lines between them (Σ ${fmtM(sumBetweenUsd)} across ${betweenLines.length} lines). ` +
    `That math gives ${fmtM(computedUsd)} vs stated ${fmtM(ebtUsd)} — about ${fmtM(deltaUsd)} does not tie.`
  );
}

function explainPretaxIncomeBridge(
  op: number,
  buckets: Array<{ label: string; valueUsd: number }>,
  ebt: number
): { bestDeltaUsd: number; variants: SignBridgeVariant[] } {
  if (buckets.length === 0) return { bestDeltaUsd: Infinity, variants: [] };

  const variants: SignBridgeVariant[] = [];
  const n = buckets.length;
  const combos = 1 << n;
  for (let mask = 0; mask < combos; mask++) {
    let sum = op;
    const parts = [`Op ${fmtM(op)}`];
    for (let i = 0; i < n; i++) {
      const add = Boolean(mask & (1 << i));
      const b = buckets[i]!;
      sum += (add ? 1 : -1) * b.valueUsd;
      parts.push(`${add ? "+" : "−"} ${b.label} ${fmtM(b.valueUsd)}`);
    }
    variants.push({
      formula: parts.join(" "),
      computedUsd: sum,
      deltaUsd: Math.abs(sum - ebt),
    });
  }
  const bestDeltaUsd = Math.min(...variants.map((v) => v.deltaUsd));
  return { bestDeltaUsd, variants };
}

type PresentationChildrenRollupSpec = {
  check: string;
  spec: LineMatchSpec;
};

const PRESENTATION_CHILDREN_ROLLUP_BY_KIND: Record<"is" | "bs" | "cf", PresentationChildrenRollupSpec[]> = {
  is: [
    {
      check: "Revenue components vs total revenue (display)",
      spec: {
        normalizedLocals: new Set([
          "revenues",
          "salesrevenuenet",
          "revenuefromcontractwithcustomerexcludingassessedtax",
          "revenuesnetofinterestexpense",
        ]),
        label: (t) => /^total\s+revenues?$/i.test(t) || /^total\s+net\s+sales$/i.test(t) || /^net\s+sales$/i.test(t),
      },
    },
    {
      check: "Expense components vs total expenses (display)",
      spec: {
        normalizedLocals: new Set(["costsandexpenses", "operatingexpenses", "costsanddirectoperatingexpenses"]),
        label: (t) =>
          /^total\s+costs and expenses$/i.test(t) ||
          /^total\s+operating expenses$/i.test(t) ||
          /^costs and expenses$/i.test(t),
      },
    },
  ],
  bs: [
    {
      check: "Current asset components vs total current assets (display)",
      spec: {
        normalizedLocals: new Set(["assetscurrent"]),
        label: (t) => /^total\s+current\s+assets$/i.test(t) || /^current\s+assets$/i.test(t),
      },
    },
    {
      check: "Current liability components vs total current liabilities (display)",
      spec: {
        normalizedLocals: new Set(["liabilitiescurrent"]),
        label: (t) => /^total\s+current\s+liabilities$/i.test(t) || /^current\s+liabilities$/i.test(t),
      },
    },
  ],
  cf: [
    {
      check: "Operating cash flow components vs total (display)",
      spec: {
        normalizedLocals: new Set(["netcashprovidedbyusedinoperatingactivities"]),
        label: (t) => /net cash (?:provided by|used in) operating activities/i.test(t),
      },
    },
    {
      check: "Investing cash flow components vs total (display)",
      spec: {
        normalizedLocals: new Set(["netcashprovidedbyusedininvestingactivities"]),
        label: (t) => /net cash (?:provided by|used in) investing activities/i.test(t),
      },
    },
    {
      check: "Financing cash flow components vs total (display)",
      spec: {
        normalizedLocals: new Set(["netcashprovidedbyusedinfinancingactivities"]),
        label: (t) => /net cash (?:provided by|used in) financing activities/i.test(t),
      },
    },
  ],
};

function sumPresentationDirectChildren(
  rows: ExportValidationRow[],
  parentIndex: number,
  periodKey: string
): { sum: number; lines: XbrlValidationReconciliationLine[] } | null {
  const parent = rows[parentIndex]!;
  const pd = parent.depth;
  if (pd === undefined || !Number.isFinite(pd)) return null;

  const lines: XbrlValidationReconciliationLine[] = [];
  let sum = 0;
  let childCount = 0;
  for (let i = parentIndex + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const d = r.depth;
    if (d === undefined || !Number.isFinite(d)) break;
    if (d <= pd) break;
    if (d !== pd + 1) continue;
    const v = r.values[periodKey];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    childCount += 1;
    sum += v;
    lines.push({
      label: r.label?.trim() || conceptTail(r.concept),
      valueUsd: v,
      contributionUsd: v,
    });
  }
  if (childCount < 2) return null;
  return { sum, lines };
}

/** Indirect statement of cash flows: reconciliation to operating cash starts with net income. */
function isCashFlowNetIncomeLine(row: ExportValidationRow): boolean {
  const local = normalizedLocalConcept(row.concept);
  if (
    local === "netincomeloss" ||
    local === "profitloss" ||
    local === "netincomelossavailabletocommonstockholdersbasic" ||
    local === "netincomelossattributabletoparent"
  ) {
    return true;
  }
  const lab = row.label?.replace(/\s+/g, " ").trim() ?? "";
  return /^net income(?:\s*\(loss\))?$/i.test(lab) || /^net loss$/i.test(lab) || /^net earnings?$/i.test(lab);
}

function isCashFlowOperatingActivitiesSubtotalRow(row: ExportValidationRow): boolean {
  return rowMatchesLineSpec(row, {
    conceptRegex: /NetCashProvidedByUsedInOperatingActivities/i,
    normalizedLocals: new Set(["netcashprovidedbyusedinoperatingactivities"]),
    label: (t) => /net cash (?:provided by|used in|from) operating activities/i.test(t),
  });
}

function cashFlowIsPropertyPlantEquipmentLine(label: string, concept: string): boolean {
  const lab = label.toLowerCase();
  const local = normalizedLocalConcept(concept);
  if (local === "gainlossonsaleofpropertyplantequipment" || local.includes("gainlossonsaleofpropertyplant")) {
    return true;
  }
  return (
    /property\s*,?\s*plant\s*(?:,|\s+and\s+|\s*&\s*)?\s*equipment/i.test(lab) ||
    /\bdisposition\s+of\s+property\s*,?\s*plant/i.test(lab)
  );
}

/** PP&E “Gain (Loss) … disposition” — filers print the reconciliation sign; do not invert. */
function cashFlowTrustPpeGainLossFaceSign(label: string, concept: string): boolean {
  if (!cashFlowIsPropertyPlantEquipmentLine(label, concept)) return false;
  const lab = label.toLowerCase();
  return (
    /\bgain\s*\(\s*loss\s*\)/i.test(lab) ||
    /\b(?:gain|loss)\b.*\bdisposition\b/i.test(lab) ||
    /\bdisposition\b.*\b(?:gain|loss)\b/i.test(lab)
  );
}

/**
 * Non–PP&E sale / divestiture lines (extensions, product-line disposals, etc.) — a positive face amount
 * is usually a non-cash gain to subtract. Standard PP&E “Gain (Loss)” uses {@link cashFlowLabelIsPropertyPlantEquipmentDispositionGainLoss}.
 */
function cashFlowLabelIsDispositionOrAssetSaleGainLoss(label: string, concept: string): boolean {
  if (cashFlowTrustPpeGainLossFaceSign(label, concept)) return false;
  const lab = label.toLowerCase();
  const local = normalizedLocalConcept(concept);
  if (
    /\bproduct\s+line\b.*\b(?:asset\s+)?sale\b/i.test(lab) ||
    /\b(?:gain|loss)\b.*\bproduct\s+line\b/i.test(lab) ||
    /\b(?:gain|loss)\b.*\b(?:divestiture|asset\s+sale)\b/i.test(lab) ||
    /\b(?:divestiture|asset\s+sale)\b.*\b(?:gain|loss)\b/i.test(lab)
  ) {
    return true;
  }
  return (
    /productline.*gain|gain.*productline|assetsale|divestiture|gainlossonassets/i.test(local) ||
    (/gainlossonsale|gainlossondisposition/i.test(local) && !/propertyplant/i.test(local))
  );
}

/**
 * Fair-value / securities “Gain (Loss)” lines: trust the face sign. Generic “Gain (Loss)” without a
 * sale/disposition cue stays ambiguous; sale/disposition lines are handled separately.
 */
function cashFlowLabelIsAmbiguousGainLossCaption(label: string, concept: string): boolean {
  if (cashFlowTrustPpeGainLossFaceSign(label, concept)) return true;
  if (cashFlowLabelIsDispositionOrAssetSaleGainLoss(label, concept)) return false;
  const lab = label.toLowerCase();
  const local = normalizedLocalConcept(concept);
  if (
    /marketable\s+securit|available[- ]for[- ]sale|debt\s+securit|unrealized|fair\s+value|derivative(?!\s+asset)/i.test(
      lab
    ) ||
    /marketablesecurit|availableforsale|debtsecurit|unrealizedgainloss|fairvalue/i.test(local)
  ) {
    return true;
  }
  if (/\bgain\b/i.test(lab) && /\bloss\b/i.test(lab)) return true;
  if (/gain\s*\(\s*loss\s*\)|loss\s*\(\s*gain\s*\)/i.test(lab)) return true;
  return false;
}

function cashFlowLabelIsWorkingCapitalChange(label: string, concept: string): boolean {
  const lab = label.toLowerCase();
  const local = normalizedLocalConcept(concept);
  return (
    /increase\s*\(|decrease\s*\(|changes?\s+in\s+/i.test(lab) ||
    /increasedecreasein|changein/i.test(local)
  );
}

/** Unambiguous non-cash gain printed positive (e.g. "Gain on sale") — subtract in indirect operating walk. */
function cashFlowIsUnambiguousPositiveNonCashGain(label: string, concept: string, displayUsd: number): boolean {
  if (displayUsd <= 0) return false;
  if (cashFlowLabelIsWorkingCapitalChange(label, concept)) return false;
  if (cashFlowLabelIsDispositionOrAssetSaleGainLoss(label, concept)) return true;
  if (cashFlowTrustPpeGainLossFaceSign(label, concept)) return false;
  if (cashFlowLabelIsAmbiguousGainLossCaption(label, concept)) return false;
  const lab = label.toLowerCase();
  const local = normalizedLocalConcept(concept);
  if (/\bgain\b/i.test(lab) && /\b(?:on|from)\s+(?:disposition|sale)/i.test(lab)) return true;
  if (/\bgain\s+on\s+sale/i.test(lab) || /\bgain\s+from\s+sale/i.test(lab)) return true;
  if (local.includes("gainonsale")) return true;
  if (local.includes("gainlossonsaleof") && !cashFlowIsPropertyPlantEquipmentLine(label, concept)) return true;
  return false;
}

/** Indirect CF: trust face signs unless the line is clearly a non-cash gain shown as a positive amount. */
export function cashFlowSectionLineContribution(displayUsd: number, label: string, concept: string): number {
  if (!Number.isFinite(displayUsd)) return displayUsd;
  if (cashFlowIsUnambiguousPositiveNonCashGain(label, concept, displayUsd)) return -Math.abs(displayUsd);
  return displayUsd;
}

function cashFlowSpecsForSection(section: CashFlowSectionKind): LineMatchSpec[] {
  return section === "operating"
    ? CF_OPERATING_SPECS
    : section === "investing"
      ? CF_INVESTING_SPECS
      : CF_FINANCING_SPECS;
}

function cashFlowRowIsSectionNetTotalRow(row: ExportValidationRow, section: CashFlowSectionKind): boolean {
  if (section === "operating" && isCashFlowOperatingActivitiesSubtotalRow(row)) return true;
  return (
    cashFlowSpecsForSection(section).some((s) => rowMatchesLineSpec(row, s)) ||
    cashFlowLabelIsSectionNetTotal(row.label ?? "", section)
  );
}

function cashFlowRowIsAnySectionNetTotalRow(row: ExportValidationRow): boolean {
  return (
    cashFlowRowIsSectionNetTotalRow(row, "operating") ||
    cashFlowRowIsSectionNetTotalRow(row, "investing") ||
    cashFlowRowIsSectionNetTotalRow(row, "financing")
  );
}

function cashFlowRowIsNetChangeOrFx(row: ExportValidationRow): boolean {
  return (
    CF_NET_CHANGE_SPECS.some((s) => rowMatchesLineSpec(row, s)) ||
    CF_FX_SPECS.some((s) => rowMatchesLineSpec(row, s)) ||
    /\bnet (?:increase|decrease) in cash/i.test(row.label ?? "")
  );
}

function findCashFlowSectionSubtotalRowIndex(rows: ExportValidationRow[], section: CashFlowSectionKind): number | null {
  let last: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    if (cashFlowRowIsSectionNetTotalRow(rows[i]!, section)) last = i;
  }
  return last;
}

function cashFlowSectionKindForSubtotalRow(row: ExportValidationRow): CashFlowSectionKind | null {
  if (cashFlowRowIsSectionNetTotalRow(row, "operating")) return "operating";
  if (cashFlowRowIsSectionNetTotalRow(row, "investing")) return "investing";
  if (cashFlowRowIsSectionNetTotalRow(row, "financing")) return "financing";
  return null;
}

/**
 * Face-order CF rollups without presentation depth or _cal.xml:
 * operating → Σ numeric lines above the operating total;
 * investing → Σ lines between operating and investing totals;
 * financing → Σ lines between investing and financing totals.
 */
function sumCashFlowSectionByRowOrder(
  rows: ExportValidationRow[],
  subtotalIndex: number,
  periodKey: string,
  section: CashFlowSectionKind
): { sum: number; lines: XbrlValidationReconciliationLine[] } | null {
  let fromIdx: number;
  if (section === "operating") {
    fromIdx = -1;
  } else if (section === "investing") {
    const opIdx = findCashFlowSectionSubtotalRowIndex(rows, "operating");
    if (opIdx === null || opIdx >= subtotalIndex) return null;
    fromIdx = opIdx;
  } else {
    const invIdx = findCashFlowSectionSubtotalRowIndex(rows, "investing");
    if (invIdx === null || invIdx >= subtotalIndex) return null;
    fromIdx = invIdx;
  }

  const collected: Array<{ label: string; displayUsd: number; contributionUsd: number }> = [];
  for (let i = fromIdx + 1; i < subtotalIndex; i++) {
    const r = rows[i]!;
    if (cashFlowRowIsAnySectionNetTotalRow(r) || cashFlowRowIsNetChangeOrFx(r)) continue;
    const v = r.values[periodKey];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const label = r.label?.trim() || conceptTail(r.concept);
    const contributionUsd =
      section === "operating" ? cashFlowSectionLineContribution(v, label, r.concept) : v;
    collected.push({ label, displayUsd: v, contributionUsd });
  }

  const minLines = section === "operating" ? 2 : 1;
  if (collected.length < minLines) return null;

  const lines: XbrlValidationReconciliationLine[] = collected.map((ln) => {
    const op = ln.contributionUsd >= 0 ? "+" : "−";
    const shown = ln.displayUsd !== ln.contributionUsd ? ` (shown ${fmtM(ln.displayUsd)})` : "";
    return {
      label: `${op} ${ln.label}${shown}`,
      valueUsd: Math.abs(ln.displayUsd),
      contributionUsd: ln.contributionUsd,
    };
  });
  const sum = collected.reduce((a, ln) => a + ln.contributionUsd, 0);
  return { sum, lines };
}

/** Whether a CF section can be tie-out checked from face row order (no depth / _cal.xml). */
export function cashFlowCanRollupSection(
  rows: ExportValidationRow[],
  periodKey: string,
  section: CashFlowSectionKind
): boolean {
  const idx = findCashFlowSectionSubtotalRowIndex(rows, section);
  if (idx === null) return false;
  const v = rows[idx]!.values[periodKey];
  if (v === null || v === undefined || !Number.isFinite(v)) return false;
  return sumCashFlowSectionByRowOrder(rows, idx, periodKey, section) !== null;
}

/**
 * Cash flow (and similar) section subtotals appear **after** detail lines in presentation order.
 * Sum every numeric row above the subtotal with depth &gt; parent.depth (not only depth+1 children below).
 */
function sumPresentationSectionBeforeSubtotal(
  rows: ExportValidationRow[],
  parentIndex: number,
  periodKey: string,
  kind: "is" | "bs" | "cf"
): { sum: number; lines: XbrlValidationReconciliationLine[] } | null {
  const parent = rows[parentIndex]!;
  const pd = parent.depth;
  if (pd === undefined || !Number.isFinite(pd)) return null;

  const collected: Array<{ label: string; displayUsd: number; contributionUsd: number }> = [];
  const parentIsCfOperating = kind === "cf" && isCashFlowOperatingActivitiesSubtotalRow(parent);
  let includedNetIncome = false;

  for (let i = parentIndex - 1; i >= 0; i--) {
    const r = rows[i]!;
    const d = r.depth;
    if (d === undefined || !Number.isFinite(d)) break;
    if (d < pd) break;
    if (d === pd) {
      if (parentIsCfOperating && isCashFlowNetIncomeLine(r)) {
        const v = r.values[periodKey];
        if (v !== null && v !== undefined && Number.isFinite(v)) {
          const label = r.label?.trim() || conceptTail(r.concept);
          const contributionUsd = cashFlowSectionLineContribution(v, label, r.concept);
          collected.push({ label, displayUsd: v, contributionUsd });
          includedNetIncome = true;
        }
      } else if (kind === "cf" && cashFlowRowIsAnySectionNetTotalRow(r)) {
        continue;
      }
      break;
    }
    const v = r.values[periodKey];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const label = r.label?.trim() || conceptTail(r.concept);
    const contributionUsd =
      kind === "cf" ? cashFlowSectionLineContribution(v, label, r.concept) : v;
    if (parentIsCfOperating && isCashFlowNetIncomeLine(r)) includedNetIncome = true;
    collected.push({ label, displayUsd: v, contributionUsd });
  }
  collected.reverse();

  if (parentIsCfOperating && !includedNetIncome) {
    for (let i = parentIndex - 1; i >= 0; i--) {
      const r = rows[i]!;
      if (!isCashFlowNetIncomeLine(r)) continue;
      const v = r.values[periodKey];
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      const label = r.label?.trim() || conceptTail(r.concept);
      const contributionUsd = cashFlowSectionLineContribution(v, label, r.concept);
      collected.unshift({ label, displayUsd: v, contributionUsd });
      includedNetIncome = true;
      break;
    }
  }

  if (collected.length < 2) return null;

  const lines: XbrlValidationReconciliationLine[] = collected.map((ln) => {
    const op = ln.contributionUsd >= 0 ? "+" : "−";
    const shown = ln.displayUsd !== ln.contributionUsd ? ` (shown ${fmtM(ln.displayUsd)})` : "";
    return {
      label: `${op} ${ln.label}${shown}`,
      valueUsd: Math.abs(ln.displayUsd),
      contributionUsd: ln.contributionUsd,
    };
  });
  const sum = collected.reduce((a, ln) => a + ln.contributionUsd, 0);
  return { sum, lines };
}

function rowsHavePresentationDepth(rows: ExportValidationRow[]): boolean {
  return rows.some((r) => r.depth !== undefined && Number.isFinite(r.depth));
}

type BalanceSheetAboveSubtotalSection = "current_assets" | "current_liabilities";

function balanceSheetSectionForRollupSpec(spec: LineMatchSpec): BalanceSheetAboveSubtotalSection | null {
  const locals = spec.normalizedLocals;
  if (locals?.has("assetscurrent")) return "current_assets";
  if (locals?.has("liabilitiescurrent")) return "current_liabilities";
  return null;
}

/** Stop walking upward when we hit another major balance-sheet block (not a component of the current rollup). */
function balanceSheetRollupBoundaryRow(row: ExportValidationRow, section: BalanceSheetAboveSubtotalSection): boolean {
  if (section === "current_assets") {
    return (
      rowMatchesLineSpec(row, {
        conceptRegex: /:AssetsNoncurrent$/i,
        normalizedLocals: new Set(["assetsnoncurrent"]),
        label: (t) => /^total\s+non-?current\s+assets$/i.test(t) || /^non-?current\s+assets$/i.test(t),
      }) ||
      rowMatchesLineSpec(row, {
        conceptRegex: /(^|:|\/)Assets$/i,
        normalizedLocals: BS_TOTAL_ASSET_LOCALS,
        label: (t) => /^assets$/i.test(t) || /^total\s+assets$/i.test(t),
      }) ||
      rowMatchesLineSpec(row, { conceptRegex: /Liabilities/i }) ||
      rowMatchesLineSpec(row, { conceptRegex: /StockholdersEquity/i })
    );
  }
  return (
    rowMatchesLineSpec(row, {
      conceptRegex: /(^|:|\/)Assets$/i,
      normalizedLocals: BS_TOTAL_ASSET_LOCALS,
      label: (t) => /^assets$/i.test(t) || /^total\s+assets$/i.test(t),
    }) ||
    rowMatchesLineSpec(row, {
      conceptRegex: /:AssetsCurrent$/i,
      normalizedLocals: new Set(["assetscurrent"]),
      label: (t) => /^total\s+current\s+assets$/i.test(t) || /^current\s+assets$/i.test(t),
    }) ||
    rowMatchesLineSpec(row, {
      conceptRegex: /:LiabilitiesNoncurrent$/i,
      normalizedLocals: new Set(["liabilitiesnoncurrent"]),
      label: (t) => /^total\s+non-?current\s+liabilities$/i.test(t) || /^non-?current\s+liabilities$/i.test(t),
    }) ||
    rowMatchesLineSpec(row, {
      conceptRegex: /:Liabilities$/i,
      normalizedLocals: new Set(["liabilities"]),
      label: (t) => /^total\s+liabilities$/i.test(t) && !/equity/i.test(t),
    }) ||
    rowMatchesLineSpec(row, { conceptRegex: /StockholdersEquity/i })
  );
}

/**
 * On the face balance sheet, component lines sit **above** the subtotal (e.g. cash, AR, then “Total current assets”).
 * Works without presentation `depth` by row order.
 */
function sumBalanceSheetLinesAboveSubtotal(
  rows: ExportValidationRow[],
  subtotalIndex: number,
  periodKey: string,
  section: BalanceSheetAboveSubtotalSection
): { sum: number; lines: XbrlValidationReconciliationLine[] } | null {
  const collected: Array<{ label: string; displayUsd: number }> = [];
  for (let i = subtotalIndex - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (balanceSheetRollupBoundaryRow(r, section)) break;
    const v = r.values[periodKey];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    collected.push({ label: r.label?.trim() || conceptTail(r.concept), displayUsd: v });
  }
  collected.reverse();
  if (collected.length < 2) return null;

  const lines: XbrlValidationReconciliationLine[] = collected.map((ln) => ({
    label: `+ ${ln.label}`,
    valueUsd: ln.displayUsd,
    contributionUsd: ln.displayUsd,
  }));
  const sum = collected.reduce((a, ln) => a + ln.displayUsd, 0);
  return { sum, lines };
}

/**
 * Many filers print current-liability detail **after** “Total assets” and **before** “Total current liabilities”.
 * Sum those face lines when the subtotal row is below total assets on the grid.
 */
function sumBalanceSheetLinesBetweenTotalAssetsAndCurrentLiabilities(
  rows: ExportValidationRow[],
  currentLiabilitiesIndex: number,
  periodKey: string
): { sum: number; lines: XbrlValidationReconciliationLine[] } | null {
  const assetsIdx = findBalanceSheetTotalAssetsRowIndex(rows);
  if (assetsIdx === null || currentLiabilitiesIndex <= assetsIdx) return null;
  const between = sumNumericRowsBetweenIndices(rows, assetsIdx, currentLiabilitiesIndex, periodKey);
  if (between.betweenLines.length < 1) return null;
  return { sum: between.sumBetween, lines: between.betweenLines };
}

function presentationSubtotalComponentRollup(
  stmt: ExportValidationStatement,
  parentIdx: number,
  periodKey: string,
  spec: LineMatchSpec
): { sum: number; lines: XbrlValidationReconciliationLine[] } | null {
  if (stmt.kind === "cf") {
    const section = cashFlowSectionKindForSubtotalRow(stmt.rows[parentIdx]!);
    return (
      sumPresentationSectionBeforeSubtotal(stmt.rows, parentIdx, periodKey, "cf") ??
      (section ? sumCashFlowSectionByRowOrder(stmt.rows, parentIdx, periodKey, section) : null)
    );
  }
  if (stmt.kind === "bs") {
    const section = balanceSheetSectionForRollupSpec(spec);
    if (section) {
      const aboveOrDepth =
        sumPresentationSectionBeforeSubtotal(stmt.rows, parentIdx, periodKey, "bs") ??
        sumBalanceSheetLinesAboveSubtotal(stmt.rows, parentIdx, periodKey, section);
      if (aboveOrDepth) return aboveOrDepth;
      if (section === "current_liabilities") {
        return sumBalanceSheetLinesBetweenTotalAssetsAndCurrentLiabilities(stmt.rows, parentIdx, periodKey);
      }
      return null;
    }
  }
  return (
    sumPresentationSectionBeforeSubtotal(stmt.rows, parentIdx, periodKey, stmt.kind) ??
    sumPresentationDirectChildren(stmt.rows, parentIdx, periodKey)
  );
}

/**
 * Sums direct presentation-tree children under known subtotals (display grid). Complements `_cal.xml` rollups
 * when the calculation linkbase is missing or when users want face-statement arithmetic on normalized display values.
 */
export function runPresentationChildrenRollupValidations(
  stmts: ExportValidationStatement[]
): XbrlExportValidationIssue[] {
  const issues: XbrlExportValidationIssue[] = [];

  for (const stmt of stmts) {
    const specs = PRESENTATION_CHILDREN_ROLLUP_BY_KIND[stmt.kind] ?? [];
    const canRunWithoutDepth = stmt.kind === "bs" || stmt.kind === "cf";
    if (!canRunWithoutDepth && !rowsHavePresentationDepth(stmt.rows)) continue;

    for (const p of stmt.periods) {
      const pk = p.key;
      if (!gridColumnHasAnyFiniteValue(stmt.rows, pk)) continue;
      const lab = periodLabel(stmt.periods, pk);

      for (const { check, spec } of specs) {
        const parentIdx =
          stmt.kind === "cf"
            ? findCashFlowSectionSubtotalRowIndex(
                stmt.rows,
                check.includes("Operating") ? "operating" : check.includes("Investing") ? "investing" : "financing"
              )
            : findRowIndexBySpec(stmt.rows, spec);
        if (parentIdx === null) continue;
        const parentVal = stmt.rows[parentIdx]!.values[pk];
        if (parentVal === null || parentVal === undefined || !Number.isFinite(parentVal)) continue;

        const childRoll = presentationSubtotalComponentRollup(stmt, parentIdx, pk, spec);
        if (!childRoll) continue;

        const periodTol = toleranceUsd(parentVal, childRoll.sum);
        const d = Math.abs(childRoll.sum - parentVal);
        if (d <= periodTol) continue;

        const statement =
          stmt.kind === "is" ? "income_statement" : stmt.kind === "bs" ? "balance_sheet" : "cash_flow";

        const rollupFormula =
          stmt.kind === "cf"
            ? check.includes("Operating")
              ? "Operating cash flow (indirect method) should equal net income plus all adjustment lines above the operating total (face signs; only unambiguous non-cash gains shown positive are subtracted). Tolerance = 0.1% of section total."
              : check.includes("Investing")
                ? "Investing cash flow should equal the sum of all numeric lines between the operating and investing section totals on the face. Tolerance = 0.1% of section total."
                : "Financing cash flow should equal the sum of all numeric lines between the investing and financing section totals on the face. Tolerance = 0.1% of section total."
            : stmt.kind === "bs"
              ? "Balance sheet subtotal should equal component lines above it, or — when the subtotal is below total assets — all numeric lines between “Total assets” and “Total current liabilities”. Tolerance = 0.1% of subtotal."
              : "Presentation tree: parent subtotal should equal the sum of its component lines (same period, display values). Tolerance = 0.1% of subtotal.";

        issues.push({
          statement,
          periodKey: pk,
          periodLabel: lab,
          severity: "fail",
          check,
          detail:
            stmt.kind === "cf" || stmt.kind === "bs"
              ? `${lab}: Σ lines above subtotal ${fmtM(childRoll.sum)} vs stated ${fmtM(
                  parentVal
                )} — ${fmtM(d)} does not tie (tolerance ${fmtM(periodTol)}).`
              : `Σ direct children ${fmtM(childRoll.sum)} vs parent ${fmtM(parentVal)} (Δ ${fmtM(d)}; display grid).`,
          absDeltaUsd: d,
          reconciliation: {
            formula: rollupFormula,
            lines: [
              ...childRoll.lines,
              { label: "Σ section components (signed)", valueUsd: childRoll.sum },
              { label: "Section subtotal (stated)", valueUsd: parentVal },
              { label: "Difference (Σ − stated)", valueUsd: childRoll.sum - parentVal },
            ],
          },
        });
      }
    }
  }

  return issues;
}

/**
 * Extra display-grid tie-outs: operating walk, pretax bridge, balance sheet subtotals, equity components.
 * Component rollups also run via {@link runPresentationChildrenRollupValidations} and `_cal.xml` in {@link runCalculationRollupValidations}.
 */
export function runPresentationExtendedTieOutValidations(stmts: ExportValidationStatement[]): XbrlExportValidationIssue[] {
  const issues: XbrlExportValidationIssue[] = [];

  const is = stmtByKind(stmts, "is");
  if (is) {
    for (const p of is.periods) {
      const pk = p.key;
      const lab = periodLabel(is.periods, pk);
      if (!gridColumnHasAnyFiniteValue(is.rows, pk)) continue;

      const rev =
        matchLineValue(is.rows, pk, {
          conceptRegex: /:Revenues$/i,
          normalizedLocals: new Set(["revenues", "salesrevenuenet", "revenuefromcontractwithcustomerexcludingassessedtax"]),
          label: (t) => /^total\s+revenues?$/i.test(t) || /^total\s+net\s+sales$/i.test(t),
        });
      const costs =
        matchLineValue(is.rows, pk, {
          conceptRegex: /:CostsAndExpenses$/i,
          normalizedLocals: new Set(["costsandexpenses", "costsanddirectoperatingexpenses"]),
          label: (t) => /^total\s+costs and expenses$/i.test(t) || /^costs and expenses$/i.test(t),
        });
      const cogs = matchLineValue(is.rows, pk, { conceptRegex: /CostOfRevenue/i, label: (t) => /cost of (?:revenue|sales)/i.test(t) });
      const opexOnly = matchLineValue(is.rows, pk, {
        conceptRegex: /:OperatingExpenses$/i,
        label: (t) => /^total\s+operating expenses$/i.test(t) || /^operating expenses$/i.test(t),
      });
      const costsCombined =
        costs ?? (cogs !== null && opexOnly !== null && Number.isFinite(cogs) && Number.isFinite(opexOnly) ? cogs + opexOnly : null);
      const opInc = matchLineValue(is.rows, pk, {
        conceptRegex: /:OperatingIncomeLoss$/i,
        label: (t) => /^operating income(?:\s*\(loss\))?$/i.test(t) || /\bincome from operations\b/i.test(t),
      });

      if (rev !== null && costsCombined !== null && opInc !== null) {
        const bridge = explainOperatingIncomeBridge(rev, costsCombined, opInc);
        const tolOp = toleranceUsd(rev, costsCombined, opInc);
        if (bridge.bestDeltaUsd > tolOp) {
          issues.push({
            statement: "income_statement",
            periodKey: pk,
            periodLabel: lab,
            severity: "fail",
            check: "Operating income vs revenue and expenses (display)",
            detail: `Revenue / costs / operating income do not reconcile within 0.1% (${fmtM(tolOp)}): Rev ${fmtM(
              rev
            )}, Costs (combined) ${fmtM(costsCombined)}, OperatingIncome ${fmtM(opInc)} (best residual ${fmtM(
              bridge.bestDeltaUsd
            )}).`,
            absDeltaUsd: bridge.bestDeltaUsd,
            reconciliation: {
              formula:
                "Tries Rev ± Costs ± OperatingIncome ≈ 0 with sign variants (★ = closest). Costs = CostsAndExpenses or COGS + OperatingExpenses. Value = computed total; w×V = |computed| or |computed − target|.",
              lines: [
                { label: "Revenue (matched)", valueUsd: rev },
                { label: "Costs / COGS+OpEx (combined)", valueUsd: costsCombined },
                { label: "OperatingIncomeLoss (stated on filing)", valueUsd: opInc },
                ...signBridgeVariantLines(bridge.variants, "0 (Rev ± Costs ± Op should balance)", 0),
              ],
            },
          });
        }
      }

      const ebtForBridge = matchLineValue(is.rows, pk, {
        conceptRegex: /IncomeLossFromContinuingOperationsBeforeIncomeTaxes/i,
        label: (t) =>
          /\bincome before income taxes?\b/i.test(t) ||
          /\bearnings before income taxes?\b/i.test(t) ||
          /\bpretax income\b/i.test(t),
      });
      const slice =
        ebtForBridge !== null ? incomeStatementBridgeBetweenOpAndPretax(is.rows, pk, ebtForBridge) : null;
      if (slice) {
        const computed = slice.opUsd + slice.sumBetweenUsd;
        const d = Math.abs(computed - slice.ebtUsd);
        const tolPretax = toleranceUsd(computed, slice.ebtUsd, slice.opUsd);
        if (d > tolPretax) {
          const reconLines: XbrlValidationReconciliationLine[] = [
            { label: "Operating income", valueUsd: slice.opUsd },
            ...slice.betweenLines.map((ln) => {
              const op = ln.contributionUsd >= 0 ? "+" : "−";
              const shown =
                ln.displayUsd !== ln.contributionUsd
                  ? ` (shown ${fmtM(ln.displayUsd)})`
                  : "";
              return {
                label: `${op} ${ln.label}${shown}`,
                valueUsd: Math.abs(ln.displayUsd),
                contributionUsd: ln.contributionUsd,
              };
            }),
            { label: "= Computed pretax (Op + signed lines between)", valueUsd: computed },
            { label: "Stated income before taxes", valueUsd: slice.ebtUsd },
            { label: "Does not tie (computed − stated)", valueUsd: computed - slice.ebtUsd },
          ];
          issues.push({
            statement: "income_statement",
            periodKey: pk,
            periodLabel: lab,
            severity: "fail",
            check: "Pretax income bridge (operating → income before taxes)",
            detail: plainPretaxBridgeDetail({
              periodLabel: lab,
              opUsd: slice.opUsd,
              ebtUsd: slice.ebtUsd,
              betweenLines: slice.betweenLines,
              sumBetweenUsd: slice.sumBetweenUsd,
              computedUsd: computed,
              deltaUsd: d,
            }),
            absDeltaUsd: d,
            reconciliation: {
              formula:
                "Operating income + lines between it and income before taxes = pretax. Expenses shown as positive on the face (e.g. Interest expense) are subtracted; income lines are added. Amount = as printed; Gap = signed contribution toward pretax.",
              lines: reconLines,
            },
          });
        }
      }
    }
  }

  const bs = stmtByKind(stmts, "bs");
  if (bs) {
    for (const p of bs.periods) {
      const pk = p.key;
      const lab = periodLabel(bs.periods, pk);
      if (!gridColumnHasAnyFiniteValue(bs.rows, pk)) continue;

      const equityRoll = collectEquityComponentsAboveStockholdersEquityTotal(bs.rows, pk);
      if (equityRoll) {
        const { eqTotal, parts: eqParts } = equityRoll;
        const sumParts = eqParts.reduce((a, x) => a + x.contributionUsd, 0);
        const d = Math.abs(sumParts - eqTotal);
        const tolEq = toleranceUsd(sumParts, eqTotal);
        if (d > tolEq) {
          issues.push({
            statement: "balance_sheet",
            periodKey: pk,
            periodLabel: lab,
            severity: "fail",
            check: "Equity components vs total equity (display)",
            detail: `Sum of matched equity components ${fmtM(sumParts)} vs StockholdersEquity ${fmtM(
              eqTotal
            )} (Δ ${fmtM(d)}). Treasury stock shown positive on the face is treated as contra-equity (subtract).`,
            absDeltaUsd: d,
            reconciliation: {
              formula:
                "Σ equity components (signed) should equal total stockholders equity. Treasury stock printed as a positive amount is subtracted. Amount = as printed; Gap = signed contribution.",
              lines: [
                ...eqParts.map((x) => {
                  const op = x.contributionUsd >= 0 ? "+" : "−";
                  const shown =
                    x.displayUsd !== x.contributionUsd ? ` (shown ${fmtM(x.displayUsd)})` : "";
                  return {
                    label: `${op} ${x.label}${shown}`,
                    valueUsd: Math.abs(x.displayUsd),
                    contributionUsd: x.contributionUsd,
                  };
                }),
                { label: "Σ components (signed)", valueUsd: sumParts },
                { label: "StockholdersEquity (stated)", valueUsd: eqTotal },
                { label: "Difference (Σ − stated)", valueUsd: sumParts - eqTotal },
              ],
            },
          });
        }
      }

      const assetsWalk = balanceSheetCurrentAssetsPlusBetweenToTotal(bs.rows, pk);
      if (assetsWalk) {
        const { curA, totalAssets, sum, between, usedNoncurrentSubtotalFallback } = assetsWalk;
        const d = Math.abs(sum - totalAssets);
        const tolAssets = toleranceUsd(sum, totalAssets, curA, between.sumBetween);
        if (d > tolAssets) {
          const betweenNote = usedNoncurrentSubtotalFallback
            ? " (no detail lines between current and total — used AssetsNoncurrent subtotal)"
            : between.betweenLines.length > 0
              ? ` (${between.betweenLines.length} line(s) between current assets and total assets)`
              : "";
          issues.push({
            statement: "balance_sheet",
            periodKey: pk,
            periodLabel: lab,
            severity: "fail",
            check: "Assets: current + noncurrent vs total (display)",
            detail: `Total current assets ${fmtM(curA)} + between lines ${fmtM(
              between.sumBetween
            )} = ${fmtM(sum)} vs stated total assets ${fmtM(totalAssets)} (Δ ${fmtM(d)})${betweenNote}.`,
            absDeltaUsd: d,
            reconciliation: {
              formula:
                "Total assets should equal total current assets plus every numeric line on the face between “Total current assets” and “Total assets” (same period, display values). Tolerance = 0.1% of largest amount.",
              lines: [
                { label: "Total current assets", valueUsd: curA },
                ...between.betweenLines,
                { label: "Σ (current + between)", valueUsd: sum },
                { label: "Total assets (stated)", valueUsd: totalAssets },
                { label: "Difference (Σ − stated)", valueUsd: sum - totalAssets },
              ],
            },
          });
        }
      }

      const liabWalk = balanceSheetCurrentLiabilitiesPlusBetweenToTotal(bs.rows, pk);
      if (liabWalk) {
        const { curL, totalLiabilities, sum, between, usedNoncurrentSubtotalFallback } = liabWalk;
        const d = Math.abs(sum - totalLiabilities);
        const tolLiab = toleranceUsd(sum, totalLiabilities, curL, between.sumBetween);
        if (d > tolLiab) {
          const betweenNote = usedNoncurrentSubtotalFallback
            ? " (no detail lines between current and total — used LiabilitiesNoncurrent subtotal)"
            : between.betweenLines.length > 0
              ? ` (${between.betweenLines.length} line(s) between current liabilities and total liabilities)`
              : "";
          issues.push({
            statement: "balance_sheet",
            periodKey: pk,
            periodLabel: lab,
            severity: "fail",
            check: "Liabilities: current + noncurrent vs total (display)",
            detail: `Total current liabilities ${fmtM(curL)} + between lines ${fmtM(
              between.sumBetween
            )} = ${fmtM(sum)} vs stated total liabilities ${fmtM(totalLiabilities)} (Δ ${fmtM(d)})${betweenNote}.`,
            absDeltaUsd: d,
            reconciliation: {
              formula:
                "Total liabilities should equal total current liabilities plus every numeric line on the face between “Total current liabilities” and “Total liabilities” (same period, display values). Tolerance = 0.1% of largest amount.",
              lines: [
                { label: "Total current liabilities", valueUsd: curL },
                ...between.betweenLines,
                { label: "Σ (current + between)", valueUsd: sum },
                { label: "Total liabilities (stated)", valueUsd: totalLiabilities },
                { label: "Difference (Σ − stated)", valueUsd: sum - totalLiabilities },
              ],
            },
          });
        }
      }
    }
  }

  return issues;
}

/**
 * When self-diagnostics flag only **shape** problems on the balance sheet or cash flow (e.g. “missing core
 * … cues”), there is no failing {@link runStructuralExportValidations} row — but users still want the same
 * identity / bridge **math** from tagged totals. This helper emits **warn** (or **fail** when out of tolerance)
 * issues with reconciliation tables for periods that are **not** already covered by `existingFailures`.
 */
export function buildBsCfStructuralDiagnosticsForShapeIssues(
  stmts: ExportValidationStatement[],
  opts: { balanceSheet: boolean; cashFlow: boolean },
  existingFailures: XbrlExportValidationIssue[]
): XbrlExportValidationIssue[] {
  const out: XbrlExportValidationIssue[] = [];
  const failedBs = new Set(
    existingFailures.filter((v) => v.statement === "balance_sheet").map((v) => v.periodKey)
  );
  const failedCf = new Set(
    existingFailures.filter((v) => v.statement === "cash_flow").map((v) => v.periodKey)
  );

  const bs = stmtByKind(stmts, "bs");
  if (opts.balanceSheet && bs) {
    for (const p of bs.periods) {
      const pk = p.key;
      if (failedBs.has(pk)) continue;
      if (!gridColumnHasAnyFiniteValue(bs.rows, pk)) continue;
      const lab = periodLabel(bs.periods, pk);
      const assets = balanceSheetTotalAssets(bs.rows, pk);
      const leq = balanceSheetTotalLiabilitiesAndEquity(bs.rows, pk);

      if (assets !== null && leq !== null) {
        const d = Math.abs(assets - leq);
        const tolBs = toleranceUsd(assets, leq);
        const ok = d <= tolBs;
        out.push({
          statement: "balance_sheet",
          periodKey: pk,
          periodLabel: lab,
          severity: ok ? "warn" : "fail",
          check: "Balance sheet identity (diagnostic)",
          detail: ok
            ? `Assets ${fmtM(assets)} vs LiabilitiesAndStockholdersEquity ${fmtM(
                leq
              )} — difference ${fmtM(d)} within 0.1% (${fmtM(tolBs)}).`
            : `Mismatch: Assets ${fmtM(assets)} vs LiabilitiesAndStockholdersEquity ${fmtM(leq)} (Δ ${fmtM(d)}).`,
          absDeltaUsd: d,
          reconciliation: {
            formula:
              "Balance sheet identity: Assets should equal liabilities + equity (same period, primary presentation). Shown because this filing triggered a balance-sheet **shape** warning — totals may still tie.",
            lines: [
              { label: "Assets", valueUsd: assets },
              { label: "LiabilitiesAndStockholdersEquity", valueUsd: leq },
              { label: "Difference (Assets − L+E)", valueUsd: assets - leq },
            ],
          },
        });
      } else {
        const lines: XbrlValidationReconciliationLine[] = [];
        if (assets !== null) lines.push({ label: "Assets (matched)", valueUsd: assets });
        if (leq !== null) lines.push({ label: "LiabilitiesAndStockholdersEquity (matched)", valueUsd: leq });
        if (lines.length === 0) lines.push({ label: "Assets / LiabilitiesAndStockholdersEquity — not matched", valueUsd: 0 });
        out.push({
          statement: "balance_sheet",
          periodKey: pk,
          periodLabel: lab,
          severity: "warn",
          check: "Balance sheet identity (diagnostic)",
          detail: `Could not locate both totals on the primary balance sheet (Assets=${assets === null ? "missing" : fmtM(assets)}, LiabilitiesAndStockholdersEquity=${leq === null ? "missing" : fmtM(leq)}).`,
          reconciliation: {
            formula:
              "Looks for `us-gaap:Assets` / `TotalAssets` and `us-gaap:LiabilitiesAndStockholdersEquity` (or extension QNames / consolidated naming and, when needed, presentation labels like “Assets”). Axis-heavy filings sometimes omit classic row-one cues while totals exist deeper in the tree.",
            lines,
          },
        });
      }
    }
  }

  const cf = stmtByKind(stmts, "cf");
  if (opts.cashFlow && cf) {
    for (const p of cf.periods) {
      const pk = p.key;
      if (failedCf.has(pk)) continue;
      if (!gridColumnHasAnyFiniteValue(cf.rows, pk)) continue;
      const lab = periodLabel(cf.periods, pk);
      const bridge = resolveCashFlowActivityBridgeParts(cf.rows, pk);
      if (bridge) {
        pushCashFlowActivityBridgeIssue(
          out,
          bridge,
          pk,
          lab,
          "warn",
          "Cash activity bridge (diagnostic)",
          "Shown because this filing triggered a cash-flow **shape** warning."
        );
      } else {
        const op = cashFlowNetOperating(cf.rows, pk);
        const inv = cashFlowNetInvesting(cf.rows, pk);
        const fin = cashFlowNetFinancing(cf.rows, pk);
        const netPick = cashFlowNetChangeRow(cf.rows, pk);
        const fxVal = cashFlowFxEffect(cf.rows, pk);
        const lines: XbrlValidationReconciliationLine[] = [];
        if (op !== null) lines.push({ label: "Net cash — operating", valueUsd: op });
        if (inv !== null) lines.push({ label: "Net cash — investing", valueUsd: inv });
        if (fin !== null) lines.push({ label: "Net cash — financing", valueUsd: fin });
        if (fxVal !== null) lines.push({ label: "Effect of exchange rate on cash", valueUsd: fxVal });
        if (netPick) {
          lines.push({
            label: `Net change (${netPick.concept.split(":").pop() ?? "concept"})`,
            valueUsd: netPick.value,
          });
        }
        if (lines.length === 0) lines.push({ label: "Activity / net-change lines — not matched", valueUsd: 0 });
        const parts = [
          op !== null ? `Operating ${fmtM(op)}` : "Operating total missing",
          inv !== null ? `Investing ${fmtM(inv)}` : "Investing total missing",
          fin !== null ? `Financing ${fmtM(fin)}` : "Financing total missing",
          netPick ? `Net change ${fmtM(netPick.value)}` : "Net cash change line missing",
        ];
        out.push({
          statement: "cash_flow",
          periodKey: pk,
          periodLabel: lab,
          severity: "warn",
          check: "Cash activity bridge (diagnostic)",
          detail: `Incomplete tags for bridge: ${parts.join("; ")}.`,
          reconciliation: {
            formula:
              "Full needs operating, investing, financing activity totals plus a period net change in cash line (and optionally FX when the net line excludes exchange effect).",
            lines,
          },
        });
      }
    }
  }

  return out;
}

/**
 * Optional context when resolving raw facts for `_cal.xml` rollups. Lets per-fact logic avoid
 * double-counting when sibling arcs already carry the automotive (or similar) slice.
 */
export type CalculationRollupResolveContext = {
  /** All `_cal.xml` children of the same calculation parent (same summation group). */
  calculationSiblingConcepts?: string[];
};

export type CalculationRollupResolver = (
  concept: string,
  periodKey: string,
  kind: "is" | "bs" | "cf",
  rollupCtx?: CalculationRollupResolveContext
) => number | null;

/** Role URI filter: keep arcs that look like primary face statements. */
function calculationRoleLikelyFaceStatement(role: string): boolean {
  const u = role.toLowerCase();
  if (!u.trim()) return false;
  if (u.includes("disclosure") || u.includes("detail") || u.includes("documentdocument") || u.includes("schedule"))
    return false;
  return (
    u.includes("incomestatement") ||
    u.includes("statementofincome") ||
    u.includes("statementsofoperations") ||
    u.includes("statementofoperations") ||
    u.includes("balancesheet") ||
    u.includes("financialposition") ||
    u.includes("cashflow") ||
    u.includes("statementsofcashflow") ||
    u.includes("statementofcashflow")
  );
}

/**
 * Deduped arcs grouped by parent, using the same “face statement roles only” filter as rollup validation.
 */
export function groupFaceFilteredCalcArcsByParent(arcs: CalculationArcRow[]): {
  byParent: Map<string, CalculationArcRow[]>;
  restrictedToFaceRoles: boolean;
} {
  const faceArcs = arcs.filter((a) => calculationRoleLikelyFaceStatement(a.role));
  const useArcs = faceArcs.length > 0 ? faceArcs : arcs;

  const byParent = new Map<string, CalculationArcRow[]>();
  const seen = new Set<string>();
  for (const a of useArcs) {
    const dedupe = `${a.parentConcept}\t${a.childConcept}\t${a.weight}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const arr = byParent.get(a.parentConcept) ?? [];
    arr.push(a);
    byParent.set(a.parentConcept, arr);
  }
  return { byParent, restrictedToFaceRoles: faceArcs.length > 0 };
}

/** Ignore very short locals so we do not treat broad names like `assets` as prefixes. */
const CALC_ARC_DUP_PREFIX_MIN_LOCAL_LEN = 10;

function calcArcNormLocalForDup(concept: string): string {
  return conceptTail(concept).replace(/_/g, "").toLowerCase();
}

function calcWeightedContributionsNearlyEqual(c1: number, c2: number): boolean {
  const mag = Math.max(Math.abs(c1), Math.abs(c2), 1);
  return Math.abs(c1 - c2) <= Math.max(1e-9 * mag, 0.01);
}

/**
 * Some filings expose overlapping calculation children (e.g. `MarketableSecurities` and
 * `MarketableSecuritiesNoncurrent`) with the **same** weighted instance value — a taxonomy / arc
 * duplication that double-counts toward Σ(w×child). Excludes the **shorter** QName in each such pair.
 *
 * Indices refer to the parallel array passed in (typically sorted _cal.xml child order).
 */
export function calcChildIndicesExcludedAsDuplicatePrefixArcs(
  rows: Array<{ childConcept: string; weight: number; value: number }>
): Set<number> {
  const exclude = new Set<number>();
  const n = rows.length;
  for (let i = 0; i < n; i++) {
    if (exclude.has(i)) continue;
    const wi = Number.isFinite(rows[i]!.weight) ? rows[i]!.weight : 1;
    const vi = rows[i]!.value;
    const ni = calcArcNormLocalForDup(rows[i]!.childConcept);
    if (ni.length < CALC_ARC_DUP_PREFIX_MIN_LOCAL_LEN) continue;
    const contribI = wi * vi;
    for (let j = 0; j < n; j++) {
      if (i === j || exclude.has(j)) continue;
      const wj = Number.isFinite(rows[j]!.weight) ? rows[j]!.weight : 1;
      const vj = rows[j]!.value;
      const nj = calcArcNormLocalForDup(rows[j]!.childConcept);
      if (nj.length < CALC_ARC_DUP_PREFIX_MIN_LOCAL_LEN) continue;
      const contribJ = wj * vj;
      if (!calcWeightedContributionsNearlyEqual(contribI, contribJ)) continue;
      let shortIdx: number;
      let shortName: string;
      let longName: string;
      if (ni.length < nj.length) {
        shortIdx = i;
        shortName = ni;
        longName = nj;
      } else if (nj.length < ni.length) {
        shortIdx = j;
        shortName = nj;
        longName = ni;
      } else {
        continue;
      }
      if (!longName.startsWith(shortName)) continue;
      exclude.add(shortIdx);
    }
  }
  return exclude;
}

export type CalculationRollupExplanation = {
  parentConcept: string;
  periodKey: string;
  periodLabel: string;
  parentKind: "is" | "bs" | "cf";
  parentValue: number;
  restrictedToFaceRoles: boolean;
  arcRoles: string[];
  /** Σ (arc weight × child value), same rule as {@link runCalculationRollupValidations}. */
  sumChildren: number;
  children: Array<{
    childConcept: string;
    weight: number;
    order: number;
    resolvedKind: "is" | "bs" | "cf";
    value: number | null;
    /** Addend toward {@link CalculationRollupExplanation.sumChildren} when `value` is non-null (`weight × value`). */
    contributionToSum: number | null;
    /** True when this arc was dropped from Σ because a longer QName child carried the same weighted value. */
    excludedDuplicatePrefixArc?: boolean;
  }>;
};

/**
 * For one parent concept and period, list each calculation-arc child and the weighted contribution
 * {@link runCalculationRollupValidations} uses (`Σ weight×resolvedChild` vs parent; same resolver).
 */
export function explainCalculationRollup(
  arcs: CalculationArcRow[],
  stmts: ExportValidationStatement[],
  resolveValue: CalculationRollupResolver,
  parentConcept: string,
  periodKey: string
): CalculationRollupExplanation | null {
  if (!arcs.length || !stmts.length) return null;

  const { byParent, restrictedToFaceRoles } = groupFaceFilteredCalcArcsByParent(arcs);
  const arcRows = byParent.get(parentConcept);
  if (!arcRows?.length) return null;

  const parentKind = kindForConcept(stmts, parentConcept);
  if (!parentKind) return null;
  const stmt = stmtByKind(stmts, parentKind);
  if (!stmt) return null;

  const lab = periodLabel(stmt.periods, periodKey);
  const sorted = [...arcRows].sort((a, b) => a.order - b.order || a.childConcept.localeCompare(b.childConcept));
  const siblingConcepts = sorted.map((a) => a.childConcept);
  const rollupCtx: CalculationRollupResolveContext = { calculationSiblingConcepts: siblingConcepts };
  const parentVal = resolveValue(parentConcept, periodKey, parentKind, rollupCtx);
  if (parentVal === null) return null;

  const arcRoles = [...new Set(arcRows.map((a) => a.role))];

  const rowMeta = sorted.map((arc) => {
    const ck = kindForConcept(stmts, arc.childConcept) ?? parentKind;
    const cv = resolveValue(arc.childConcept, periodKey, ck, rollupCtx);
    return { arc, ck, cv };
  });

  const finitePositions = rowMeta
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.cv !== null && Number.isFinite(x.r.cv));

  const dupExcludeAmongFinite =
    finitePositions.length >= 2
      ? calcChildIndicesExcludedAsDuplicatePrefixArcs(
          finitePositions.map((x) => ({
            childConcept: x.r.arc.childConcept,
            weight: x.r.arc.weight,
            value: x.r.cv!,
          }))
        )
      : new Set<number>();

  const dupExcludeGlobal = new Set<number>();
  finitePositions.forEach((x, j) => {
    if (dupExcludeAmongFinite.has(j)) dupExcludeGlobal.add(x.i);
  });

  let sum = 0;
  const children: CalculationRollupExplanation["children"] = [];
  for (let i = 0; i < rowMeta.length; i++) {
    const { arc, ck, cv } = rowMeta[i]!;
    const w = Number.isFinite(arc.weight) ? arc.weight : 1;
    const excluded = dupExcludeGlobal.has(i);
    let addend: number | null = null;
    if (cv !== null && Number.isFinite(cv)) {
      addend = excluded ? 0 : w * cv;
      if (!excluded) sum += w * cv;
    }
    children.push({
      childConcept: arc.childConcept,
      weight: arc.weight,
      order: arc.order,
      resolvedKind: ck,
      value: cv,
      contributionToSum: addend,
      ...(excluded ? { excludedDuplicatePrefixArc: true as const } : {}),
    });
  }

  return {
    parentConcept,
    periodKey,
    periodLabel: lab,
    parentKind,
    parentValue: parentVal,
    restrictedToFaceRoles: restrictedToFaceRoles,
    arcRoles,
    sumChildren: sum,
    children,
  };
}

/**
 * Validates calculation linkbase rollups: for each calculation parent, compares the parent fact to
 * **Σ (arc weight × child fact)** using the same resolver as formal checks (typically **raw** instance values).
 */
export function runCalculationRollupValidations(
  arcs: CalculationArcRow[],
  stmts: ExportValidationStatement[],
  resolveValue: CalculationRollupResolver
): XbrlExportValidationIssue[] {
  if (!arcs.length || !stmts.length) return [];

  const { byParent } = groupFaceFilteredCalcArcsByParent(arcs);

  const issues: XbrlExportValidationIssue[] = [];

  for (const [parent, children] of Array.from(byParent.entries())) {
    const parentKind = kindForConcept(stmts, parent);
    if (!parentKind) continue;

    const stmt = stmtByKind(stmts, parentKind);
    if (!stmt) continue;

    for (const p of stmt.periods) {
      const pk = p.key;
      const lab = periodLabel(stmt.periods, pk);
      const sorted = [...children].sort(
        (a, b) => a.order - b.order || a.childConcept.localeCompare(b.childConcept)
      );
      const siblingConcepts = sorted.map((a) => a.childConcept);
      const rollupCtx: CalculationRollupResolveContext = { calculationSiblingConcepts: siblingConcepts };
      const parentVal = resolveValue(parent, pk, parentKind, rollupCtx);
      if (parentVal === null) continue;

      const resolved: Array<{ arc: CalculationArcRow; cv: number }> = [];
      let missingChild = false;
      for (const arc of sorted) {
        const ck = kindForConcept(stmts, arc.childConcept) ?? parentKind;
        const cv = resolveValue(arc.childConcept, pk, ck, rollupCtx);
        if (cv === null) {
          missingChild = true;
          break;
        }
        resolved.push({ arc, cv });
      }
      if (missingChild) continue;

      const dupExclude = calcChildIndicesExcludedAsDuplicatePrefixArcs(
        resolved.map((r) => ({
          childConcept: r.arc.childConcept,
          weight: r.arc.weight,
          value: r.cv,
        }))
      );

      const rollupLines: XbrlValidationReconciliationLine[] = [];
      let sum = 0;
      let anyDupExcluded = false;
      for (let i = 0; i < resolved.length; i++) {
        const { arc, cv } = resolved[i]!;
        const w = Number.isFinite(arc.weight) ? arc.weight : 1;
        const excluded = dupExclude.has(i);
        if (excluded) anyDupExcluded = true;
        const contrib = excluded ? 0 : w * cv;
        if (!excluded) sum += contrib;
        rollupLines.push({
          label: excluded
            ? `${conceptTail(arc.childConcept)} (duplicate calc arc, excluded from Σ)`
            : conceptTail(arc.childConcept),
          valueUsd: cv,
          weight: w,
          contributionUsd: contrib,
        });
      }

      const tol = toleranceUsd(parentVal, sum);
      const d = Math.abs(sum - parentVal);
      if (d <= tol) continue;

      issues.push({
        statement: "calculation",
        periodKey: pk,
        periodLabel: lab,
        severity: "fail",
        check: `Calculation rollup: ${parent.split(":").pop() ?? parent}`,
        detail: `Σ(w×child) ${fmtM(sum)} vs parent ${fmtM(parentVal)} (Δ ${fmtM(d)}; tol ${fmtM(
          tol
        )}; raw instance facts where available for rollup, arc weights from _cal.xml).`,
        absDeltaUsd: d,
        reconciliation: {
          formula:
            "_cal.xml: tagged parent should equal Σ (weight × child) for the same period. Rollup resolver uses **raw instance** facts (formal SEC calc linkbase); the on-screen grid may use display-normalized signs — small differences are possible." +
            (anyDupExcluded
              ? " Pairs of arcs with the **same** weighted value where the longer QName is a strict extension of the shorter (e.g. `MarketableSecuritiesNoncurrent` vs `MarketableSecurities`) are counted **once** — some filings duplicate both in `_cal.xml`."
              : ""),
          lines: [
            { label: `Parent: ${conceptTail(parent)}`, valueUsd: parentVal },
            ...rollupLines,
            { label: "Σ(weight × child)", valueUsd: sum },
            { label: "Difference (Σ − parent)", valueUsd: sum - parentVal },
          ],
        },
      });
    }
  }

  return issues;
}

export function runAllXbrlExportValidations(
  stmts: ExportValidationStatement[],
  calcArcs: CalculationArcRow[],
  resolveValue: (concept: string, periodKey: string, kind: "is" | "bs" | "cf") => number | null,
  resolveCalculationRollupValue?: CalculationRollupResolver
): XbrlExportValidationIssue[] {
  const calcResolve: CalculationRollupResolver =
    resolveCalculationRollupValue ?? ((concept, periodKey, kind, _ctx) => resolveValue(concept, periodKey, kind));
  return [
    ...runStructuralExportValidations(stmts),
    ...runPresentationExtendedTieOutValidations(stmts),
    ...runPresentationChildrenRollupValidations(stmts),
    ...runCalculationRollupValidations(calcArcs, stmts, calcResolve),
  ];
}
