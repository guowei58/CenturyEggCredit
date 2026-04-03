import type { ResearchProfile } from "./types";
import { uniq } from "./utils";

export function buildProfile(params: { ticker: string; companyName?: string; aliases?: string[] }): ResearchProfile {
  const ticker = (params.ticker ?? "").trim().toUpperCase();
  const companyName = params.companyName?.trim() || undefined;
  const aliases = uniq((params.aliases ?? []).map((a) => a.trim()).filter(Boolean)).slice(0, 10);

  const terms: string[] = [];
  if (ticker) terms.push(`"${ticker}"`);
  if (companyName) terms.push(`"${companyName}"`);
  for (const a of aliases) terms.push(`"${a}"`);

  // cross terms
  if (ticker && companyName) terms.push(`"${companyName}" ${ticker}`);
  for (const a of aliases.slice(0, 3)) {
    if (ticker) terms.push(`"${a}" ${ticker}`);
  }

  return { ticker, companyName, aliases, terms: uniq(terms) };
}

