/**
 * Prior-period debt-note headings / labels loaded from {@link DebtNotePattern} for CIK-level boosting.
 */

import { prisma } from "@/lib/prisma";

export type PriorDebtPatternSummary = {
  debtNoteHeading: string;
  debtNoteNumber: string | null;
  debtTableLabels: string[];
  extractionMethod: string | null;
};

export async function loadPriorDebtNotePatternsForCik(cikPadded10: string): Promise<PriorDebtPatternSummary[]> {
  const rows = await prisma.debtNotePattern.findMany({
    where: { cik: cikPadded10, userConfirmed: true },
    orderBy: { filingDate: "desc" },
    take: 30,
    select: {
      debtNoteHeading: true,
      debtNoteNumber: true,
      debtTableLabels: true,
      extractionMethod: true,
    },
  });
  return rows.map((r) => ({
    debtNoteHeading: r.debtNoteHeading,
    debtNoteNumber: r.debtNoteNumber,
    debtTableLabels: Array.isArray(r.debtTableLabels)
      ? (r.debtTableLabels as string[]).filter((x) => typeof x === "string")
      : [],
    extractionMethod: r.extractionMethod,
  }));
}

function normalizeHeadingBlob(s: string): string {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function priorPeriodPatternScore(
  headingNorm: string,
  noteNum: string | null,
  bodyNorm: string,
  patterns: PriorDebtPatternSummary[],
): number {
  if (!patterns.length) return 0;
  let best = 0;
  const hn = headingNorm;
  for (const p of patterns) {
    let s = 0;
    const dh = normalizeHeadingBlob(p.debtNoteHeading);
    if (dh.length >= 6) {
      const stub = dh.slice(0, Math.min(48, dh.length));
      if (hn.includes(stub) || dh.includes(hn.slice(0, Math.min(48, hn.length)))) s += 38;
    }
    if (p.debtNoteNumber && noteNum) {
      const a = parseInt(p.debtNoteNumber.replace(/\D/g, ""), 10);
      const b = parseInt(noteNum.replace(/\D/g, ""), 10);
      if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) <= 2) s += 28;
    }
    for (const lab of p.debtTableLabels) {
      const ln = lab.toLowerCase().trim();
      if (ln.length >= 8 && bodyNorm.includes(ln)) s += 10;
    }
    best = Math.max(best, s);
  }
  return Math.min(best, 58);
}

export type DebtNotePatternPersistInput = {
  ticker: string;
  cik: string;
  filingType: string;
  filingDate: string;
  accessionNumber: string;
  debtNoteNumber: string | null;
  debtNoteHeading: string;
  previousNoteHeading: string | null;
  nextNoteHeading: string | null;
  extractionMethod: string;
  xbrlConceptsUsed: string[];
  debtTableLabels: string[];
  confidence: string;
  userConfirmed?: boolean;
};

/** Optional persistence after verified extraction (e.g. API route). */
export async function persistDebtNotePattern(row: DebtNotePatternPersistInput): Promise<void> {
  await prisma.debtNotePattern.create({
    data: {
      ticker: row.ticker,
      cik: row.cik,
      filingType: row.filingType,
      filingDate: row.filingDate,
      accessionNumber: row.accessionNumber,
      debtNoteNumber: row.debtNoteNumber,
      debtNoteHeading: row.debtNoteHeading,
      previousNoteHeading: row.previousNoteHeading,
      nextNoteHeading: row.nextNoteHeading,
      extractionMethod: row.extractionMethod,
      xbrlConceptsUsed: row.xbrlConceptsUsed,
      debtTableLabels: row.debtTableLabels,
      confidence: row.confidence,
      userConfirmed: row.userConfirmed ?? false,
    },
  });
}
