/**
 * SEC EDGAR API — filings only. Free, no auth.
 * See: https://www.sec.gov/edgar/sec-api-documentation
 * Rate limit: 10 requests per second per IP. User-Agent required.
 */

const USER_AGENT = "CenturyEggCredit research app (mailto:support@example.com)";

export type SecFiling = {
  form: string;
  filingDate: string;
  description: string;
  accessionNumber: string;
  primaryDocument: string;
  docUrl: string;
};

export type SecFilingsResult = {
  companyName: string;
  cik: string;
  filings: SecFiling[];
};

type CompanyTickersEntry = { cik_str: number; ticker: string; title: string };
type CompanyTickersJson = Record<string, CompanyTickersEntry>;

type SubmissionsRecent = {
  accessionNumber?: string[];
  filingDate?: string[];
  form?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
};

type SubmissionsJson = {
  name?: string;
  cik?: string;
  sic?: string;
  sicDescription?: string;
  stateOfIncorporation?: string;
  fiscalYearEnd?: string;
  filings?: { recent?: SubmissionsRecent };
};

export type SecCompanyProfile = {
  name: string;
  ticker: string;
  cik: string;
  sic: string;
  sicDescription: string;
  stateOfIncorporation: string;
  fiscalYearEnd: string;
  filingsCount: number;
};

/**
 * Fetch the SEC company tickers JSON and resolve ticker -> CIK (10-digit string).
 */
export async function getCikFromTicker(ticker: string): Promise<string | null> {
  const url = "https://www.sec.gov/files/company_tickers.json";
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const data = (await res.json()) as CompanyTickersJson;
  const upper = ticker.trim().toUpperCase();
  for (const key of Object.keys(data)) {
    const entry = data[key];
    if (entry.ticker && entry.ticker.toUpperCase() === upper) {
      return String(entry.cik_str).padStart(10, "0");
    }
  }
  return null;
}

/**
 * Fetch company submissions for a CIK and return recent filings with document URLs.
 */
export async function getFilingsByCik(cik: string): Promise<SecFilingsResult | null> {
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const data = (await res.json()) as SubmissionsJson;
  const recent = data.filings?.recent;
  if (!recent || !Array.isArray(recent.accessionNumber)) {
    return { companyName: data.name ?? "Unknown", cik: padded, filings: [] };
  }
  const companyName = data.name ?? "Unknown";
  const filings: SecFiling[] = [];
  const len = recent.accessionNumber.length;
  for (let i = 0; i < len; i++) {
    const acc = recent.accessionNumber[i] ?? "";
    const accNoDashes = acc.replace(/-/g, "");
    const doc = recent.primaryDocument?.[i] ?? "";
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(padded, 10)}/${accNoDashes}/${doc}`;
    filings.push({
      form: recent.form?.[i] ?? "",
      filingDate: recent.filingDate?.[i] ?? "",
      description: recent.primaryDocDescription?.[i] ?? "",
      accessionNumber: acc,
      primaryDocument: doc,
      docUrl,
    });
  }
  return { companyName, cik: padded, filings };
}

/**
 * Resolve ticker to CIK, then fetch and return recent filings.
 */
export async function getFilingsByTicker(ticker: string): Promise<SecFilingsResult | null> {
  const cik = await getCikFromTicker(ticker);
  if (!cik) return null;
  return getFilingsByCik(cik);
}

/**
 * Fetch company profile from SEC submissions (name, industry, state, FY end, filings count).
 * No business description or financials — those would require 10-K parsing or other sources.
 */
export async function getCompanyProfile(ticker: string): Promise<SecCompanyProfile | null> {
  const cik = await getCikFromTicker(ticker);
  if (!cik) return null;
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const data = (await res.json()) as SubmissionsJson;
  const recent = data.filings?.recent;
  const filingsCount = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber.length : 0;
  const fy = data.fiscalYearEnd?.replace(/-/g, "").trim();
  const fiscalYearEnd = fy && fy.length >= 4 ? `${fy.slice(0, 2)}/${fy.slice(2)}` : "—";
  return {
    name: data.name ?? ticker,
    ticker: ticker.trim().toUpperCase(),
    cik: padded,
    sic: data.sic ?? "—",
    sicDescription: data.sicDescription ?? "—",
    stateOfIncorporation: data.stateOfIncorporation ?? "—",
    fiscalYearEnd,
    filingsCount,
  };
}
