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

function normalizeCanonical(header: string): string | null {
  const s = header.replace(/\s/g, "").toUpperCase();
  const m = CANONICAL_RE.exec(s);
  if (!m) return null;
  const typ = m[1]!.toUpperCase();
  const yy = m[2]!;
  if (typ.startsWith("Q")) return `${typ[1]}Q${yy}`;
  return `${typ}${yy}`;
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

  const label = period.label?.trim();
  // Keep SEC prose headers so Python period_parser infers Q/FY from the filing text
  // (calendar month from period.end is wrong for non-December fiscal years, e.g. GEN).
  if (label && !/^period\s+\d+$/i.test(label)) return label;

  return period.shortLabel?.trim() || label || "Period";
}
