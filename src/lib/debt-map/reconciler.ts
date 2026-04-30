import { normalizeEntityNameForMatch } from "@/lib/debt-map/normalizeEntityName";
import type { FootnoteLine } from "@/lib/debt-map/footnoteExtract";

export type FootnoteMatch = {
  footnoteIndex: number;
  matchedInstrumentId: string | null;
  confidenceScore: number;
  gapNote: string | null;
};

function tokenize(s: string): Set<string> {
  return new Set(
    normalizeEntityNameForMatch(s)
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function overlapScore(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

/**
 * Match debt footnote rows to extracted instruments using conservative text overlap (MVP).
 */
export function reconcileFootnotesToInstruments(
  footnotes: FootnoteLine[],
  instruments: Array<{
    id: string;
    instrumentName: string;
    principalAmount: string | null;
    maturityDate: string | null;
  }>
): FootnoteMatch[] {
  return footnotes.map((fn, footnoteIndex) => {
    let bestId: string | null = null;
    let best = 0;
    for (const ins of instruments) {
      const s1 = overlapScore(fn.description, ins.instrumentName);
      const s2 = fn.principalAmount && ins.principalAmount && fn.principalAmount.includes(ins.principalAmount.replace(/\D/g, "").slice(0, 4)) ? 0.25 : 0;
      const s3 =
        fn.maturityDate && ins.maturityDate && fn.maturityDate.includes(ins.maturityDate.slice(0, 4)) ? 0.2 : 0;
      const score = Math.min(1, s1 + s2 + s3);
      if (score > best) {
        best = score;
        bestId = ins.id;
      }
    }
    const confidenceScore = Math.round(best * 100);
    if (best < 0.25) {
      return {
        footnoteIndex,
        matchedInstrumentId: null,
        confidenceScore,
        gapNote: "No strong match to a downloaded debt exhibit — may require manual mapping.",
      };
    }
    return {
      footnoteIndex,
      matchedInstrumentId: bestId,
      confidenceScore,
      gapNote: best < 0.45 ? "Weak match — verify principal/maturity in source filings." : null,
    };
  });
}

export function meanConfidence(matches: FootnoteMatch[]): number | null {
  if (matches.length === 0) return null;
  const sum = matches.reduce((a, m) => a + m.confidenceScore, 0);
  return Math.round(sum / matches.length);
}
