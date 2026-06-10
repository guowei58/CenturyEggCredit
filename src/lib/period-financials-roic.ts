export type PeriodFinancialsFilingLabelInput = {
  form: string;
  filingDate: string;
  reportDate?: string | null;
};

export type PeriodFinancialsFilingLabelRow = PeriodFinancialsFilingLabelInput & {
  accessionNumber: string;
};

function anchorDate(f: PeriodFinancialsFilingLabelInput): string {
  return (f.reportDate ?? f.filingDate ?? "").trim().slice(0, 10);
}

function fiscalYearFromAnchor(f: PeriodFinancialsFilingLabelInput): number {
  const d = anchorDate(f);
  const y = parseInt(d.slice(0, 4), 10);
  return Number.isFinite(y) ? y : new Date().getFullYear();
}

function normalizeForm(form: string): string {
  return (form ?? "").trim().toUpperCase();
}

function fyYearForLeading10Qs(
  qs: PeriodFinancialsFilingLabelInput[],
  next10K: PeriodFinancialsFilingLabelInput | null
): number {
  if (next10K) {
    const kEnd = anchorDate(next10K);
    const kFy = fiscalYearFromAnchor(next10K);
    if (qs.length > 0 && qs.every((q) => anchorDate(q) > kEnd)) return kFy + 1;
    return kFy;
  }
  const newest = qs[qs.length - 1];
  return newest ? fiscalYearFromAnchor(newest) : new Date().getFullYear();
}

/**
 * Assign FY / 1Q–3Q labels using each 10-K as a fiscal-year anchor (newest-first list).
 * Quarters immediately after a 10-K in the dropdown are labeled 3Q, 2Q, 1Q for that FY.
 */
export function buildPeriodFinancialsFilingLabels(filings: PeriodFinancialsFilingLabelRow[]): Map<string, string> {
  const labels = new Map<string, string>();
  const rows = filings.filter((f) => {
    const form = normalizeForm(f.form);
    return form === "10-K" || form === "10-Q";
  });

  let i = 0;
  while (i < rows.length) {
    const f = rows[i]!;
    const form = normalizeForm(f.form);

    if (form === "10-K") {
      const fy = fiscalYearFromAnchor(f);
      labels.set(f.accessionNumber, `FY ${fy}`);
      i++;
      let q = 3;
      while (i < rows.length && normalizeForm(rows[i]!.form) === "10-Q" && q >= 1) {
        labels.set(rows[i]!.accessionNumber, `${q}Q ${fy}`);
        i++;
        q--;
      }
      continue;
    }

    const runStart = i;
    while (i < rows.length && normalizeForm(rows[i]!.form) === "10-Q") i++;
    const run = rows.slice(runStart, i);
    const nextK =
      i < rows.length && normalizeForm(rows[i]!.form) === "10-K" ? rows[i]! : null;
    const fy = fyYearForLeading10Qs(run, nextK);
    const sorted = [...run].sort((a, b) => anchorDate(a).localeCompare(anchorDate(b)));
    sorted.forEach((q, idx) => {
      labels.set(q.accessionNumber, `${Math.min(idx + 1, 3)}Q ${fy}`);
    });
  }

  return labels;
}

/** User-facing filing row in the Period Financials dropdown (no accession number). */
export function formatPeriodFinancialsFilingLabel(
  f: PeriodFinancialsFilingLabelInput,
  periodLabel: string
): string {
  const filed = (f.filingDate ?? "").trim().slice(0, 10);
  return `${filed} · ${periodLabel}`;
}

/** Map SEC report/filing date (YYYY-MM-DD) to Roic fiscal quarter token e.g. 2024Q1. */
export function reportDateToRoicPeriod(reportDate?: string | null, filingDate?: string | null): string | null {
  const d = (reportDate ?? filingDate ?? "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(d);
  if (!m) return null;
  const year = m[1]!;
  const month = parseInt(m[2]!, 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  const quarter = Math.ceil(month / 3);
  return `${year}Q${quarter}`;
}

/** Roic transcript index for a ticker. */
export function roicTranscriptIndexUrl(ticker: string): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return `https://www.roic.ai/quote/${encodeURIComponent(sym)}/transcripts`;
}

/**
 * Best-effort deep link for a quarter (Roic uses /transcripts/{year}/{quarter} paths on the site).
 * Falls back to the transcript index when period is unknown.
 */
export function roicTranscriptQuarterUrl(ticker: string, period: string | null | undefined): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  const p = (period ?? "").replace(/\s/g, "").toUpperCase();
  const m = /^(\d{4})Q([1-4])$/.exec(p);
  if (!m) return roicTranscriptIndexUrl(sym);
  return `https://www.roic.ai/quote/${encodeURIComponent(sym)}/transcripts/${m[1]}/${m[2]}`;
}

/** Pull human-readable transcript text from Roic RQL API payload shapes. */
export function extractRoicTranscriptText(data: unknown): string | null {
  if (typeof data === "string" && data.trim()) return data.trim();
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    if (data.every((x) => typeof x === "string")) return data.join("\n\n").trim() || null;
    for (const row of data) {
      const t = extractRoicTranscriptText(row);
      if (t) return t;
    }
    return null;
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    for (const key of [
      "transcript",
      "text",
      "content",
      "value",
      "earnings_call_transcript",
      "earnings_transcript",
      "body",
    ]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    if (Array.isArray(obj.data)) return extractRoicTranscriptText(obj.data);
    if (Array.isArray(obj.values)) return extractRoicTranscriptText(obj.values);
  }
  return null;
}
