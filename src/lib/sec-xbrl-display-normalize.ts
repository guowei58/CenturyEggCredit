/**
 * **Display** numbers for primary statements.
 *
 * - **Raw** = instance fact numeric as parsed (including `ix:nonFraction` `@sign` merged upstream).
 * - **Income statement, balance sheet, and cash flow:** when the presentation arc uses a **negated**
 *   preferred label role, SEC Inline / face statements show **−raw** — always, including when raw is
 *   already negative (e.g. calc-weight / debit-credit instance sign vs caption “Gain (Loss)” on the
 *   printed 10‑Q). Non-negated arcs keep the instance sign.
 * - **Cash flow (indirect operating adjustments):** after label-role signing, non-cash gains that filers
 *   tag as positive magnitudes (product-line / asset-sale extensions, plain “gain on sale”, etc.) are
 *   shown as outflows to subtract from net income — same rules as {@link cashFlowSectionLineContribution}.
 *   Marketable-securities and PP&E “Gain (Loss) on disposition” lines keep the face sign.
 */

import { cashFlowSectionLineContribution } from "@/lib/sec-xbrl-export-validation";

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
 * Map one instance fact to **display** on the as-presented grid.
 * `concept` / `label` are kept for API stability and row-level call sites; signing follows the presentation arc role only.
 */
function normalizedLocalConcept(concept: string): string {
  const tail = concept.includes(":") ? concept.slice(concept.indexOf(":") + 1) : concept;
  return tail.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Net financing line (`ProceedsFromPaymentsForOtherFinancingActivities`) — instance sign is authoritative;
 * negated presentation roles double-flip payment amounts (e.g. finance lease principal rolled into “other”).
 */
function cashFlowTrustInstanceSignOnly(concept: string): boolean {
  return normalizedLocalConcept(concept) === "proceedsfrompaymentsforotherfinancingactivities";
}

/** Payment lines often tag a positive magnitude with `_cal.xml` weight −1 — show as outflow on the CF face. */
function cashFlowPaymentOutflowDisplay(concept: string, raw: number): number | null {
  const local = normalizedLocalConcept(concept);
  if (local !== "financeleaseprincipalpayments" && local !== "paymentsofdebtissuancecosts") {
    return null;
  }
  if (raw > 0) return -Math.abs(raw);
  return raw;
}

export function normalizeXbrlFactForStatementModel(params: {
  kind: "is" | "bs" | "cf";
  concept: string;
  label: string;
  preferredLabelRole: string | null;
  raw: number | null;
}): NormalizationResult {
  const { kind, concept, label, preferredLabelRole, raw } = params;
  if (raw === null || !Number.isFinite(raw)) {
    return { display: raw, rule: "null", confidence: "high" };
  }

  if (kind === "cf" && cashFlowTrustInstanceSignOnly(concept)) {
    return { display: raw, rule: "cf_instance_signed_net_line", confidence: "high" };
  }

  if (kind === "cf") {
    const paymentDisplay = cashFlowPaymentOutflowDisplay(concept, raw);
    if (paymentDisplay !== null) {
      return {
        display: paymentDisplay,
        rule: "cf_payment_outflow_magnitude",
        confidence: "high",
      };
    }
  }

  const negated = isNegatedPreferredLabel(preferredLabelRole);
  const display = negated ? -raw : raw;

  if (kind === "cf") {
    const reconciliationDisplay = cashFlowSectionLineContribution(display, label, concept);
    if (reconciliationDisplay !== display) {
      return {
        display: reconciliationDisplay,
        rule: "cf_indirect_noncash_gain_sign",
        confidence: "high",
      };
    }
    return {
      display,
      rule: negated ? "cf_negated_label" : "cf_instance_signed",
      confidence: "high",
    };
  }

  const rule = negated ? `sec_negated_label:${kind}` : `sec_instance:${kind}`;
  return { display, rule, confidence: "high" };
}
