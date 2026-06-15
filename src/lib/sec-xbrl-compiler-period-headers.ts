/**
 * Column headers the Python xbrl-compiler understands (1Q25, FY25, 6M25, or SEC prose).
 */

export type CompilerPeriodInput = {
  label: string;
  shortLabel?: string;
  end?: string;
  start?: string | null;
};

const CANONICAL_RE = /^([1-4]Q|FY|6M|9M)(\d{2})$/i;

/** SEC HTML sometimes glues duration prose to month names (`EndedSeptember` → `Ended September`). */
const ENDED_MONTH_GLUE_RE =
  /(ended)(Jan(?:uary|\.)?|Feb(?:ruary|\.)?|Mar(?:ch|\.)?|Apr(?:il|\.)?|May\.?|Jun(?:e|\.)?|Jul(?:y|\.)?|Aug(?:ust|\.)?|Sep(?:t(?:ember)?|\.)?|Oct(?:ober|\.)?|Nov(?:ember|\.)?|Dec(?:ember|\.)?)/i;

export function normalizeSecProsePeriodHeader(label: string): string {
  return label.replace(ENDED_MONTH_GLUE_RE, "$1 $2");
}

function normalizeCanonical(header: string): string | null {
  const s = header.replace(/\s/g, "").toUpperCase();
  const m = CANONICAL_RE.exec(s);
  if (!m) return null;
  const typ = m[1]!.toUpperCase();
  const yy = m[2]!;
  if (typ.startsWith("Q")) return `${typ[1]}Q${yy}`;
  return `${typ}${yy}`;
}

const PLAIN_YEAR_RE = /^(19|20)\d{2}$/;
const FY_FOUR_DIGIT_RE = /^FY\s*(19|20)\d{2}$/i;

function plainYearToFyCanonical(header: string): string | null {
  const s = header.trim();
  if (PLAIN_YEAR_RE.test(s)) return `FY${s.slice(-2)}`;
  const compact = s.replace(/\s/g, "");
  const fy = FY_FOUR_DIGIT_RE.exec(compact);
  if (fy) return `FY${compact.slice(-2)}`;
  const fiscal = /^(?:for\s+the\s+)?(?:fiscal\s+)?years?\s+(?:ended\s+)?((19|20)\d{2})\b/i.exec(s);
  if (fiscal) return `FY${fiscal[1]!.slice(-2)}`;
  return null;
}

/** Excel column header for deterministic compiler ingestion. */
export function compilerPeriodColumnHeader(
  period: CompilerPeriodInput,
  _filingForm?: string
): string {
  const fromShort = period.shortLabel ? normalizeCanonical(period.shortLabel) : null;
  if (fromShort) return fromShort;

  const fromLabel = normalizeCanonical(period.label);
  if (fromLabel) return fromLabel;

  const fromPlainYear = plainYearToFyCanonical(period.label);
  if (fromPlainYear) return fromPlainYear;

  const label = period.label?.trim();
  // Keep SEC prose headers so Python period_parser infers Q/FY from the filing text
  // (calendar month from period.end is wrong for non-December fiscal years, e.g. GEN).
  if (label && !/^period\s+\d+$/i.test(label)) return normalizeSecProsePeriodHeader(label);

  return period.shortLabel?.trim() || label || "Period";
}
