/**
 * Deterministic normalization for matching entities across filings (not legal advice).
 */
export function normalizeEntityNameForMatch(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[,.'"]/g, "")
    .replace(/\b(llc|l\.l\.c\.|inc\.?|corp\.?|ltd\.?|lp|l\.p\.|plc|co\.?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
