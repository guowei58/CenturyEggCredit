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

export function buildProviderQueries(providerId: ResearchProviderId, profile: ResearchProfile, maxQueries: number): string[] {
  const p = getProviderById(providerId);
  if (!p) return [];

  const domainQs = p.domains.map((d) => `site:${d}`);
  const terms = profile.terms;
  const rc = researchClause();

  const templates: string[] = [];
  for (const site of domainQs) {
    for (const t of terms.slice(0, 6)) {
      templates.push(`${site} ${t} ${rc}`);
      templates.push(`${site} ${t}`);
    }
  }

  // WSJ-specific: focus to bankruptcy path
  if (providerId === "wsj_bankruptcy") {
    const wsjSite = "site:wsj.com";
    for (const t of terms.slice(0, 5)) {
      templates.push(`${wsjSite} ${t} (pro bankruptcy OR "Pro Bankruptcy") ${rc}`);
      templates.push(`${wsjSite} ${t} (bankruptcy OR restructuring OR distressed)`);
    }
  }

  const out = uniq(templates.map((s) => s.replace(/\s+/g, " ").trim()));
  return out.slice(0, maxQueries);
}

