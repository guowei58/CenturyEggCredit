import type { CreditDocumentPartyRole } from "@/generated/prisma/client";
import type { AddressClusterAddressKind } from "@/generated/prisma/client";

/** Relevance bands for UI (see §10). */
export function relevanceLabel(score: number): "high_relevance" | "medium_relevance" | "low_relevance" | "very_low" {
  if (score >= 75) return "high_relevance";
  if (score >= 45) return "medium_relevance";
  if (score >= 20) return "low_relevance";
  return "very_low";
}

export type ScoreRelevanceInputs = {
  creditRole?: CreditDocumentPartyRole | null;
  listedInExhibit21: boolean;
  /** UCC row */
  hasUccDebtorEvidence?: boolean;
  collateralLooksMaterial?: boolean;
  collateralReceivablesInventoryEquipmentDepositIp?: boolean;
  /** SOS / naming */
  nameRootMatch?: boolean;
  financeSpvPattern?: boolean;
  ipRealEstateAssetHoldingsPattern?: boolean;
  /** Address */
  hqOrPrincipalExact?: boolean;
  facilityPropertyPermitExact?: boolean;
  sameCityStateOnly?: boolean;
  caution?: {
    genericRegisteredAgentOnly?: boolean;
    nameSimilarityOnly?: boolean;
    unrelatedGeography?: boolean;
    unrelatedIndustryKeywords?: boolean;
  };
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function scoreEntityRelevance(i: ScoreRelevanceInputs): number {
  let s = 0;
  const role = i.creditRole;

  switch (role) {
    case "borrower":
      s += 40;
      break;
    case "issuer":
    case "co_issuer":
      s += 40;
      break;
    case "guarantor":
      s += 35;
      break;
    case "grantor":
    case "pledgor":
    case "collateral_owner":
      s += 30;
      break;
    case "restricted_subsidiary":
      s += 20;
      break;
    case "unrestricted_subsidiary":
      s += 25;
      break;
    case "excluded_subsidiary":
      s += 15;
      break;
    case "receivables_subsidiary":
    case "securitization_subsidiary":
      s += 30;
      break;
    default:
      break;
  }

  if (i.listedInExhibit21) s += 20;

  if (i.hasUccDebtorEvidence) s += 25;
  if (i.collateralLooksMaterial) s += 15;
  if (i.collateralReceivablesInventoryEquipmentDepositIp) s += 10;

  if (i.nameRootMatch) s += 10;
  if (i.financeSpvPattern) s += 15;
  if (i.ipRealEstateAssetHoldingsPattern) s += 15;

  if (i.hqOrPrincipalExact) s += 20;
  if (i.facilityPropertyPermitExact) s += 15;
  if (i.sameCityStateOnly) s += 2;

  const c = i.caution;
  if (c?.genericRegisteredAgentOnly) s = Math.min(s, 10);
  if (c?.nameSimilarityOnly && !i.listedInExhibit21) s = Math.min(s, 25);
  if (c?.unrelatedGeography) s -= 10;
  if (c?.unrelatedIndustryKeywords) s -= 15;

  return clamp(Math.round(s), 0, 100);
}

const FINANCE_KEYS =
  /\b(FUNDING|FINANCE|RECEIVABLES|CAPITAL|LEASING|TRUST|\bABS\b|\bSPE\b|\bSPV\b|ASSET\s+HOLDINGS|INTERMEDIATE\s+HOLDINGS|IP\s+HOLDINGS|REAL\s+ESTATE\s+HOLDINGS|MANAGEMENT|SERVICES)\b/i;

export function debtorNameFinancePattern(name: string): boolean {
  return FINANCE_KEYS.test(name);
}

export function addressKindForBonus(kind: AddressClusterAddressKind | null | undefined): {
  hqOrPrincipalExact?: boolean;
  facilityPropertyPermitExact?: boolean;
} {
  if (!kind || kind === "unknown") return {};
  if (kind === "hq_address" || kind === "principal_office" || kind === "registered_office") return { hqOrPrincipalExact: true };
  if (kind === "facility_address" || kind === "property_address" || kind === "permit_address") return { facilityPropertyPermitExact: true };
  return {};
}

export function collateralFlags(description: string | null | undefined): {
  collateralLooksMaterial: boolean;
  collateralReceivablesInventoryEquipmentDepositIp: boolean;
} {
  const t = description?.trim() ?? "";
  if (!t)
    return { collateralLooksMaterial: false, collateralReceivablesInventoryEquipmentDepositIp: false };
  const lower = t.toLowerCase();
  const riedi =
    /\b(receivable|inventory|equipment|deposit\s+account|\bdeposit\b|\bip\b|intellectual\s+property|fixture|fixture\s+filing)\b/i.test(lower);
  const materialSuggest =
    /\b(all\s+assets|after[-\s]?acquired|equipment|inventory|deposit|real\s+estate|\bfixture\b|commercial\s+tort\s+claims|letter\s+of\s+credit\s+rights|accounts?)\b/i.test(
      lower
    );
  return {
    collateralLooksMaterial: materialSuggest,
    collateralReceivablesInventoryEquipmentDepositIp: riedi,
  };
}
