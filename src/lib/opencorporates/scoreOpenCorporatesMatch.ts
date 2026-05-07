import {
  exhibitMatchesLeiLegalName,
  gleifLegalNameSimilarity,
} from "@/lib/gleif/exhibitMatchesLeiLegalName";
import type { OpenCorporatesCompanyHit } from "@/lib/opencorporates/types";
import { normalizeSubsidiaryNameForOpenCorporates } from "@/lib/opencorporates/subsidiaryNameNormalize";

export type ConfidenceBand = "high" | "medium" | "low";

export type ScoredHit = {
  hit: OpenCorporatesCompanyHit;
  score: number;
  matchConfidence: ConfidenceBand;
  addressConfidence: ConfidenceBand;
  breakdown: string[];
  /** Shared tokens / substring — unrelated LEI rows (same jurisdiction only) are false. */
  namePlausible: boolean;
};

function normLegal(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function exactLegalMatch(exhibit: string, ocName: string): boolean {
  return normLegal(exhibit) === normLegal(ocName);
}

function normalizedNameMatch(exhibit: string, ocName: string): boolean {
  const a = normalizeSubsidiaryNameForOpenCorporates(exhibit);
  const b = normalizeSubsidiaryNameForOpenCorporates(ocName);
  return a.length >= 4 && a === b;
}

/** Exhibit-derived filter vs LEI record `entity.jurisdiction` (GLEIF ISO region codes). */
function leiJurisdictionMatch(expectedLei: string | null | undefined, actual: string): boolean {
  if (!expectedLei) return false;
  return expectedLei.trim().toUpperCase() === actual.trim().toUpperCase();
}

function isActive(hit: OpenCorporatesCompanyHit): boolean {
  if (hit.inactive === true) return false;
  const st = (hit.current_status ?? "").toLowerCase();
  if (!st) return true;
  if (/\bdissolv|inactive|withdraw|terminated\b/i.test(st)) return false;
  return true;
}

export function scoreOpenCorporatesCandidate(params: {
  exhibitLegalName: string;
  /** GLEIF `entity.jurisdiction` when Exhibit domicile mapped (e.g. US-DE, GB). */
  exhibitLeiJurisdiction: string | null;
  normalizedExhibitName: string;
  hit: OpenCorporatesCompanyHit;
  /** Search was run without jurisdiction filter — penalize mismatch harder when mapping existed elsewhere */
  searchHadJurisdictionFilter: boolean;
  /** Many hits returned — ambiguity penalty */
  ambiguousPool: boolean;
}): ScoredHit {
  const { exhibitLegalName, exhibitLeiJurisdiction, normalizedExhibitName, hit, ambiguousPool } = params;
  let score = 0;
  const breakdown: string[] = [];

  const namePlausible = exhibitMatchesLeiLegalName(exhibitLegalName, hit.name);
  const nameSim = gleifLegalNameSimilarity(exhibitLegalName, hit.name);

  if (exactLegalMatch(exhibitLegalName, hit.name)) {
    score += 50;
    breakdown.push("+50 exact legal name");
  } else if (normalizedNameMatch(exhibitLegalName, hit.name)) {
    score += 10;
    breakdown.push("+10 normalized name match");
  } else if (
    normalizeSubsidiaryNameForOpenCorporates(hit.name).includes(normalizedExhibitName) ||
    normalizedExhibitName.includes(normalizeSubsidiaryNameForOpenCorporates(hit.name))
  ) {
    score -= 30;
    breakdown.push("-30 weak normalized-only / partial");
  }

  if (!exactLegalMatch(exhibitLegalName, hit.name) && !normalizedNameMatch(exhibitLegalName, hit.name)) {
    const fuzzyPts = Math.round(nameSim * 38);
    score += fuzzyPts;
    breakdown.push(`+${fuzzyPts} fuzzy name ${(nameSim * 100).toFixed(0)}% vs Exhibit`);
  }

  if (!namePlausible) {
    score -= 130;
    breakdown.push("-130 Exhibit name vs LEI legal name — no plausible overlap (reject jurisdiction-only match)");
  }

  if (exhibitLeiJurisdiction && leiJurisdictionMatch(exhibitLeiJurisdiction, hit.jurisdiction_code)) {
    score += 40;
    breakdown.push("+40 jurisdiction match");
  } else if (exhibitLeiJurisdiction && !leiJurisdictionMatch(exhibitLeiJurisdiction, hit.jurisdiction_code)) {
    score -= 50;
    breakdown.push("-50 jurisdiction mismatch");
  }

  if (isActive(hit)) {
    score += 25;
    breakdown.push("+25 active/current");
  } else {
    score -= 40;
    breakdown.push("-40 inactive/dissolved");
  }

  const addr = (hit.registered_address_in_full ?? "").trim();
  if (addr.length > 8) {
    score += 25;
    breakdown.push("+25 registered address present");
  } else {
    score -= 40;
    breakdown.push("-40 no address");
  }

  if ((hit.company_number ?? "").trim().length > 0) {
    score += 15;
    breakdown.push("+15 company number");
  }

  if ((hit.registry_url ?? "").trim().length > 0) {
    score += 15;
    breakdown.push("+15 registry URL");
  }

  if (ambiguousPool) {
    score -= 20;
    breakdown.push("-20 ambiguous result set");
  }

  let matchConfidence: ConfidenceBand = "low";
  let addressConfidence: ConfidenceBand = "low";

  const highRule =
    namePlausible &&
    exactLegalMatch(exhibitLegalName, hit.name) &&
    (!exhibitLeiJurisdiction || leiJurisdictionMatch(exhibitLeiJurisdiction, hit.jurisdiction_code)) &&
    addr.length > 8 &&
    (((hit.company_number ?? "").trim().length > 0 || (hit.registry_url ?? "").trim().length > 0));

  const mediumRule =
    namePlausible &&
    (normalizedNameMatch(exhibitLegalName, hit.name) || exactLegalMatch(exhibitLegalName, hit.name)) &&
    (!exhibitLeiJurisdiction || leiJurisdictionMatch(exhibitLeiJurisdiction, hit.jurisdiction_code)) &&
    addr.length > 8;

  if (namePlausible && (highRule || score >= 130)) {
    matchConfidence = "high";
    addressConfidence = addr.length > 8 ? "high" : "low";
  } else if (namePlausible && (mediumRule || (score >= 75 && addr.length > 8))) {
    matchConfidence = "medium";
    addressConfidence = addr.length > 8 ? "medium" : "low";
  }

  return { hit, score, matchConfidence, addressConfidence, breakdown, namePlausible };
}

export function pickBestHits(
  exhibitLegalName: string,
  exhibitLeiJurisdiction: string | null,
  normalizedExhibitName: string,
  hits: OpenCorporatesCompanyHit[],
  opts: { ambiguousPool: boolean }
): ScoredHit[] {
  const scored = hits.map((hit) =>
    scoreOpenCorporatesCandidate({
      exhibitLegalName,
      exhibitLeiJurisdiction,
      normalizedExhibitName,
      hit,
      searchHadJurisdictionFilter: Boolean(exhibitLeiJurisdiction),
      ambiguousPool: opts.ambiguousPool,
    })
  );
  scored.sort((a, b) => {
    const d = Number(b.namePlausible) - Number(a.namePlausible);
    if (d !== 0) return d;
    return b.score - a.score;
  });
  return scored;
}
