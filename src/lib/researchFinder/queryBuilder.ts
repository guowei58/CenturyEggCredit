import type { ResearchProviderId, ResearchProfile } from "./types";
import { getProviderById } from "./providers";
import { uniq } from "./utils";

const RESEARCH_TERMS = [
  "research",
  "report",
  "analysis",
  "note",
  "insight",
  "webinar",
  "podcast",
  "transcript",
  "presentation",
  "distressed",
  "restructuring",
  "covenant",
  "credit",
  "high yield",
  "leveraged loan",
  "LBO",
  "default",
  "maturity",
  "refinancing",
  "bankruptcy",
  "chapter 11",
];

function researchClause(): string {
  return `(${RESEARCH_TERMS.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" OR ")})`;
}

/**
 * One consolidated query per provider (was many site×term pairs). Cuts Serper calls sharply.
 * `maxQueries` limits how many profile `terms` enter the OR group (breadth vs query length).
 */
export function buildProviderQueries(providerId: ResearchProviderId, profile: ResearchProfile, maxQueries: number): string[] {
  const p = getProviderById(providerId);
  if (!p) return [];

  const domainQs = p.domains.map((d) => `site:${d}`);
  const sitesGroup = domainQs.join(" OR ");
  const termLimit = Math.min(8, Math.max(3, maxQueries));
  const terms = profile.terms.slice(0, termLimit);
  const termOr = terms.join(" OR ");
  const rc = researchClause();

  if (providerId === "wsj_bankruptcy") {
    const wsj = domainQs[0] ?? "site:wsj.com";
    const q = `${wsj} (${termOr}) ((${rc}) OR ("Pro Bankruptcy" OR "pro bankruptcy") OR (bankruptcy OR restructuring OR distressed))`;
    return [uniq([q.replace(/\s+/g, " ").trim()])[0]!];
  }

  const q = `(${sitesGroup}) (${termOr}) ${rc}`;
  return [q.replace(/\s+/g, " ").trim()];
}
