/**
 * Financial Modeling Prep (FMP) — financial statement helpers (server-side).
 * Uses current **stable** endpoints (`/stable/...`). Legacy `/api/v3/...` returns 403 for new accounts.
 * Docs: https://site.financialmodelingprep.com/developer/docs/stable
 */

const FMP_STABLE = "https://financialmodelingprep.com/stable";

export type FmpPeriodKind = "annual" | "quarter";

export type FmpStatementRecord = Record<string, unknown>;

const META_KEYS = new Set([
  "date",
  "symbol",
  "reportedCurrency",
  "cik",
  "fillingDate",
  "acceptedDate",
  "fiscalYear",
  "link",
  "finalLink",
]);

function calendarYearNum(row: FmpStatementRecord): number | null {
  const cy = row.calendarYear;
  if (typeof cy === "number" && Number.isFinite(cy)) return cy;
  if (typeof cy === "string") {
    const n = parseInt(cy, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isYearlyRange(y: number, min: number, max: number): boolean {
  return y >= min && y <= max;
}

export function filterAnnualByYears(data: FmpStatementRecord[] | null | undefined, minYear: number, maxYear: number): FmpStatementRecord[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row) => {
      const cy = calendarYearNum(row);
      if (cy === null) return false;
      return isYearlyRange(cy, minYear, maxYear);
    })
    .sort((a, b) => (calendarYearNum(a) ?? 0) - (calendarYearNum(b) ?? 0));
}

export function filterQuarterlyByYears(data: FmpStatementRecord[] | null | undefined, minYear: number, maxYear: number): FmpStatementRecord[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row) => {
      const cy = calendarYearNum(row);
      if (cy === null) return false;
      return isYearlyRange(cy, minYear, maxYear);
    })
    .sort((a, b) => {
      const ya = calendarYearNum(a) ?? 0;
      const yb = calendarYearNum(b) ?? 0;
      if (ya !== yb) return ya - yb;
      const qa = quarterOrder(a.period as string | undefined);
      const qb = quarterOrder(b.period as string | undefined);
      return qa - qb;
    });
}

function quarterOrder(period: string | undefined): number {
  if (!period) return 0;
  const m = /^Q([1-4])$/i.exec(period.trim());
  return m ? parseInt(m[1], 10) : 0;
}

export function periodLabelAnnual(row: FmpStatementRecord): string {
  const y = calendarYearNum(row);
  return y !== null ? `FY ${y}` : String(row.date ?? "");
}

export function periodLabelQuarter(row: FmpStatementRecord): string {
  const y = calendarYearNum(row);
  const q = row.period;
  if (y !== null && typeof q === "string" && q) return `${q} ${y}`;
  return String(row.date ?? "");
}

export function collectLineItemKeys(rows: FmpStatementRecord[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (META_KEYS.has(k) || k === "calendarYear" || k === "period") continue;
      const v = row[k];
      if (typeof v === "number" || v === null) keys.add(k);
    }
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

export function formatLineItemLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    const abs = Math.abs(v);
    if (abs >= 1e9) return `${v < 0 ? "−" : ""}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${v < 0 ? "−" : ""}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${v < 0 ? "−" : ""}$${(abs / 1e3).toFixed(2)}K`;
    return `${v < 0 ? "−" : ""}$${abs.toFixed(0)}`;
  }
  return String(v);
}

function parseFmpErrorBody(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const msg = (json as { "Error Message"?: string })["Error Message"];
  return typeof msg === "string" && msg.trim() ? msg.trim() : null;
}

/**
 * Stable API: `GET /stable/{endpoint}?symbol=...&period=annual|quarter&limit=...&apikey=...`
 * e.g. `income-statement`, `balance-sheet-statement`, `cash-flow-statement`
 */
export async function fmpFetchStable(endpoint: string, search: Record<string, string>, apiKey: string): Promise<unknown> {
  const clean = endpoint.replace(/^\/+/, "");
  const url = new URL(`${FMP_STABLE}/${clean}`);
  url.searchParams.set("apikey", apiKey);
  for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`FMP ${res.status}: ${text.slice(0, 200) || "Invalid JSON"}`);
  }

  const errMsg = parseFmpErrorBody(json);
  if (!res.ok) {
    throw new Error(`FMP ${res.status}: ${errMsg ?? JSON.stringify(json).slice(0, 300)}`);
  }
  if (errMsg) {
    throw new Error(`FMP: ${errMsg}`);
  }

  return json;
}

export async function fetchStatementsForSymbol(
  symbol: string,
  apiKey: string
): Promise<{
  incomeAnnual: FmpStatementRecord[];
  incomeQuarter: FmpStatementRecord[];
  balanceAnnual: FmpStatementRecord[];
  balanceQuarter: FmpStatementRecord[];
  cashAnnual: FmpStatementRecord[];
  cashQuarter: FmpStatementRecord[];
}> {
  const sym = symbol.trim().toUpperCase();
  const common = { limit: "400", symbol: sym };

  const [incA, incQ, balA, balQ, cfA, cfQ] = await Promise.all([
    fmpFetchStable("income-statement", { ...common, period: "annual" }, apiKey),
    fmpFetchStable("income-statement", { ...common, period: "quarter" }, apiKey),
    fmpFetchStable("balance-sheet-statement", { ...common, period: "annual" }, apiKey),
    fmpFetchStable("balance-sheet-statement", { ...common, period: "quarter" }, apiKey),
    fmpFetchStable("cash-flow-statement", { ...common, period: "annual" }, apiKey),
    fmpFetchStable("cash-flow-statement", { ...common, period: "quarter" }, apiKey),
  ]);

  const asRows = (x: unknown): FmpStatementRecord[] => (Array.isArray(x) ? (x as FmpStatementRecord[]) : []);

  return {
    incomeAnnual: filterAnnualByYears(asRows(incA), 2017, 2019),
    incomeQuarter: filterQuarterlyByYears(asRows(incQ), 2020, 2025),
    balanceAnnual: filterAnnualByYears(asRows(balA), 2017, 2019),
    balanceQuarter: filterQuarterlyByYears(asRows(balQ), 2020, 2025),
    cashAnnual: filterAnnualByYears(asRows(cfA), 2017, 2019),
    cashQuarter: filterQuarterlyByYears(asRows(cfQ), 2020, 2025),
  };
}

export type AnnualNetIncomePoint = {
  fiscalYear: number;
  /** As reported on the income statement (FMP field `netIncome`). */
  netIncome: number | null;
  reportedCurrency: string | null;
  /** SEC filing URL when FMP provides `finalLink` or `link`. */
  filingUrl: string | null;
};

/**
 * Latest `maxYears` fiscal years of annual net income (GAAP as reported in filings), oldest → newest.
 * Uses stable `income-statement` with `period=annual`.
 */
export async function fetchAnnualNetIncomeHistory(
  symbol: string,
  apiKey: string,
  maxYears = 20
): Promise<{ points: AnnualNetIncomePoint[]; cik: string | null }> {
  const sym = symbol.trim().toUpperCase();
  const limit = Math.min(120, Math.max(maxYears + 15, 40));
  const raw = await fmpFetchStable("income-statement", { symbol: sym, period: "annual", limit: String(limit) }, apiKey);
  const rows = (Array.isArray(raw) ? raw : []) as FmpStatementRecord[];

  let cik: string | null = null;
  const byYear = new Map<number, AnnualNetIncomePoint>();

  for (const row of rows) {
    const y = calendarYearNum(row);
    if (y === null) continue;
    if (!cik) {
      const rawCik = row.cik;
      if (typeof rawCik === "string" && rawCik.trim()) cik = rawCik.trim();
      else if (typeof rawCik === "number" && Number.isFinite(rawCik)) cik = String(rawCik);
    }
    if (byYear.has(y)) continue;

    const ni = row.netIncome;
    const netIncome = typeof ni === "number" && Number.isFinite(ni) ? ni : null;
    const cur = row.reportedCurrency;
    const reportedCurrency = typeof cur === "string" && cur.trim() ? cur.trim() : null;
    const fl = row.finalLink;
    const lk = row.link;
    const filingUrl =
      typeof fl === "string" && /^https?:\/\//i.test(fl.trim())
        ? fl.trim()
        : typeof lk === "string" && /^https?:\/\//i.test(lk.trim())
          ? lk.trim()
          : null;

    byYear.set(y, { fiscalYear: y, netIncome, reportedCurrency, filingUrl });
  }

  const sorted = Array.from(byYear.values()).sort((a, b) => a.fiscalYear - b.fiscalYear);
  const points = sorted.slice(-maxYears);
  return { points, cik };
}
