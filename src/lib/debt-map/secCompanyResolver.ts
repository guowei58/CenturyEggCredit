import {
  getCikFromTicker,
  getCompanyMetadataByCik,
  normalizeCikInput,
  searchSecCompaniesByName,
  secCompanyTickerLookupCandidates,
} from "@/lib/sec-edgar";

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

  const directCik = normalizeCikInput(raw);
  if (directCik) {
    const meta = await getCompanyMetadataByCik(directCik);
    if (!meta) return { error: "Could not load SEC submissions for this CIK." };
    return {
      cik: directCik,
      companyName: meta.name,
      ticker: meta.tickers[0] ?? null,
    };
  }

  for (const sym of secCompanyTickerLookupCandidates(raw)) {
    if (sym.length > 8) continue;
    const cik = await getCikFromTicker(sym);
    if (cik) {
      const meta = await getCompanyMetadataByCik(cik);
      return {
        cik,
        companyName: meta?.name ?? sym,
        ticker: sym,
      };
    }
  }

  const hits = await searchSecCompaniesByName(raw, 8);
  if (hits.length === 0) {
    return { error: "No SEC issuer matched. Try a ticker (e.g. LUMN) or a 10-digit CIK." };
  }
  const best = hits[0];
  const meta = await getCompanyMetadataByCik(best.cik);
  return {
    cik: best.cik,
    companyName: meta?.name ?? best.title,
    ticker: best.ticker !== "—" ? best.ticker : null,
  };
}
