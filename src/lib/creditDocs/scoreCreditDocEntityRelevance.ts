import type { CreditDocWorkflowEntityRole } from "@/generated/prisma/client";

/** Spec §16 — additive score from roles and flags. */
const ROLE_WEIGHT: Partial<Record<CreditDocWorkflowEntityRole, number>> = {
  borrower: 40,
  issuer: 40,
  co_issuer: 40,
  guarantor: 35,
  subsidiary_guarantor: 35,
  parent_guarantor: 35,
  grantor: 30,
  pledgor: 30,
  collateral_owner: 30,
  loan_party: 30,
  obligor: 25,
  restricted_subsidiary: 20,
  unrestricted_subsidiary: 25,
  excluded_subsidiary: 15,
  immaterial_subsidiary: 10,
  non_guarantor_subsidiary: 20,
  restricted_non_guarantor_subsidiary: 25,
  receivables_subsidiary: 30,
  securitization_subsidiary: 30,
  finance_subsidiary: 25,
  insurance_subsidiary: 20,
  captive_insurance_subsidiary: 20,
};

export type RelevanceTier = "high" | "medium" | "low" | "very_low";

export function scoreFromRoles(opts: {
  roles: CreditDocWorkflowEntityRole[];
  notInEx21: boolean;
  docCountBoost: boolean;
  amendmentAction?: "added" | "released" | undefined;
}): { score: number; tier: RelevanceTier } {
  let score = 0;
  const seen = new Set<CreditDocWorkflowEntityRole>();
  for (const r of opts.roles) {
    if (seen.has(r)) continue;
    seen.add(r);
    score += ROLE_WEIGHT[r] ?? 8;
  }
  if (opts.notInEx21) score += 10;
  if (opts.docCountBoost) score += 15;
  if (opts.amendmentAction === "added") score += 20;
  if (opts.amendmentAction === "released") score += 25;

  const tier =
    score >= 75 ? "high" : score >= 45 ? "medium" : score >= 20 ? "low" : "very_low";
  return { score: Math.min(100, score), tier };
}

export function tierToEntityUniverseConfidence(tier: RelevanceTier): "high" | "medium" | "low" | "unknown" {
  if (tier === "high") return "high";
  if (tier === "medium") return "medium";
  if (tier === "low") return "low";
  return "unknown";
}
