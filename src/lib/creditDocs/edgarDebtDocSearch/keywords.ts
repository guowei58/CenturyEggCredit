/**
 * Step 5 keyword corpus — normalized lowercase matching (spec).
 * Also used for exhibit filename / description gates.
 */

export function normalizeDebtMatchText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\w\s./\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Credit facility */
export const CREDIT_FACILITY_KEYWORDS = [
  "credit agreement",
  "amended and restated credit agreement",
  "loan agreement",
  "term loan",
  "term facility",
  "revolving credit",
  "revolving facility",
  "revolver",
  "abl",
  "asset-based",
  "first lien",
  "second lien",
  "superpriority",
  "delayed draw",
  "bridge facility",
  "incremental facility",
  "refinancing facility",
  "extension amendment",
  "dip credit agreement",
  "debtor-in-possession",
  "exit facility",
  "exit financing",
] as const;

/** Bond / note */
export const BOND_NOTE_KEYWORDS = [
  "indenture",
  "supplemental indenture",
  "senior notes",
  "senior secured notes",
  "senior unsecured notes",
  "subordinated notes",
  "convertible notes",
  "exchangeable notes",
  "form of note",
  "global note",
  "note purchase agreement",
  "purchase agreement",
  "registration rights agreement",
] as const;

/** Guarantee / collateral */
export const GUARANTEE_COLLATERAL_KEYWORDS = [
  "guarantee",
  "guaranty",
  "guarantee agreement",
  "collateral agreement",
  "security agreement",
  "pledge agreement",
  "pledge and security agreement",
  "collateral trust agreement",
  "mortgage",
  "deed of trust",
  "intellectual property security agreement",
  "control agreement",
] as const;

/** Intercreditor */
export const INTERCREDITOR_KEYWORDS = [
  "intercreditor agreement",
  "first lien intercreditor",
  "second lien intercreditor",
  "pari passu intercreditor",
  "subordination agreement",
  "collateral agency agreement",
] as const;

/** Amendment / waiver */
export const AMENDMENT_WAIVER_KEYWORDS = [
  "amendment",
  "first amendment",
  "second amendment",
  "third amendment",
  "waiver",
  "consent",
  "joinder",
  "lender joinder",
  "incremental amendment",
  "refinancing amendment",
  "extension amendment",
  "forbearance agreement",
] as const;

/** Restructuring / exchange */
export const RESTRUCTURING_KEYWORDS = [
  "exchange agreement",
  "exchange offer",
  "transaction support agreement",
  "restructuring support agreement",
  "rsa",
  "plan support agreement",
  "cooperation agreement",
  "lock-up agreement",
  "commitment letter",
  "backstop agreement",
] as const;

export const ALL_DEBT_KEYWORD_PHRASES: readonly string[] = [
  ...CREDIT_FACILITY_KEYWORDS,
  ...BOND_NOTE_KEYWORDS,
  ...GUARANTEE_COLLATERAL_KEYWORDS,
  ...INTERCREDITOR_KEYWORDS,
  ...AMENDMENT_WAIVER_KEYWORDS,
  ...RESTRUCTURING_KEYWORDS,
];

export function textMatchesDebtKeywordBlob(blob: string): boolean {
  const n = normalizeDebtMatchText(blob);
  return ALL_DEBT_KEYWORD_PHRASES.some((k) => n.includes(k));
}
