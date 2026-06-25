import type { ResearchProfile } from "./types";
import { isPrivateWorkspaceKey, workspaceSearchCompanyName } from "@/lib/company-workspace-key";
import { uniq } from "./utils";

export function buildProfile(params: { ticker: string; companyName?: string; aliases?: string[] }): ResearchProfile {
  const rawTicker = (params.ticker ?? "").trim().toUpperCase();
  const isPrivate = isPrivateWorkspaceKey(rawTicker);
  const ticker = rawTicker;
  const companyName = isPrivate
    ? workspaceSearchCompanyName(rawTicker, params.companyName)
    : params.companyName?.trim() || undefined;
  const aliases = uniq((params.aliases ?? []).map((a) => a.trim()).filter(Boolean)).slice(0, 10);

  const terms: string[] = [];
  if (ticker && !isPrivate) terms.push(`"${ticker}"`);
  if (companyName) terms.push(`"${companyName}"`);
  for (const a of aliases) terms.push(`"${a}"`);

  if (!isPrivate && ticker && companyName) terms.push(`"${companyName}" ${ticker}`);
  for (const a of aliases.slice(0, 3)) {
    if (!isPrivate && ticker) terms.push(`"${a}" ${ticker}`);
  }

  return { ticker, companyName, aliases, terms: uniq(terms) };
}

