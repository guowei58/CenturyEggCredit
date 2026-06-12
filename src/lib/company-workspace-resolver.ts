import {
  getCikFromTicker,
  getCompanyMetadataByCik,
  secCompanyTickerLookupCandidates,
} from "@/lib/sec-edgar";
import {
  parseCompanyLookupInput,
  privateWorkspaceKeyFromName,
} from "@/lib/company-workspace-key";

export type ResolvedCompanyWorkspace = {
  /** Key used for watchlist, saved data, and API routes (`[ticker]` param). */
  workspaceKey: string;
  cik: string | null;
  /** Listed ticker when the filer has one; null for CIK-only or private entities. */
  ticker: string | null;
  companyName: string;
  inputKind: "cik" | "ticker" | "private";
  isPrivate: boolean;
};

function resolvePrivateWorkspace(displayName: string): ResolvedCompanyWorkspace {
  const name = displayName.trim();
  return {
    workspaceKey: privateWorkspaceKeyFromName(name),
    cik: null,
    ticker: null,
    companyName: name,
    inputKind: "private",
    isPrivate: true,
  };
}

/**
 * Resolve ticker, CIK, or (fallback) company name to a workspace the app can open.
 * Server-only — imports SEC EDGAR helpers.
 */
export async function resolveCompanyWorkspace(
  input: string
): Promise<ResolvedCompanyWorkspace | { error: string }> {
  const parsed = parseCompanyLookupInput(input);
  if (!parsed) {
    return { error: "Enter a ticker, SEC CIK, or company name." };
  }

  if (parsed.kind === "name") {
    return resolvePrivateWorkspace(parsed.normalized);
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
      isPrivate: false,
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
      isPrivate: false,
    };
  }

  return resolvePrivateWorkspace(input);
}
