/** Anchor tokens commonly appearing as financing parties / agents in debt docs (expand over time). */
const KNOWN_AGENT_BANK_MARKERS = [
  "administrative agent",
  "collateral agent",
  "trustee",
  "notes collateral agent",
  "secured party",
  "agent bank",
  "wilmington trust",
  "u.s. bank",
  "usbank",
  "computershare",
  "glas trust",
  "glas agency",
  "jpmorgan",
  "j.p. morgan",
  "bank of america",
  "wells fargo",
  "citibank",
  "citigroup",
  "goldman sachs",
  "deutsche bank",
  "barclays",
  "alter domus",
  "cortland",
  "ankura",
  "deutsche bank trust",
  "hsbc",
  "morgan stanley",
  "u.s. national bank",
  "regions bank",
  "pnc bank",
  "truist",
];

export function normalizePartyName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function securedPartyLooksLikeFinancingAgent(name: string | null | undefined): boolean {
  const n = normalizePartyName(name ?? "");
  if (!n) return false;
  return KNOWN_AGENT_BANK_MARKERS.some((m) => n.includes(m));
}

export type FinancingRelationshipGuess =
  | "likely_credit_agreement_collateral_filing"
  | "likely_notes_collateral_filing"
  | "likely_abl_receivables_filing"
  | "likely_equipment_lease_financing"
  | "likely_trade_vendor_financing"
  | "likely_unrelated_false_positive"
  | "unclear";

export function guessFinancingRelationship(collateralDescription: string | null | undefined): FinancingRelationshipGuess {
  const c = normalizePartyName(collateralDescription ?? "");
  if (!c) return "unclear";
  if (/\breceivable|\babl\b|borrowing base|inventory\b/i.test(collateralDescription ?? "")) return "likely_abl_receivables_filing";
  if (/\bequipment\b|\blease\b|\bfixture\b/i.test(collateralDescription ?? "")) return "likely_equipment_lease_financing";
  if (/\bguarantee\b|\bindenture\b|\bnotes\b/i.test(collateralDescription ?? "")) return "likely_notes_collateral_filing";
  if (/\bcredit agreement\b|\brevolving\b|\bterm loan\b|\bfacility\b/i.test(collateralDescription ?? ""))
    return "likely_credit_agreement_collateral_filing";
  if (/\btrade\b|\bvendor\b|\bsupplier\b/i.test(collateralDescription ?? "")) return "likely_trade_vendor_financing";
  return "unclear";
}

export type UniverseConfidence = "high" | "medium" | "low" | "unknown";

export function confidenceFromSignals(opts: {
  exactDebtorMatch: boolean;
  formationMatchesJurisdiction: boolean;
  securedPartyMatchesKnownAgent: boolean;
  collateralHintStrong: boolean;
  filingActive: boolean | null;
}): UniverseConfidence {
  let score = 0;
  if (opts.exactDebtorMatch) score += 2;
  if (opts.formationMatchesJurisdiction) score += 1;
  if (opts.securedPartyMatchesKnownAgent) score += 2;
  if (opts.collateralHintStrong) score += 1;
  if (opts.filingActive === true) score += 1;
  if (opts.filingActive === false) score -= 1;
  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  return "low";
}
