/**
 * Detect balance-sheet presentation rows that are **share counts** (xbrli:shares),
 * not currency, so they can be omitted from a monetary-only primary BS grid.
 */

export type XbrlUnitFactsSlice = {
  unitMeasure: Map<string, string>;
  facts: Map<string, Array<{ unitRef: string | null; value: number | null }>>;
};

function unitMeasureIsShares(measure: string | null): boolean {
  if (!measure) return false;
  const m = measure.trim().toLowerCase();
  if (m === "xbrli:shares" || m.endsWith(":shares")) return true;
  const leaf = m.includes(":") ? (m.split(":").pop() ?? "") : m;
  return leaf === "shares";
}

function unitMeasureIsCurrencyLike(measure: string | null): boolean {
  if (!measure) return false;
  const m = measure.trim().toLowerCase();
  return (
    m.includes("iso4217") ||
    m.includes("iso 4217") ||
    m.includes("4217") ||
    /\busd\b/.test(m) ||
    /\beur\b/.test(m) ||
    /\bgbp\b/.test(m)
  );
}

/** When every numeric fact for a concept has no unit / unknown unit, narrow treasury+shares label fallback. */
export function bsTreasuryShareCountConceptHeuristic(concept: string): boolean {
  const i = concept.lastIndexOf(":");
  const local = (i >= 0 ? concept.slice(i + 1) : concept).replace(/_/g, "").toLowerCase();
  if (!local) return false;
  if (local.includes("earningspershare") || local.includes("pershare")) return false;
  return local.includes("treasurystock") && local.includes("shares");
}

/**
 * True → omit row from **primary** balance sheet (monetary columns).
 * Share-only tags (treasury shares, shares outstanding in xbrli:shares) return true.
 */
export function isBalanceSheetShareCountRow(inst: XbrlUnitFactsSlice, concept: string): boolean {
  const facts = inst.facts.get(concept) ?? [];
  const numeric = facts.filter((f) => f.value != null && Number.isFinite(f.value));
  if (numeric.length === 0) return bsTreasuryShareCountConceptHeuristic(concept);

  let anyCurrency = false;
  let anyShares = false;
  let anyOther = false;
  for (const f of numeric) {
    const measure = f.unitRef ? inst.unitMeasure.get(f.unitRef) ?? null : null;
    if (unitMeasureIsCurrencyLike(measure)) anyCurrency = true;
    else if (unitMeasureIsShares(measure)) anyShares = true;
    else anyOther = true;
  }
  if (anyCurrency) return false;
  if (anyShares && !anyOther) return true;
  if (anyShares && anyOther && bsTreasuryShareCountConceptHeuristic(concept)) return true;
  return false;
}
