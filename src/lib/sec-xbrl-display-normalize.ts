/**
 * SEC-style **display** numbers from XBRL (aligned with typical Inline XBRL viewer behavior).
 *
 * - **Raw** = instance fact numeric as parsed (including `ix:nonFraction` `@sign` merged in upstream).
 * **Display** = that value, inverted **only** when the presentation arc uses a **negated** label role
 * (same signal HTML viewers use — not concept-keyword heuristics).
 *
 * We still store `rawValues` vs `values` (display) for audit. `kind` is recorded in the rule tag only.
 */

export type NormalizationConfidence = "high" | "medium" | "low";

export type NormalizationResult = {
  display: number | null;
  rule: string;
  confidence: NormalizationConfidence;
};

/**
 * Presentation `preferredLabel` on the arc — if it is a negated label role, viewers show −fact.
 * Match common XBRL 2009 role URIs without using a bare `includes("negated")` (avoids "Unnegated…" false positives).
 */
export function isNegatedPreferredLabel(role: string | null | undefined): boolean {
  if (!role || typeof role !== "string") return false;
  const n = role.toLowerCase();
  return (
    n.includes("negatedlabel") ||
    n.includes("negatedterse") ||
    n.includes("negatedtotal") ||
    n.includes("negatednet") ||
    n.includes("negatedperiodstart") ||
    n.includes("negatedperiodend") ||
    n.includes("negateddocumentation")
  );
}

/**
 * Map one instance fact to **display** like SEC Inline XBRL presentation: optional negated-label flip only.
 */
export function normalizeXbrlFactForStatementModel(params: {
  kind: "is" | "bs" | "cf";
  concept: string;
  label: string;
  preferredLabelRole: string | null;
  raw: number | null;
}): NormalizationResult {
  const { kind, preferredLabelRole, raw } = params;
  if (raw === null || !Number.isFinite(raw)) {
    return { display: raw, rule: "null", confidence: "high" };
  }

  const negated = isNegatedPreferredLabel(preferredLabelRole);
  const display = negated ? -raw : raw;
  const rule = negated ? `sec_negated_label:${kind}` : `sec_instance:${kind}`;
  return { display, rule, confidence: "high" };
}
