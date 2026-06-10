import { getCandidateWebsites } from "@/lib/presentations/candidates";
import { parseFiscalPeriodToken } from "../period";
import type { PresentationDiscoveryInput, RawPresentationLink } from "../types";

type Q4FinancialDocument = {
  DocumentCategory?: string;
  DocumentFileType?: string;
  DocumentPath?: string;
  DocumentTitle?: string;
};

type Q4FinancialReport = {
  ReportSubType?: string;
  ReportTitle?: string;
  ReportYear?: number;
  Documents?: Q4FinancialDocument[];
};

const Q4_SUBTYPE_BY_QUARTER = ["First Quarter", "Second Quarter", "Third Quarter", "Fourth Quarter"] as const;

const CORP_NAME_STOPWORDS = new Set(["inc", "corp", "corporation", "company", "co", "ltd", "plc", "llc", "the"]);

function companySlugTokens(companyName: string, ticker: string): string[] {
  const words = companyName
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !CORP_NAME_STOPWORDS.has(t));
  const compact = words.join("");
  const tokens = words.filter((t) => t.length >= 4);
  if (compact.length >= 5) tokens.push(compact);
  if (ticker.trim().length >= 2) tokens.push(ticker.trim().toLowerCase());
  return [...new Set(tokens)];
}

function hostnameMatchesCompany(host: string, companyName: string, ticker: string): boolean {
  const h = host.toLowerCase().replace(/[^a-z0-9]/g, "");
  return companySlugTokens(companyName, ticker).some((tok) => {
    const t = tok.replace(/[^a-z0-9]/g, "");
    const minLen = t === ticker.trim().toLowerCase() ? 2 : 4;
    return t.length >= minLen && h.includes(t);
  });
}

/** Only Q4 investor-site origins that plausibly belong to the target company. */
function irOriginsFromCandidates(
  candidates: { url: string }[],
  companyName: string,
  ticker: string
): string[] {
  const origins: string[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    try {
      const u = new URL(c.url);
      const host = u.hostname.toLowerCase();
      const isInvestorHost = host.includes("investor") || host.startsWith("ir.");
      if (!isInvestorHost) continue;
      if (!hostnameMatchesCompany(host, companyName, ticker)) continue;
      if (seen.has(u.origin)) continue;
      seen.add(u.origin);
      origins.push(u.origin);
    } catch {
      /* skip */
    }
  }

  return origins;
}

async function fetchQ4FinancialReports(origin: string): Promise<Q4FinancialReport[]> {
  const feedUrl = `${origin.replace(/\/+$/, "")}/feed/FinancialReport.svc/GetFinancialReportList?languageId=1`;
  try {
    const res = await fetch(feedUrl, {
      headers: { Accept: "application/json", "User-Agent": "CenturyEggCredit/1.0 (presentation discovery)" },
      signal: AbortSignal.timeout(18_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { GetFinancialReportListResult?: Q4FinancialReport[] };
    const rows = data.GetFinancialReportListResult;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function pickQ4ReportForPeriod(reports: Q4FinancialReport[], period: string): Q4FinancialReport | null {
  const fp = parseFiscalPeriodToken(period);
  if (!fp || reports.length === 0) return null;

  const targetSubType = fp.label.startsWith("FY")
    ? "Fourth Quarter"
    : Q4_SUBTYPE_BY_QUARTER[fp.quarter - 1];

  const exact = reports.find((r) => r.ReportSubType === targetSubType && r.ReportYear === fp.year);
  if (exact) return exact;

  const sameQuarter = reports.find((r) => r.ReportSubType === targetSubType);
  if (sameQuarter) return sameQuarter;

  return reports[0] ?? null;
}

function fallbackInvestorOrigins(companyName: string, ticker: string): string[] {
  const words = companyName
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !CORP_NAME_STOPWORDS.has(t));
  const compact = words.join("");
  const out: string[] = [];
  if (compact.length >= 5) out.push(`https://investor.${compact}.com`);
  if (words.length >= 2) {
    out.push(`https://investor.${words[0]}.com`);
    out.push(`https://ir.${words[0]}.com`);
  }
  if (ticker.length >= 2) out.push(`https://investor.${ticker.toLowerCase()}.com`);
  return [...new Set(out)];
}

async function resolveQ4IrOrigins(
  candidates: { url: string }[],
  companyName: string,
  ticker: string
): Promise<string[]> {
  const matched = irOriginsFromCandidates(candidates, companyName, ticker);
  if (matched.length > 0) return matched;

  const fallbacks = fallbackInvestorOrigins(companyName, ticker);
  const verified: string[] = [];
  for (const origin of fallbacks) {
    const reports = await fetchQ4FinancialReports(origin);
    if (reports.length > 0) verified.push(origin);
  }
  return verified;
}

/** Q4 Investor Relations JSON feed — primary source for decks on sites like investor.gendigital.com. */
export async function discoverQ4IrPresentations(input: PresentationDiscoveryInput): Promise<RawPresentationLink[]> {
  const { candidates, companyName } = await getCandidateWebsites(input.ticker);
  const name = input.companyName || companyName;
  const origins = await resolveQ4IrOrigins(candidates, name, input.ticker);
  const results: RawPresentationLink[] = [];

  for (const origin of origins.slice(0, 2)) {
    const reports = await fetchQ4FinancialReports(origin);
    if (reports.length === 0) continue;

    const report = pickQ4ReportForPeriod(reports, input.period);
    if (!report?.Documents?.length) continue;

    const presentation = report.Documents.find(
      (d) =>
        d.DocumentCategory === "presentation" &&
        typeof d.DocumentPath === "string" &&
        /\.pdf$/i.test(d.DocumentPath)
    );
    if (!presentation?.DocumentPath) continue;

    results.push({
      url: presentation.DocumentPath,
      title: presentation.DocumentTitle?.trim() || presentation.DocumentPath.split("/").pop() || "Investor presentation",
      source_page_url: `${origin}/financials/quarterly-results/default.aspx`,
      source_type: "q4_ir",
      file_type: "pdf",
      document_date: null,
      pre_score: 85,
      evidence: ["q4_financial_feed", "document_category:presentation", `report:${report.ReportTitle ?? report.ReportSubType ?? ""}`],
    });
  }

  return results;
}
