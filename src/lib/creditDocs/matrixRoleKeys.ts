/** Matrix column keys → matches roleFlagsJson in DB (values: "true"|"false"|"unknown"|"needs_review"). */

export type RoleFlagTriState = "true" | "false" | "unknown" | "needs_review";

export const CREDIT_MATRIX_ROLE_KEYS = [
  "borrower",
  "issuer",
  "coIssuer",
  "guarantor",
  "subsidiaryGuarantor",
  "parentGuarantor",
  "grantor",
  "pledgor",
  "loanParty",
  "obligor",
  "collateralOwner",
  "restrictedSubsidiary",
  "unrestrictedSubsidiary",
  "excludedSubsidiary",
  "immaterialSubsidiary",
  "nonGuarantorSubsidiary",
  "restrictedNonGuarantorSubsidiary",
  "foreignSubsidiary",
  "domesticSubsidiary",
  "receivablesSubsidiary",
  "securitizationSubsidiary",
  "financeSubsidiary",
  "insuranceSubsidiary",
  "captiveInsuranceSubsidiary",
  "parent",
  "holdingCompany",
  "operatingCompany",
  "addedByAmendment",
  "releasedByAmendment",
  "notListedInExhibit21",
  "needsFollowUp",
] as const;

export type CreditMatrixRoleKey = (typeof CREDIT_MATRIX_ROLE_KEYS)[number];

export function emptyRoleFlagsJson(): Record<CreditMatrixRoleKey, RoleFlagTriState> {
  const out = {} as Record<CreditMatrixRoleKey, RoleFlagTriState>;
  for (const k of CREDIT_MATRIX_ROLE_KEYS) out[k] = "false";
  return out;
}

export const MATRIX_COLUMN_LABELS: Record<CreditMatrixRoleKey, string> = {
  borrower: "Borrower",
  issuer: "Issuer",
  coIssuer: "Co-Issuer",
  guarantor: "Guarantor",
  subsidiaryGuarantor: "Subs. guarantor",
  parentGuarantor: "Parent guarantor",
  grantor: "Grantor",
  pledgor: "Pledgor",
  loanParty: "Loan party",
  obligor: "Obligor",
  collateralOwner: "Collateral owner",
  restrictedSubsidiary: "Restricted sub",
  unrestrictedSubsidiary: "Unrestricted sub",
  excludedSubsidiary: "Excluded sub",
  immaterialSubsidiary: "Immaterial sub",
  nonGuarantorSubsidiary: "Non-guarantor sub",
  restrictedNonGuarantorSubsidiary: "Restr. NG sub",
  foreignSubsidiary: "Foreign sub",
  domesticSubsidiary: "Domestic sub",
  receivablesSubsidiary: "Receivables sub",
  securitizationSubsidiary: "Securitization sub",
  financeSubsidiary: "Finance sub",
  insuranceSubsidiary: "Insurance sub",
  captiveInsuranceSubsidiary: "Captive ins.",
  parent: "Parent",
  holdingCompany: "Holding co.",
  operatingCompany: "Operating co.",
  addedByAmendment: "Added (amd.)",
  releasedByAmendment: "Released (amd.)",
  notListedInExhibit21: "Not in Ex.21",
  needsFollowUp: "Follow-up",
};
