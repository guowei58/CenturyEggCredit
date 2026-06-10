export type FiscalPeriod = {
  label: string;
  quarter: 1 | 2 | 3 | 4;
  year: number;
};

/** Parse `Q3 2025`, `2025Q3`, `3Q2025`, `FY 2025`. */
export function parseFiscalPeriodToken(period: string): FiscalPeriod | null {
  const raw = period.trim();
  if (!raw) return null;

  let m = /^Q([1-4])\s+(\d{4})$/i.exec(raw);
  if (m) {
    const quarter = parseInt(m[1]!, 10) as 1 | 2 | 3 | 4;
    const year = parseInt(m[2]!, 10);
    return { label: `Q${quarter} ${year}`, quarter, year };
  }

  m = /^(\d{4})Q([1-4])$/i.exec(raw);
  if (m) {
    const year = parseInt(m[1]!, 10);
    const quarter = parseInt(m[2]!, 10) as 1 | 2 | 3 | 4;
    return { label: `Q${quarter} ${year}`, quarter, year };
  }

  m = /^([1-4])Q(\d{4})$/i.exec(raw);
  if (m) {
    const quarter = parseInt(m[1]!, 10) as 1 | 2 | 3 | 4;
    const year = parseInt(m[2]!, 10);
    return { label: `Q${quarter} ${year}`, quarter, year };
  }

  m = /^([1-4])Q\s+(\d{4})$/i.exec(raw);
  if (m) {
    const quarter = parseInt(m[1]!, 10) as 1 | 2 | 3 | 4;
    const year = parseInt(m[2]!, 10);
    return { label: `Q${quarter} ${year}`, quarter, year };
  }

  m = /^FY\s*(\d{4})$/i.exec(raw);
  if (m) {
    const year = parseInt(m[1]!, 10);
    return { label: `FY ${year}`, quarter: 4, year };
  }

  return null;
}

/** Roic-style `2025Q3` → display `Q3 2025`. */
export function roicPeriodToPresentationPeriod(period: string | null | undefined): string | null {
  if (!period?.trim()) return null;
  const parsed = parseFiscalPeriodToken(period);
  return parsed?.label ?? null;
}

/** Approximate calendar anchor for earnings-window search when no date is supplied. */
export function fiscalPeriodToAnchorDate(period: FiscalPeriod): string {
  const { quarter, year } = period;
  switch (quarter) {
    case 1:
      return `${year}-05-15`;
    case 2:
      return `${year}-08-15`;
    case 3:
      return `${year}-11-15`;
    case 4:
      return `${year + 1}-02-15`;
    default:
      return `${year}-08-15`;
  }
}

export function resolveDiscoveryAnchorDate(input: {
  earningsDate?: string | null;
  reportDate?: string | null;
  period: string;
}): string {
  const iso = (input.earningsDate ?? input.reportDate ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const fp = parseFiscalPeriodToken(input.period);
  if (fp) return fiscalPeriodToAnchorDate(fp);
  return new Date().toISOString().slice(0, 10);
}

const PERIOD_PATTERNS: RegExp[] = [
  /\bQ([1-4])\s*['']?\s*(\d{2,4})\b/i,
  /\b([1-4])Q\s*['']?\s*(\d{2,4})\b/i,
  /\b(\d{4})\s*Q([1-4])\b/i,
  /\b(first|second|third|fourth)\s+quarter\s+(?:of\s+)?(\d{4})\b/i,
  /\b(?:fiscal|fy)\s*(\d{4})\b/i,
];

const QUARTER_WORD: Record<string, 1 | 2 | 3 | 4> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
};

/** Infer fiscal period label from title, filename, or page text. */
export function inferPeriodFromText(text: string): string | null {
  const hay = text.replace(/\s+/g, " ");
  for (const re of PERIOD_PATTERNS) {
    const m = re.exec(hay);
    if (!m) continue;
    if (/first|second|third|fourth/i.test(m[1] ?? "")) {
      const q = QUARTER_WORD[(m[1] ?? "").toLowerCase()];
      const y = parseYearToken(m[2] ?? "");
      if (q && y) return `Q${q} ${y}`;
    }
    if (/^\d{4}$/.test(m[1] ?? "") && /^[1-4]$/.test(m[2] ?? "")) {
      return `Q${m[2]} ${m[1]}`;
    }
    if (/^[1-4]$/.test(m[1] ?? "")) {
      const y = parseYearToken(m[2] ?? "");
      if (y) return `Q${m[1]} ${y}`;
    }
    if (/^fy$/i.test(m[0] ?? "")) {
      const y = parseYearToken(m[1] ?? "");
      if (y) return `FY ${y}`;
    }
  }
  return null;
}

function parseYearToken(tok: string): number | null {
  const t = tok.trim();
  if (/^\d{4}$/.test(t)) return parseInt(t, 10);
  if (/^\d{2}$/.test(t)) {
    const n = parseInt(t, 10);
    return n >= 70 ? 1900 + n : 2000 + n;
  }
  return null;
}

export function periodsMatch(expected: FiscalPeriod, inferredLabel: string | null): boolean {
  if (!inferredLabel) return false;
  const inf = parseFiscalPeriodToken(inferredLabel);
  if (!inf) return false;
  return inf.quarter === expected.quarter && inf.year === expected.year;
}
