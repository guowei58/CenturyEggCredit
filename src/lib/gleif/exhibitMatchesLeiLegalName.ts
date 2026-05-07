import { normalizedLevenshteinSimilarity } from "@/lib/gleif/stringSimilarity";
import { normalizeSubsidiaryNameForOpenCorporates } from "@/lib/opencorporates/subsidiaryNameNormalize";

/** Minimum normalized Levenshtein similarity (Exhibit vs GLEIF legal name) to accept a match. */
export const GLEIF_NAME_MATCH_THRESHOLD = 0.8;

/** Stricter when the shorter normalized name is very short (avoids spurious high ratios). */
const SHORT_NAME_THRESHOLD = 0.88;
const SHORT_NAME_MAX_LEN = 10;

/** Normalized Levenshtein similarity in [0, 1] after subsidiary name normalization. */
export function gleifLegalNameSimilarity(exhibitLegalName: string, leiLegalName: string): number {
  const a = normalizeSubsidiaryNameForOpenCorporates(exhibitLegalName).trim();
  const b = normalizeSubsidiaryNameForOpenCorporates(leiLegalName).trim();
  if (!a || !b) return 0;
  return normalizedLevenshteinSimilarity(a, b);
}

/**
 * True when normalized names reach ~80% Levenshtein similarity (see thresholds above).
 */
export function exhibitMatchesLeiLegalName(exhibitLegalName: string, leiLegalName: string): boolean {
  const a = normalizeSubsidiaryNameForOpenCorporates(exhibitLegalName).trim();
  const b = normalizeSubsidiaryNameForOpenCorporates(leiLegalName).trim();
  if (!a || !b) return false;
  if (a === b) return true;

  const sim = normalizedLevenshteinSimilarity(a, b);
  const minLen = Math.min(a.length, b.length);
  const threshold = minLen <= SHORT_NAME_MAX_LEN ? SHORT_NAME_THRESHOLD : GLEIF_NAME_MATCH_THRESHOLD;
  return sim >= threshold;
}
