import type { CreditDocWorkflowEntityRole } from "@/generated/prisma/client";
import type { CreditMatrixRoleKey } from "./matrixRoleKeys";
import type { RoleFlagTriState } from "./matrixRoleKeys";
import type { CreditDocExtractionConfidence } from "@/generated/prisma/client";

export function workflowRoleToMatrixKey(role: CreditDocWorkflowEntityRole): CreditMatrixRoleKey | null {
  const m: Partial<Record<CreditDocWorkflowEntityRole, CreditMatrixRoleKey>> = {
    borrower: "borrower",
    issuer: "issuer",
    co_issuer: "coIssuer",
    guarantor: "guarantor",
    subsidiary_guarantor: "subsidiaryGuarantor",
    parent_guarantor: "parentGuarantor",
    grantor: "grantor",
    pledgor: "pledgor",
    collateral_owner: "collateralOwner",
    loan_party: "loanParty",
    obligor: "obligor",
    restricted_subsidiary: "restrictedSubsidiary",
    unrestricted_subsidiary: "unrestrictedSubsidiary",
    excluded_subsidiary: "excludedSubsidiary",
    immaterial_subsidiary: "immaterialSubsidiary",
    non_guarantor_subsidiary: "nonGuarantorSubsidiary",
    restricted_non_guarantor_subsidiary: "restrictedNonGuarantorSubsidiary",
    foreign_subsidiary: "foreignSubsidiary",
    domestic_subsidiary: "domesticSubsidiary",
    receivables_subsidiary: "receivablesSubsidiary",
    securitization_subsidiary: "securitizationSubsidiary",
    finance_subsidiary: "financeSubsidiary",
    insurance_subsidiary: "insuranceSubsidiary",
    captive_insurance_subsidiary: "captiveInsuranceSubsidiary",
    subsidiary: "restrictedSubsidiary",
    parent: "parent",
    holding_company: "holdingCompany",
    operating_company: "operatingCompany",
  };
  return m[role] ?? null;
}

const rank: Record<RoleFlagTriState, number> = {
  false: 0,
  unknown: 1,
  needs_review: 2,
  true: 3,
};

export function mergeRoleFlag(existing: RoleFlagTriState | undefined, next: RoleFlagTriState): RoleFlagTriState {
  const a = existing ?? "false";
  return rank[next] >= rank[a] ? next : a;
}

/** Agent / trustee / lender excluded from affiliate matrix highlights by default via tri-state. */
export function triStateFromExtractionConfidence(
  cf: CreditDocExtractionConfidence,
  isStructuralAffiliateRole: boolean
): RoleFlagTriState {
  if (!isStructuralAffiliateRole) return cf === "high" ? "true" : "needs_review";
  if (cf === "high") return "true";
  if (cf === "medium") return "needs_review";
  return "unknown";
}
