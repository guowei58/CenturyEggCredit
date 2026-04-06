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

