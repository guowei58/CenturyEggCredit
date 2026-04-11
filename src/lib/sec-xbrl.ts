/**
 * SEC XBRL helpers (companyfacts).
 *
 * Primary source: https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
 * SEC requires a descriptive User-Agent and fair access.
 */

import { getCompanyProfile } from "@/lib/sec-edgar";

const USER_AGENT = "CenturyEggCredit research app (mailto:support@example.com)";

type CompanyFactsJson = {
  cik?: number | string;
  entityName?: string;
  facts?: Record<
    string,
    Record<
      string,
      {
        label?: string;
        description?: string;
        units?: Record<
          string,
          Array<{
            val?: number;
            end?: string;
            start?: string;
            fy?: number;
            fp?: string;
            form?: string;
            filed?: string;
            frame?: string;
            accn?: string;
          }>
        >;
      }
    >
  >;
};

export type XbrlPeriod = {
  end: string; // YYYY-MM-DD
  start: string | null;
  fy: number | null;
  fp: string | null; // FY/Q1/Q2/Q3/Q4
  form: string | null; // 10-K / 10-Q
  filed: string | null; // YYYY-MM-DD
  frame: string | null;
};

export type XbrlCell = {
  period: XbrlPeriod;
  value: number;
  unit: string;
  tag: string;
  label?: string;
};

export type XbrlStatement = {
  /** Canonical line id (e.g. revenue) → mapping metadata */
  lines: Array<{
    id: string;
    label: string;
    /** Preferred GAAP tags (in priority order) */
    tags: string[];
    /** Preferred units (in priority order) */
    units: string[];
  }>;
};

export type NormalizedXbrlFinancials = {
  ok: true;
  ticker: string;
  cik: string;
  entityName: string | null;
  fetchedAt: string;
  annual: {
    periods: XbrlPeriod[];
    /** statementKey -> lineId -> periodEnd(YYYY-MM-DD) -> value */
    statements: Record<string, Record<string, Record<string, number | null>>>;
  };
  quarterly: {
    periods: XbrlPeriod[];
    /** statementKey -> lineId -> periodEnd(YYYY-MM-DD) -> value */
    statements: Record<string, Record<string, Record<string, number | null>>>;
  };
};

type CacheEntry = { fetchedAt: number; data: CompanyFactsJson };
const companyFactsCache = new Map<string, CacheEntry>();
const COMPANY_FACTS_TTL_MS = 6 * 60 * 60 * 1000;

function padCik(cik: string): string {
  return cik.replace(/\D/g, "").padStart(10, "0");
}

function asIsoDate(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function periodKey(p: XbrlPeriod): string {
  // end+fp is generally stable; include form to disambiguate if needed
  return `${p.end}::${p.fp ?? ""}::${p.form ?? ""}`;
}

function pickLatestFiled(cells: XbrlCell[]): XbrlCell | null {
  if (!cells.length) return null;
  const sorted = [...cells].sort((a, b) => {
    const af = a.period.filed ?? "";
    const bf = b.period.filed ?? "";
    if (af !== bf) return bf.localeCompare(af);
    return (b.period.frame ?? "").localeCompare(a.period.frame ?? "");
  });
  return sorted[0] ?? null;
}

function listCellsForTag(
  facts: CompanyFactsJson,
  namespace: string,
  tag: string
): Array<XbrlCell> {
  const node = facts.facts?.[namespace]?.[tag];
  const label = node?.label;
  const units = node?.units ?? {};
  const out: XbrlCell[] = [];
  for (const unit of Object.keys(units)) {
    for (const r of units[unit] ?? []) {
      if (typeof r?.val !== "number" || !Number.isFinite(r.val)) continue;
      const end = asIsoDate(r.end);
      if (!end) continue;
      out.push({
        unit,
        tag,
        label,
        value: r.val,
        period: {
          end,
          start: asIsoDate(r.start),
          fy: typeof r.fy === "number" && Number.isFinite(r.fy) ? r.fy : null,
          fp: typeof r.fp === "string" ? r.fp : null,
          form: typeof r.form === "string" ? r.form : null,
          filed: asIsoDate(r.filed),
          frame: typeof r.frame === "string" ? r.frame : null,
        },
      });
    }
  }
  return out;
}

function statementDefinitions(): Record<string, XbrlStatement> {
  // Minimal, practical core set; can expand later.
  return {
    income: {
      lines: [
        { id: "revenue", label: "Revenue", tags: ["Revenues", "SalesRevenueNet"], units: ["USD"] },
        { id: "cogs", label: "Cost of revenue", tags: ["CostOfRevenue"], units: ["USD"] },
        { id: "gross_profit", label: "Gross profit", tags: ["GrossProfit"], units: ["USD"] },
        { id: "opex", label: "Operating expenses", tags: ["OperatingExpenses"], units: ["USD"] },
        { id: "op_income", label: "Operating income (loss)", tags: ["OperatingIncomeLoss"], units: ["USD"] },
        { id: "pretax_income", label: "Pre-tax income (loss)", tags: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"], units: ["USD"] },
        { id: "net_income", label: "Net income (loss)", tags: ["NetIncomeLoss"], units: ["USD"] },
      ],
    },
    cashflow: {
      lines: [
        { id: "cfo", label: "Cash flow from operations", tags: ["NetCashProvidedByUsedInOperatingActivities"], units: ["USD"] },
        { id: "capex", label: "CapEx (PP&E)", tags: ["PaymentsToAcquirePropertyPlantAndEquipment"], units: ["USD"] },
        { id: "cff", label: "Cash flow from financing", tags: ["NetCashProvidedByUsedInFinancingActivities"], units: ["USD"] },
        { id: "cfi", label: "Cash flow from investing", tags: ["NetCashProvidedByUsedInInvestingActivities"], units: ["USD"] },
      ],
    },
    balance: {
      lines: [
        { id: "cash", label: "Cash & equivalents", tags: ["CashAndCashEquivalentsAtCarryingValue"], units: ["USD"] },
        { id: "assets", label: "Total assets", tags: ["Assets"], units: ["USD"] },
        { id: "liabilities", label: "Total liabilities", tags: ["Liabilities"], units: ["USD"] },
        { id: "equity", label: "Total equity", tags: ["StockholdersEquity"], units: ["USD"] },
        { id: "debt_long", label: "Long-term debt", tags: ["LongTermDebtNoncurrent"], units: ["USD"] },
      ],
    },
  };
}

function isAnnualPeriod(p: XbrlPeriod): boolean {
  return p.fp === "FY" && (p.form === "10-K" || p.form === "20-F" || p.form === "40-F");
}

/** Annual filing types in SEC companyfacts (incl. amendments). */
const ANNUAL_FILING_FORM_RE = /^(10-K|10-K\/A|20-F|20-F\/A|40-F|40-F\/A)$/;

/** Roughly one fiscal year (excludes quarter / YTD rows sometimes mis-tagged fp=FY in companyfacts). */
function durationDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

const FULL_YEAR_MIN_DAYS = 300;
const FULL_YEAR_MAX_DAYS = 420;

/** One full fiscal year fact as filed in companyfacts (duration + annual form). */
function isFullYearAnnualCompanyFact(p: XbrlPeriod): boolean {
  if (p.fp !== "FY") return false;
  const form = (p.form ?? "").trim();
  if (!ANNUAL_FILING_FORM_RE.test(form)) return false;
  const d = durationDays(p.start, p.end);
  if (d == null) return false;
  return d >= FULL_YEAR_MIN_DAYS && d <= FULL_YEAR_MAX_DAYS;
}

/**
 * FY + annual form for either ~12-month flows OR balance-sheet-style **instant** facts (no `start`, or 0–5 day span).
 * Companyfacts uses duration filtering for P&amp;L; Assets/Liabilities/Debt are usually instant at fiscal year-end.
 *
 * Some issuers tag **year-end balance sheet** lines as `fp: "Q4"` on the 10-K instead of `FY` (e.g. CHTR for 2017-12-31
 * while restated P&amp;L uses `FY`). We accept Q4 only when the fact is instant (not a ~90-day flow).
 */
function isFyAnnualSnapshotOrFullYearFact(p: XbrlPeriod): boolean {
  const form = (p.form ?? "").trim();
  if (!ANNUAL_FILING_FORM_RE.test(form)) return false;
  const d = durationDays(p.start, p.end);
  const instantOrUnknownPointInTime = d == null ? p.end.length >= 10 : d >= 0 && d <= 5;

  if (p.fp === "FY") {
    if (d == null) {
      return p.end.length >= 10;
    }
    if (d >= 0 && d <= 5) return true;
    return d >= FULL_YEAR_MIN_DAYS && d <= FULL_YEAR_MAX_DAYS;
  }

  if (p.fp === "Q4" && instantOrUnknownPointInTime) {
    return true;
  }

  return false;
}

function isQuarterPeriod(p: XbrlPeriod): boolean {
  return (p.fp === "Q1" || p.fp === "Q2" || p.fp === "Q3" || p.fp === "Q4") && (p.form === "10-Q" || p.form === "10-K");
}

function uniquePeriodsSorted(periods: XbrlPeriod[]): XbrlPeriod[] {
  const map = new Map<string, XbrlPeriod>();
  for (const p of periods) {
    const k = periodKey(p);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, p);
      continue;
    }
    // keep latest filed
    const pf = prev.filed ?? "";
    const nf = p.filed ?? "";
    if (nf && nf.localeCompare(pf) > 0) map.set(k, p);
  }
  return Array.from(map.values()).sort((a, b) => b.end.localeCompare(a.end));
}

export async function fetchCompanyFactsByTicker(ticker: string): Promise<{ ok: true; cik: string; facts: CompanyFactsJson } | { ok: false; error: string }> {
  const sym = ticker.trim().toUpperCase();
  if (!sym) return { ok: false, error: "Ticker required" };
  const profile = await getCompanyProfile(sym);
  if (!profile?.cik) return { ok: false, error: "CIK not found for ticker" };
  const cik = padCik(profile.cik);

  const now = Date.now();
  const cached = companyFactsCache.get(cik);
  if (cached && now - cached.fetchedAt < COMPANY_FACTS_TTL_MS) {
    return { ok: true, cik, facts: cached.data };
  }

  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    return { ok: false, error: `SEC companyfacts fetch failed (${res.status})` };
  }
  const data = (await res.json()) as CompanyFactsJson;
  companyFactsCache.set(cik, { fetchedAt: now, data });
  return { ok: true, cik, facts: data };
}

export function normalizeCompanyFactsToStatements(params: {
  ticker: string;
  cik: string;
  entityName: string | null;
  facts: CompanyFactsJson;
  years: number;
}): NormalizedXbrlFinancials {
  const defs = statementDefinitions();
  const { ticker, cik, entityName, facts, years } = params;

  const annualPeriods: XbrlPeriod[] = [];
  const quarterPeriods: XbrlPeriod[] = [];
  const annualStatements: Record<string, Record<string, unknown>> = {};
  const quarterlyStatements: Record<string, Record<string, unknown>> = {};

  for (const stmtKey of Object.keys(defs)) {
    const stmt = defs[stmtKey]!;
    annualStatements[stmtKey] = {};
    quarterlyStatements[stmtKey] = {};

    for (const line of stmt.lines) {
      const allCells: XbrlCell[] = [];
      for (const tag of line.tags) {
        const cells = listCellsForTag(facts, "us-gaap", tag);
        for (const c of cells) {
          // unit filter (keep only preferred units)
          if (line.units.length && !line.units.includes(c.unit)) continue;
          allCells.push(c);
        }
      }

      // bucket by period key (pick latest filed for that period)
      const byPeriod = new Map<string, XbrlCell[]>();
      for (const c of allCells) {
        const pk = periodKey(c.period);
        const arr = byPeriod.get(pk) ?? [];
        arr.push(c);
        byPeriod.set(pk, arr);
      }

      const chosen: XbrlCell[] = [];
      for (const arr of Array.from(byPeriod.values())) {
        const best = pickLatestFiled(arr);
        if (best) chosen.push(best);
      }

      const annual = chosen.filter((c) => isAnnualPeriod(c.period));
      const quarterly = chosen.filter((c) => isQuarterPeriod(c.period));

      const annualSorted = annual.sort((a, b) => b.period.end.localeCompare(a.period.end));
      const quarterlySorted = quarterly.sort((a, b) => b.period.end.localeCompare(a.period.end));

      const annualCut = annualSorted.slice(0, Math.max(1, years));
      // quarters: years*4, but some will be missing; keep a bit more
      const quarterlyCut = quarterlySorted.slice(0, Math.max(4, years * 4 + 2));

      for (const c of annualCut) annualPeriods.push(c.period);
      for (const c of quarterlyCut) quarterPeriods.push(c.period);

      // store values later after we finalize periods list
      // Temporary maps for this line
      const annualMap = new Map<string, number>();
      for (const c of annualCut) annualMap.set(periodKey(c.period), c.value);
      const quarterMap = new Map<string, number>();
      for (const c of quarterlyCut) quarterMap.set(periodKey(c.period), c.value);

      // Save by canonical id, values filled after periods are stabilized
      (annualStatements[stmtKey] as any)[line.id] = annualMap;
      (quarterlyStatements[stmtKey] as any)[line.id] = quarterMap;
    }
  }

  const annualPeriodList = uniquePeriodsSorted(annualPeriods).slice(0, Math.max(1, years));
  const quarterPeriodList = uniquePeriodsSorted(quarterPeriods).slice(0, Math.max(4, years * 4));

  // Convert maps to plain objects keyed by period end label.
  const annualOut: Record<string, Record<string, Record<string, number | null>>> = {};
  const quarterlyOut: Record<string, Record<string, Record<string, number | null>>> = {};

  for (const stmtKey of Object.keys(defs)) {
    annualOut[stmtKey] = {};
    quarterlyOut[stmtKey] = {};
    for (const line of defs[stmtKey]!.lines) {
      const aMap = (annualStatements[stmtKey] as any)[line.id] as Map<string, number> | undefined;
      const qMap = (quarterlyStatements[stmtKey] as any)[line.id] as Map<string, number> | undefined;
      const aRow: Record<string, number | null> = {};
      const qRow: Record<string, number | null> = {};
      for (const p of annualPeriodList) aRow[p.end] = aMap?.get(periodKey(p)) ?? null;
      for (const p of quarterPeriodList) qRow[p.end] = qMap?.get(periodKey(p)) ?? null;
      annualOut[stmtKey][line.id] = aRow;
      quarterlyOut[stmtKey][line.id] = qRow;
    }
  }

  return {
    ok: true,
    ticker,
    cik,
    entityName,
    fetchedAt: new Date().toISOString(),
    annual: { periods: annualPeriodList, statements: annualOut },
    quarterly: { periods: quarterPeriodList, statements: quarterlyOut },
  };
}

/**
 * Full fiscal-year facts keyed by period end date (YYYY-MM-DD).
 * SEC companyfacts often tags quarter / YTD duration rows as fp=FY; we require ~300–420 day duration
 * and an annual form so each fiscal year maps to one comparable value (latest filed restatement wins).
 */
function annualBestByPeriodEnd(
  facts: CompanyFactsJson,
  tags: string[],
  units: string[]
): Map<string, { value: number; period: XbrlPeriod }> {
  const cells: XbrlCell[] = [];
  for (const tag of tags) {
    for (const c of listCellsForTag(facts, "us-gaap", tag)) {
      if (!isFullYearAnnualCompanyFact(c.period)) continue;
      if (units.length && !units.includes(c.unit)) continue;
      cells.push(c);
    }
  }
  const byEnd = new Map<string, XbrlCell[]>();
  for (const c of cells) {
    const end = c.period.end;
    const arr = byEnd.get(end) ?? [];
    arr.push(c);
    byEnd.set(end, arr);
  }
  const out = new Map<string, { value: number; period: XbrlPeriod }>();
  for (const [end, arr] of Array.from(byEnd.entries())) {
    const best = pickLatestFiled(arr);
    if (best) out.set(end, { value: best.value, period: best.period });
  }
  return out;
}

/** Like {@link annualBestByPeriodEnd} but includes instant FY balance-sheet facts (same `end` key as duration flows). */
function annualSnapshotBestByPeriodEnd(
  facts: CompanyFactsJson,
  tags: string[],
  units: string[]
): Map<string, { value: number; period: XbrlPeriod }> {
  const cells: XbrlCell[] = [];
  for (const tag of tags) {
    for (const c of listCellsForTag(facts, "us-gaap", tag)) {
      if (!isFyAnnualSnapshotOrFullYearFact(c.period)) continue;
      if (units.length && !units.includes(c.unit)) continue;
      cells.push(c);
    }
  }
  const byEnd = new Map<string, XbrlCell[]>();
  for (const c of cells) {
    const end = c.period.end;
    const arr = byEnd.get(end) ?? [];
    arr.push(c);
    byEnd.set(end, arr);
  }
  const out = new Map<string, { value: number; period: XbrlPeriod }>();
  for (const [end, arr] of Array.from(byEnd.entries())) {
    const best = pickLatestFiled(arr);
    if (best) out.set(end, { value: best.value, period: best.period });
  }
  return out;
}

/** Prefer earlier tags in the list when several US-GAAP concepts exist for the same fiscal period end. */
function annualFirstTagByPeriodEnd(
  facts: CompanyFactsJson,
  tagsInOrder: string[],
  units: string[]
): Map<string, { value: number; period: XbrlPeriod }> {
  const out = new Map<string, { value: number; period: XbrlPeriod }>();
  for (const tag of tagsInOrder) {
    const m = annualBestByPeriodEnd(facts, [tag], units);
    for (const [end, row] of Array.from(m.entries())) {
      if (!out.has(end)) out.set(end, row);
    }
  }
  return out;
}

/**
 * Merge revenue-style tags: first finite value wins per `end`, but a later tag can replace a stored
 * zero (some filers leave legacy `Revenues` at 0 after adopting ASC 606 contract-revenue tags).
 */
function annualCoalesceTagsByPeriodEnd(
  facts: CompanyFactsJson,
  tagsInOrder: string[],
  units: string[]
): Map<string, { value: number; period: XbrlPeriod }> {
  const out = new Map<string, { value: number; period: XbrlPeriod }>();
  for (const tag of tagsInOrder) {
    const m = annualBestByPeriodEnd(facts, [tag], units);
    for (const [end, row] of m) {
      if (!Number.isFinite(row.value)) continue;
      const prev = out.get(end);
      if (prev == null) {
        out.set(end, row);
      } else if (prev.value === 0 && row.value !== 0) {
        out.set(end, row);
      }
    }
  }
  return out;
}

function annualFirstTagSnapshotByPeriodEnd(
  facts: CompanyFactsJson,
  tagsInOrder: string[],
  units: string[]
): Map<string, { value: number; period: XbrlPeriod }> {
  const out = new Map<string, { value: number; period: XbrlPeriod }>();
  for (const tag of tagsInOrder) {
    const m = annualSnapshotBestByPeriodEnd(facts, [tag], units);
    for (const [end, row] of Array.from(m.entries())) {
      if (!out.has(end)) out.set(end, row);
    }
  }
  return out;
}

const IMPAIRMENT_ADDBACK_TAGS_USGAAP = [
  "AssetImpairmentCharges",
  "GoodwillImpairmentLoss",
  "ImpairmentOfLongLivedAssetsHeldForUse",
  "ImpairmentOfLongLivedAssetsToBeDisposedOf",
] as const;

function impairmentOperatingAddbackByPeriodEnd(facts: CompanyFactsJson): Map<string, number> {
  const sums = new Map<string, number>();
  for (const tag of IMPAIRMENT_ADDBACK_TAGS_USGAAP) {
    const m = annualBestByPeriodEnd(facts, [tag], ["USD"]);
    for (const [end, row] of Array.from(m.entries())) {
      const { value } = row;
      if (!Number.isFinite(value)) continue;
      sums.set(end, (sums.get(end) ?? 0) + Math.abs(value));
    }
  }
  return sums;
}

/**
 * Total debt: prefer consolidated tags that already include short + long term (and current
 * maturities). Many cable / telecom filers (e.g. CABO) do **not** populate `ShortTermBorrowings` or
 * `CurrentPortionOfLongTermDebt` in USD; they use `LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities`
 * for the full carrying amount. `LongTermDebtAndCapitalLeaseObligations` alone is usually noncurrent only.
 */
function totalDebtByPeriodEnd(facts: CompanyFactsJson): Map<string, number | null> {
  const combinedFull = annualFirstTagSnapshotByPeriodEnd(
    facts,
    [
      "LongTermDebtAndShortTermDebt",
      "LongTermDebtNoncurrentAndShortTermDebtCurrent",
      "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
    ],
    ["USD"]
  );
  const combinedLtCap = annualFirstTagSnapshotByPeriodEnd(
    facts,
    ["LongTermDebtAndCapitalLeaseObligations"],
    ["USD"]
  );
  const shortTermLike = annualFirstTagSnapshotByPeriodEnd(
    facts,
    ["ShortTermBorrowings", "ShortTermDebt"],
    ["USD"]
  );
  const currentPortion = annualSnapshotBestByPeriodEnd(facts, ["CurrentPortionOfLongTermDebt"], ["USD"]);
  const currentPortionCapLease = annualSnapshotBestByPeriodEnd(
    facts,
    ["CurrentPortionOfLongTermDebtAndCapitalLeaseObligation"],
    ["USD"]
  );
  const commercialPaper = annualSnapshotBestByPeriodEnd(facts, ["CommercialPaper"], ["USD"]);
  const longTermDebtCurrent = annualSnapshotBestByPeriodEnd(facts, ["LongTermDebtCurrent"], ["USD"]);
  const ltNoncurrent = annualSnapshotBestByPeriodEnd(facts, ["LongTermDebtNoncurrent"], ["USD"]);
  const ltDebt = annualSnapshotBestByPeriodEnd(facts, ["LongTermDebt"], ["USD"]);
  const finLeaseCur = annualSnapshotBestByPeriodEnd(facts, ["FinanceLeaseLiabilityCurrent"], ["USD"]);
  const finLeaseNon = annualSnapshotBestByPeriodEnd(facts, ["FinanceLeaseLiabilityNoncurrent"], ["USD"]);

  const allEnds = new Set<string>();
  for (const m of [
    combinedFull,
    combinedLtCap,
    shortTermLike,
    currentPortion,
    currentPortionCapLease,
    commercialPaper,
    longTermDebtCurrent,
    ltNoncurrent,
    ltDebt,
    finLeaseCur,
    finLeaseNon,
  ]) {
    for (const end of Array.from(m.keys())) allEnds.add(end);
  }

  const out = new Map<string, number | null>();
  for (const end of Array.from(allEnds)) {
    const full = combinedFull.get(end)?.value;
    if (full != null && Number.isFinite(full)) {
      out.set(end, full);
      continue;
    }
    let sum = 0;
    let any = false;
    const add = (v: number | undefined) => {
      if (v != null && Number.isFinite(v)) {
        sum += v;
        any = true;
      }
    };

    const ltCap = combinedLtCap.get(end)?.value;
    if (ltCap != null && Number.isFinite(ltCap)) {
      sum += ltCap;
      any = true;
    }

    add(shortTermLike.get(end)?.value);
    add(currentPortion.get(end)?.value);
    add(currentPortionCapLease.get(end)?.value);
    add(commercialPaper.get(end)?.value);
    add(longTermDebtCurrent.get(end)?.value);
    add(finLeaseCur.get(end)?.value);

    if (ltCap == null) {
      const ltNc = ltNoncurrent.get(end)?.value;
      const lt = ltDebt.get(end)?.value;
      if (ltNc != null && Number.isFinite(ltNc)) add(ltNc);
      else if (lt != null && Number.isFinite(lt)) add(lt);
      add(finLeaseNon.get(end)?.value);
    }
    out.set(end, any ? sum : null);
  }
  return out;
}

/** Assets minus goodwill and intangibles (excluding goodwill); falls back to Assets − GoodwillAndIntangibleAssetsNet when not split. */
function tangibleAssetsByPeriodEnd(facts: CompanyFactsJson): Map<string, number | null> {
  const assetsM = annualSnapshotBestByPeriodEnd(facts, ["Assets"], ["USD"]);
  const goodwillM = annualSnapshotBestByPeriodEnd(facts, ["Goodwill"], ["USD"]);
  const intExM = annualSnapshotBestByPeriodEnd(facts, ["IntangibleAssetsNetExcludingGoodwill"], ["USD"]);
  const combinedM = annualSnapshotBestByPeriodEnd(facts, ["GoodwillAndIntangibleAssetsNet"], ["USD"]);

  const out = new Map<string, number | null>();
  for (const [end, row] of Array.from(assetsM.entries())) {
    const assets = row.value;
    if (!Number.isFinite(assets)) {
      out.set(end, null);
      continue;
    }
    const gw = goodwillM.get(end)?.value;
    const intEx = intExM.get(end)?.value;
    const comb = combinedM.get(end)?.value;
    let tangible: number;
    if ((gw != null && Number.isFinite(gw)) || (intEx != null && Number.isFinite(intEx))) {
      tangible = assets - (gw ?? 0) - (intEx ?? 0);
    } else if (comb != null && Number.isFinite(comb)) {
      tangible = assets - comb;
    } else {
      tangible = assets;
    }
    out.set(end, Number.isFinite(tangible) ? tangible : null);
  }
  return out;
}

const TAX_ADJ_EBIT_FACTOR = 0.74;

export type TwentyYearLookbackPoint = {
  /** Calendar year of fiscal period-end date (axis label); not always equal to SEC `fy` on comparative rows. */
  fy: number;
  periodEnd: string;
  netIncome: number | null;
  revenue: number | null;
  shares: number | null;
  /** Operating income (loss) plus add-backs of common impairment tags when separately disclosed. */
  operatingIncomeExImpairment: number | null;
  /** Net cash from operations minus capital expenditures (PPE payments); CapEx treated as absolute outflow. */
  ocfLessCapex: number | null;
  /** Total debt (USD); combined tag if filed, else sum of common debt/lease components. */
  totalDebt: number | null;
  /** ((OperatingIncomeLoss + impairment add-backs) × 0.74) / tangible assets; null if denominator ≤ 0. */
  taxAdjustedEbitToTangibleAssets: number | null;
};

export type TwentyYearLookbackResult = {
  ok: true;
  ticker: string;
  cik: string;
  entityName: string | null;
  fetchedAt: string;
  points: TwentyYearLookbackPoint[];
};

function calendarYearFromFactEnd(end: string): number {
  const y = parseInt(end.slice(0, 4), 10);
  return Number.isFinite(y) ? y : NaN;
}

function pickFlowValueForYear(
  m: Map<string, { value: number; period: XbrlPeriod }>,
  year: number,
  endsInYear: string[]
): number | null {
  for (let i = endsInYear.length - 1; i >= 0; i--) {
    const row = m.get(endsInYear[i]!);
    if (row != null && Number.isFinite(row.value)) return row.value;
  }
  for (const [end, row] of m) {
    if (calendarYearFromFactEnd(end) === year && Number.isFinite(row.value)) return row.value;
  }
  return null;
}

function pickNullableNumberForYear(m: Map<string, number | null>, year: number, endsInYear: string[]): number | null {
  for (let i = endsInYear.length - 1; i >= 0; i--) {
    const v = m.get(endsInYear[i]!);
    if (v != null && Number.isFinite(v)) return v;
  }
  for (const [end, v] of m) {
    if (calendarYearFromFactEnd(end) === year && v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function pickImpairmentForYear(imp: Map<string, number>, year: number, endsInYear: string[]): number {
  for (let i = endsInYear.length - 1; i >= 0; i--) {
    const v = imp.get(endsInYear[i]!);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  let best = 0;
  for (const [end, v] of imp) {
    if (calendarYearFromFactEnd(end) === year && typeof v === "number" && Number.isFinite(v)) best = Math.max(best, v);
  }
  return best;
}

/**
 * Build up to `maxYears` fiscal years of annual US-GAAP metrics from SEC companyfacts (data.sec.gov).
 */
export function buildTwentyYearLookbackFromFacts(
  ticker: string,
  cik: string,
  entityName: string | null,
  facts: CompanyFactsJson,
  maxYears = 20
): TwentyYearLookbackResult {
  const revenueM = annualCoalesceTagsByPeriodEnd(
    facts,
    [
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
    ],
    ["USD"]
  );
  const niM = annualBestByPeriodEnd(facts, ["NetIncomeLoss"], ["USD"]);
  const oiM = annualBestByPeriodEnd(facts, ["OperatingIncomeLoss"], ["USD"]);
  const cfoM = annualBestByPeriodEnd(facts, ["NetCashProvidedByUsedInOperatingActivities"], ["USD"]);
  const capexM = annualBestByPeriodEnd(facts, ["PaymentsToAcquirePropertyPlantAndEquipment"], ["USD"]);
  let sharesM = annualFirstTagByPeriodEnd(
    facts,
    [
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "WeightedAverageNumberOfSharesOutstandingBasicAndDiluted",
      "WeightedAverageNumberOfSharesOutstandingBasic",
    ],
    ["shares"]
  );
  if (sharesM.size === 0) {
    sharesM = annualFirstTagByPeriodEnd(
      facts,
      [
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "WeightedAverageNumberOfSharesOutstandingBasicAndDiluted",
        "WeightedAverageNumberOfSharesOutstandingBasic",
      ],
      []
    );
  }

  const impAdd = impairmentOperatingAddbackByPeriodEnd(facts);
  const totalDebtM = totalDebtByPeriodEnd(facts);
  const tangibleM = tangibleAssetsByPeriodEnd(facts);

  const allEnds = new Set<string>();
  for (const m of [revenueM, niM, oiM, cfoM, capexM, sharesM, totalDebtM, tangibleM]) {
    for (const end of Array.from(m.keys())) allEnds.add(end);
  }
  const sortedAsc = Array.from(allEnds).sort((a, b) => a.localeCompare(b));

  const yearSet = new Set<number>();
  for (const e of sortedAsc) {
    const y = calendarYearFromFactEnd(e);
    if (y >= 1900 && y <= 2100) yearSet.add(y);
  }
  const yearsSorted = Array.from(yearSet).sort((a, b) => a - b);
  const yearWindow = yearsSorted.slice(-Math.max(1, maxYears));

  const endsForCalendarYear = (year: number): string[] => sortedAsc.filter((e) => calendarYearFromFactEnd(e) === year);

  const points: TwentyYearLookbackPoint[] = yearWindow.map((year) => {
    const endsInYear = endsForCalendarYear(year);
    const periodEnd = endsInYear.length ? endsInYear[endsInYear.length - 1]! : `${year}-12-31`;

    const oi = pickFlowValueForYear(oiM, year, endsInYear);
    const add = pickImpairmentForYear(impAdd, year, endsInYear);
    const operatingIncomeExImpairment = oi != null ? oi + add : null;

    const cfo = pickFlowValueForYear(cfoM, year, endsInYear);
    const capex = pickFlowValueForYear(capexM, year, endsInYear);
    let ocfLessCapex: number | null = null;
    if (cfo != null && capex != null) ocfLessCapex = cfo - Math.abs(capex);
    else if (cfo != null) ocfLessCapex = cfo;

    const tangible = pickNullableNumberForYear(tangibleM, year, endsInYear);
    let taxAdjustedEbitToTangibleAssets: number | null = null;
    if (operatingIncomeExImpairment != null && tangible != null && Number.isFinite(tangible) && tangible > 0) {
      taxAdjustedEbitToTangibleAssets = (TAX_ADJ_EBIT_FACTOR * operatingIncomeExImpairment) / tangible;
    }

    return {
      fy: year,
      periodEnd,
      netIncome: pickFlowValueForYear(niM, year, endsInYear),
      revenue: pickFlowValueForYear(revenueM, year, endsInYear),
      shares: pickFlowValueForYear(sharesM, year, endsInYear),
      operatingIncomeExImpairment,
      ocfLessCapex,
      totalDebt: pickNullableNumberForYear(totalDebtM, year, endsInYear),
      taxAdjustedEbitToTangibleAssets,
    };
  });

  return {
    ok: true,
    ticker,
    cik,
    entityName,
    fetchedAt: new Date().toISOString(),
    points,
  };
}

