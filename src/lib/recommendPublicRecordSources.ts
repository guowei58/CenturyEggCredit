import type { PublicRecordCategory } from "@/generated/prisma/client";
import {
  PUBLIC_RECORDS_REGISTRY,
  type PublicRecordRegistryEntry,
  registrySourceKey,
} from "@/lib/publicRecordsSourceRegistry";

export type PublicRecordsProfileForRecommend = {
  hqState?: string | null;
  hqCounty?: string | null;
  hqCity?: string | null;
  stateOfIncorporation?: string | null;
  principalExecutiveOfficeAddress?: string | null;
  borrowerNames?: string[];
  guarantorNames?: string[];
  subsidiaryNames?: string[];
  majorFacilityLocations?: unknown;
  knownPropertyLocations?: unknown;
};

export type RecommendedSource = {
  source: PublicRecordRegistryEntry;
  sourceKey: string;
  reason: string;
  priority: "primary" | "secondary";
};

function normState(s: string | undefined | null): string | undefined {
  if (!s?.trim()) return undefined;
  return s.trim().toUpperCase();
}

function collectStatesFromJsonLoose(j: unknown): string[] {
  if (!j || !Array.isArray(j)) return [];
  const out: string[] = [];
  for (const row of j) {
    if (row && typeof row === "object" && "state" in row && typeof (row as { state: string }).state === "string") {
      out.push((row as { state: string }).state);
    }
  }
  return out.map((s) => s.toUpperCase());
}

/**
 * Recommends registry sources by HQ, incorporation, facility/property JSON hints (MVP heuristic).
 */
export function recommendPublicRecordSources(profile: PublicRecordsProfileForRecommend): RecommendedSource[] {
  const primaryStates = new Set<string>();
  const secondaryStates = new Set<string>();

  const hq = normState(profile.hqState);
  const inc = normState(profile.stateOfIncorporation);
  if (hq) primaryStates.add(hq);
  if (inc) primaryStates.add(inc);

  for (const s of collectStatesFromJsonLoose(profile.majorFacilityLocations)) {
    if (s) primaryStates.add(s);
  }
  for (const s of collectStatesFromJsonLoose(profile.knownPropertyLocations)) {
    if (s) primaryStates.add(s);
  }

  for (const n of profile.borrowerNames ?? []) {
    const m = n.match(/\b(DE|TX|CA|NY|FL|NV)\b/i);
    if (m) secondaryStates.add(m[1]!.toUpperCase());
  }
  for (const n of profile.guarantorNames ?? []) {
    const m = n.match(/\b(DE|TX|CA|NY|FL|NV)\b/i);
    if (m) secondaryStates.add(m[1]!.toUpperCase());
  }
  for (const n of profile.subsidiaryNames ?? []) {
    const m = n.match(/\b(DE|TX|CA|NY|FL|NV)\b/i);
    if (m) secondaryStates.add(m[1]!.toUpperCase());
  }

  const out: RecommendedSource[] = [];
  const seen = new Set<string>();

  for (const entry of PUBLIC_RECORDS_REGISTRY) {
    const st = entry.state?.toUpperCase();
    let priority: "primary" | "secondary" | null = null;
    let reason = "";

    if (st && primaryStates.has(st)) {
      priority = "primary";
      reason = `Matches HQ, incorporation, or facility state (${st}).`;
    } else if (st && secondaryStates.has(st)) {
      priority = "secondary";
      reason = `Related entity footprint suggests checking ${st}.`;
    } else if (hq === "TX" && entry.county === "Travis" && entry.state === "TX") {
      priority = "primary";
      reason = "HQ in Texas — Travis County / Austin sources often material for local collateral and permits.";
    } else if (!hq && !inc && entry.id === "de-corporations") {
      priority = "secondary";
      reason = "Many issuers are Delaware entities — routine SOS check.";
    }

    if (!priority) continue;

    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    out.push({
      source: entry,
      sourceKey: registrySourceKey(entry.id),
      reason,
      priority,
    });
  }

  const catOrder = (c: PublicRecordCategory) =>
    [
      "entity_sos",
      "ucc_secured_debt",
      "tax_liens_releases",
      "real_estate_recorder",
      "property_tax_assessor",
      "permits_zoning_co",
      "environmental_compliance",
    ].indexOf(c);

  out.sort((a, b) => {
    const pa = a.priority === "primary" ? 0 : 1;
    const pb = b.priority === "primary" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return catOrder(a.source.category) - catOrder(b.source.category);
  });

  if (out.length === 0) {
    for (const entry of PUBLIC_RECORDS_REGISTRY) {
      if (entry.id === "de-corporations" || entry.id === "tx-sos-entity") {
        out.push({
          source: entry,
          sourceKey: registrySourceKey(entry.id),
          reason: "Default starter jurisdictions when profile is sparse.",
          priority: "secondary",
        });
      }
    }
  }

  return out;
}
