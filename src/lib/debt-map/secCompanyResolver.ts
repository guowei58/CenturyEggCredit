import { resolveCompanyWorkspace } from "@/lib/company-workspace-resolver";

export type ResolvedCompany = {
  cik: string;
  companyName: string;
  ticker: string | null;
};

/**
 * Resolve user input to SEC CIK: numeric CIK, ticker symbol, or company name search against SEC company_tickers.
 */
export async function resolveCompanyForDebtMap(input: string): Promise<ResolvedCompany | { error: string }> {
  const raw = input.trim();
  if (!raw) return { error: "Enter a company name, ticker, or CIK." };

  const resolved = await resolveCompanyWorkspace(raw);
  if ("error" in resolved) return resolved;

  return {
    cik: resolved.cik,
    companyName: resolved.companyName,
    ticker: resolved.ticker,
  };
}
