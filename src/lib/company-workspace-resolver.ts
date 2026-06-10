import {
  getCikFromTicker,
  getCompanyMetadataByCik,
  secCompanyTickerLookupCandidates,
  searchSecCompaniesByName,
} from "@/lib/sec-edgar";
import { parseCompanyLookupInput } from "@/lib/company-workspace-key";

export type ResolvedCompanyWorkspace = {
  /** Key used for watchlist, saved data, and API routes (`[ticker]` param). */
  workspaceKey: string;
  cik: string;
  /** Listed ticker when the filer has one; null for CIK-only entities. */
  ticker: string | null;
  companyName: string;
  inputKind: "cik" | "ticker";
};

/**
 * Resolve ticker, CIK, or (fallback) company name to a workspace the app can open.
 * Server-only — imports SEC EDGAR helpers.
 */
export async function resolveCompanyWorkspace(
  input: string
): Promise<ResolvedCompanyWorkspace | { error: string }> {
  const parsed = parseCompanyLookupInput(input);
  if (!parsed) {
    return { error: "Enter a ticker symbol or SEC CIK (6–10 digits, optional CIK prefix)." };
  }

  if (parsed.kind === "cik") {
    const meta = await getCompanyMetadataByCik(parsed.normalized);
    if (!meta) {
      return { error: "Could not load SEC submissions for this CIK. Check the number and try again." };
    }
    return {
      workspaceKey: parsed.normalized,
      cik: parsed.normalized,
      ticker: meta.tickers[0] ?? null,
      companyName: meta.name,
      inputKind: "cik",
    };
  }

  for (const sym of secCompanyTickerLookupCandidates(parsed.normalized)) {
    if (sym.length > 12) continue;
    const cik = await getCikFromTicker(sym);
    if (!cik) continue;
    const meta = await getCompanyMetadataByCik(cik);
    return {
      workspaceKey: sym,
      cik,
      ticker: sym,
      companyName: meta?.name ?? sym,
      inputKind: "ticker",
    };
  }

  const hits = await searchSecCompaniesByName(parsed.normalized, 8);
  if (hits.length === 0) {
    return {
      error:
        "No SEC issuer matched. For subsidiaries or acquired filers without a ticker, enter the entity's CIK.",
    };
  }
  const best = hits[0];
  const meta = await getCompanyMetadataByCik(best.cik);
  const listedTicker = best.ticker !== "—" ? best.ticker : meta?.tickers[0] ?? null;
  return {
    workspaceKey: listedTicker ?? best.cik,
    cik: best.cik,
    ticker: listedTicker,
    companyName: meta?.name ?? best.title,
    inputKind: listedTicker ? "ticker" : "cik",
  };
}
