import { normalizeAddress } from "@/lib/address/normalizeAddress";
import { normalizeEntityName } from "@/lib/entityNormalize";

export type AddressSourceCategory =
  | "public_records_profile"
  | "entity_intelligence_profile"
  | "sec_edgar"
  | "exhibit_21"
  | "credit_document"
  | "ucc"
  | "sos"
  | "verified_registry"
  | "entity_universe"
  | "user_added"
  | "other";

export type HarvestedAddressType =
  | "headquarters"
  | "principal_executive_office"
  | "principal_office"
  | "mailing_address"
  | "registered_office"
  | "registered_agent"
  | "notice_address"
  | "borrower_address"
  | "guarantor_address"
  | "grantor_address"
  | "pledgor_address"
  | "ucc_debtor_address"
  | "ucc_secured_party_address"
  | "facility_address"
  | "real_property_address"
  | "collateral_location"
  | "abs_party_address"
  | "law_firm_or_service"
  | "unknown";

export type AddressConfidence = "high" | "medium" | "low";
export type AddressPriority = "high" | "medium" | "low";

export type HarvestedAddress = {
  id: string;
  rawAddress: string;
  normalizedAddress: string;
  addressType: HarvestedAddressType;
  priority: AddressPriority;
  confidence: AddressConfidence;
  score: number;

  entityName: string;
  normalizedEntityName: string;
  sourceCategory: AddressSourceCategory;

  sourceName: string;
  sourceUrl?: string | null;
  sourceDocumentTitle?: string | null;
  filingDate?: string | null;
  sectionReference?: string | null;
  exactSourceQuote?: string | null;

  // parsed fields (best-effort)
  streetNumber?: string | null;
  streetName?: string | null;
  unit?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  postalCodePlus4?: string | null;

  flags: {
    isPoBox: boolean;
    isLikelyRegisteredAgent: boolean;
  };
};

export type AddressCluster = {
  clusterId: string;
  normalizedAddress: string;
  state: string | null;
  clusterType: "exact_normalized_address";
  priority: AddressPriority;
  entities: string[];
  sourceCategories: AddressSourceCategory[];
  sourceCount: number;
  recommendedNextAction: string;
};

export function scoreAddress(input: {
  addressType: HarvestedAddressType;
  sourceCategory: AddressSourceCategory;
  isPoBox: boolean;
  isLikelyRegisteredAgent: boolean;
  sourceMultiplicity: number;
  entityMultiplicity: number;
}): { score: number; priority: AddressPriority; confidence: AddressConfidence; reason: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Positive signals by address type.
  switch (input.addressType) {
    case "principal_executive_office":
    case "headquarters":
      score += 25;
      reasons.push("HQ/principal executive office");
      break;
    case "principal_office":
      score += 35;
      reasons.push("Principal office");
      break;
    case "mailing_address":
      score += 30;
      reasons.push("Mailing address");
      break;
    case "ucc_debtor_address":
      score += 45;
      reasons.push("UCC debtor address");
      break;
    case "ucc_secured_party_address":
      score += 10;
      reasons.push("UCC secured party address");
      break;
    case "registered_agent":
    case "registered_office":
      score += 5;
      reasons.push("Registered agent/office");
      break;
    case "notice_address":
      score += 20;
      reasons.push("Notice address");
      break;
    case "facility_address":
    case "real_property_address":
    case "collateral_location":
      score += 40;
      reasons.push("Collateral/property/facility location");
      break;
    default:
      score += 0;
      break;
  }

  // Source boosts.
  if (input.sourceCategory === "credit_document") {
    score += 10;
    reasons.push("Credit document source");
  }
  if (input.sourceCategory === "verified_registry" || input.sourceCategory === "sos") {
    score += 5;
    reasons.push("Official registry source");
  }
  if (input.sourceCategory === "public_records_profile" || input.sourceCategory === "entity_intelligence_profile") {
    score += 5;
    reasons.push("Company profile source");
  }

  // Multiplicity boosts.
  if (input.sourceMultiplicity >= 2) {
    score += 20;
    reasons.push("Appears in multiple sources");
  }
  if (input.entityMultiplicity >= 2) {
    score += 20;
    reasons.push("Used by multiple entities");
  }

  // Negative signals.
  if (input.isLikelyRegisteredAgent) {
    score -= 60;
    reasons.push("Looks like common registered-agent/service address");
  }
  if (input.isPoBox) {
    score -= 40;
    reasons.push("PO Box only");
  }

  const priority: AddressPriority = score >= 50 ? "high" : score >= 25 ? "medium" : "low";
  const confidence: AddressConfidence =
    priority === "high" ? "high" : priority === "medium" ? "medium" : "low";

  return { score, priority, confidence, reason: reasons };
}

export function buildHarvestedAddressId(parts: {
  normalizedEntityName: string;
  normalizedAddress: string;
  addressType: string;
  sourceCategory: string;
  sourceName: string;
}): string {
  // deterministic-ish id for UI dedupe (not a DB id)
  return [
    parts.normalizedEntityName,
    parts.normalizedAddress,
    parts.addressType,
    parts.sourceCategory,
    parts.sourceName,
  ]
    .join("|")
    .slice(0, 240);
}

export function normalizeEntity(entityName: string): { entityName: string; normalizedEntityName: string } {
  const n = normalizeEntityName(entityName);
  return { entityName: entityName.trim(), normalizedEntityName: n.normalized };
}

export function normalizeAndShapeAddress(input: {
  entityName: string;
  addressRaw: string;
  addressType: HarvestedAddressType;
  sourceCategory: AddressSourceCategory;
  sourceName: string;
  sourceUrl?: string | null;
  sourceDocumentTitle?: string | null;
  filingDate?: string | null;
  sectionReference?: string | null;
  exactSourceQuote?: string | null;
}): Omit<HarvestedAddress, "score" | "priority" | "confidence"> | null {
  const addr = normalizeAddress(input.addressRaw);
  if (!addr.normalizedAddress) return null;
  const ent = normalizeEntity(input.entityName);
  if (!ent.normalizedEntityName) return null;

  const id = buildHarvestedAddressId({
    normalizedEntityName: ent.normalizedEntityName,
    normalizedAddress: addr.normalizedAddress,
    addressType: input.addressType,
    sourceCategory: input.sourceCategory,
    sourceName: input.sourceName,
  });

  return {
    id,
    rawAddress: addr.rawAddress,
    normalizedAddress: addr.normalizedAddress,
    addressType: input.addressType,
    entityName: ent.entityName,
    normalizedEntityName: ent.normalizedEntityName,
    sourceCategory: input.sourceCategory,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl ?? null,
    sourceDocumentTitle: input.sourceDocumentTitle ?? null,
    filingDate: input.filingDate ?? null,
    sectionReference: input.sectionReference ?? null,
    exactSourceQuote: input.exactSourceQuote ?? null,
    streetNumber: addr.streetNumber ?? null,
    streetName: addr.streetName ?? null,
    unit: addr.unit ?? null,
    city: addr.city ?? null,
    state: addr.state ?? null,
    postalCode: addr.postalCode ?? null,
    postalCodePlus4: addr.postalCodePlus4 ?? null,
    flags: { isPoBox: addr.isPoBox, isLikelyRegisteredAgent: addr.isLikelyRegisteredAgent },
  };
}

export function clusterAddresses(addresses: HarvestedAddress[]): AddressCluster[] {
  const by = new Map<string, HarvestedAddress[]>();
  for (const a of addresses) {
    const key = `${a.normalizedAddress}|${a.state ?? ""}`;
    const arr = by.get(key) ?? [];
    arr.push(a);
    by.set(key, arr);
  }

  const clusters: AddressCluster[] = [];
  for (const [key, rows] of by.entries()) {
    const [norm, st] = key.split("|");
    const entities = [...new Set(rows.map((r) => r.entityName))];
    const sourceCategories = [...new Set(rows.map((r) => r.sourceCategory))];
    const bestPriority: AddressPriority =
      rows.some((r) => r.priority === "high") ? "high" : rows.some((r) => r.priority === "medium") ? "medium" : "low";
    const recommendedNextAction =
      bestPriority === "high"
        ? "Run same-address searches in SOS/UCC where allowed; review for hidden subsidiaries/SPVs."
        : bestPriority === "medium"
          ? "Review cluster; consider SOS address search or name-family corroboration."
          : "Low priority; keep for reference unless corroborated by credit/UCC/SOS evidence.";

    clusters.push({
      clusterId: key,
      normalizedAddress: norm,
      state: st || null,
      clusterType: "exact_normalized_address",
      priority: bestPriority,
      entities,
      sourceCategories,
      sourceCount: rows.length,
      recommendedNextAction,
    });
  }

  return clusters.sort((a, b) => (a.priority === b.priority ? b.sourceCount - a.sourceCount : a.priority === "high" ? -1 : a.priority === "medium" && b.priority === "low" ? -1 : 1));
}

