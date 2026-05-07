import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { serEntityUniverseRow } from "../_helpers";
import { normalizeAddress } from "@/lib/address/normalizeAddress";
import { normalizeEntityName } from "@/lib/entityNormalize";
import type { AddressClusterAddressKind } from "@/generated/prisma/client";
import { usStateAbbrFromText } from "@/lib/usStates";
import { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ClusterSource = {
  entityName: string;
  normalizedEntityName: string;
  addressRaw: string;
  addressType: AddressClusterAddressKind;
  state: string;
  sourceName: string;
  sourceUrl: string;
  evidence?: Record<string, unknown>;
};

function pushIf(out: ClusterSource[], v: ClusterSource | null) {
  if (!v) return;
  if (!v.entityName.trim()) return;
  if (!v.addressRaw.trim()) return;
  out.push(v);
}

function stateFromAddressOrField(address: string | null | undefined, fallback: string | null | undefined): string {
  return usStateAbbrFromText(fallback) ?? usStateAbbrFromText(address) ?? "";
}

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const [intel, pubProfile, ex21, sos, ucc, verified, universe, creditDocs] = await Promise.all([
    prisma.entityIntelligenceProfile.findFirst({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => null),
    prisma.publicRecordsProfile.findUnique({ where: { userId_ticker: { userId: ctx.userId, ticker: ctx.ticker } } }).catch(() => null),
    prisma.exhibit21Subsidiary.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
    prisma.sosNameFamilyCandidate.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
    prisma.uccSearchResult.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
    prisma.verifiedEntityRecord.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
    prisma.entityUniverseItem.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
    prisma.creditDocumentEntityRoleMatrixRow.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
  ]);

  const sources: ClusterSource[] = [];

  // Public Records Profile (often populated earlier than EntityIntelligenceProfile).
  if (pubProfile?.principalExecutiveOfficeAddress?.trim()) {
    pushIf(sources, {
      entityName: pubProfile.legalNames?.[0]?.trim() || pubProfile.companyName?.trim() || ctx.ticker,
      normalizedEntityName: normalizeEntityName(pubProfile.legalNames?.[0]?.trim() || pubProfile.companyName?.trim() || ctx.ticker).normalized,
      addressRaw: pubProfile.principalExecutiveOfficeAddress,
      addressType: "principal_office",
      state: stateFromAddressOrField(pubProfile.principalExecutiveOfficeAddress, pubProfile.hqState),
      sourceName: "Public Records Profile (principal executive office)",
      sourceUrl: "",
      evidence: { publicRecordsProfileId: pubProfile.id },
    });
  }

  if (pubProfile?.hqCity || pubProfile?.hqState) {
    const addr = [pubProfile.hqCity, pubProfile.hqState].filter(Boolean).join(", ").trim();
    if (addr) {
      pushIf(sources, {
        entityName: pubProfile.legalNames?.[0]?.trim() || pubProfile.companyName?.trim() || ctx.ticker,
        normalizedEntityName: normalizeEntityName(pubProfile.legalNames?.[0]?.trim() || pubProfile.companyName?.trim() || ctx.ticker).normalized,
        addressRaw: addr,
        addressType: "hq_address",
        state: usStateAbbrFromText(pubProfile.hqState) ?? "",
        sourceName: "Public Records Profile (HQ city/state)",
        sourceUrl: "",
        evidence: { publicRecordsProfileId: pubProfile.id },
      });
    }
  }

  // HQ / principal office addresses from intelligence profile (high-value).
  if (intel?.hqAddress?.trim()) {
    pushIf(sources, {
      entityName: intel.publicRegistrantName?.trim() || ctx.ticker,
      normalizedEntityName: normalizeEntityName(intel.publicRegistrantName?.trim() || ctx.ticker).normalized,
      addressRaw: intel.hqAddress,
      addressType: "hq_address",
      state: stateFromAddressOrField(intel.hqAddress, intel.hqState),
      sourceName: "Entity intelligence profile (HQ)",
      sourceUrl: intel.source10KUrl?.trim() || "",
      evidence: { intelProfileId: intel.id },
    });
  }
  if (intel?.principalExecutiveOfficeAddress?.trim()) {
    pushIf(sources, {
      entityName: intel.publicRegistrantName?.trim() || ctx.ticker,
      normalizedEntityName: normalizeEntityName(intel.publicRegistrantName?.trim() || ctx.ticker).normalized,
      addressRaw: intel.principalExecutiveOfficeAddress,
      addressType: "principal_office",
      state: stateFromAddressOrField(intel.principalExecutiveOfficeAddress, intel.hqState),
      sourceName: "Entity intelligence profile (principal office)",
      sourceUrl: intel.source10KUrl?.trim() || "",
      evidence: { intelProfileId: intel.id },
    });
  }

  // SOS candidates: principal/mailing/registered agent addresses.
  for (const r of sos) {
    const st = usStateAbbrFromText(r.state) ?? "";
    pushIf(sources, r.principalOfficeAddress ? {
      entityName: r.candidateEntityName,
      normalizedEntityName: r.normalizedCandidateEntityName,
      addressRaw: r.principalOfficeAddress,
      addressType: "principal_office",
      state: st || stateFromAddressOrField(r.principalOfficeAddress, r.state),
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      evidence: { sosCandidateId: r.id, kind: "principalOfficeAddress" },
    } : null);
    pushIf(sources, r.mailingAddress ? {
      entityName: r.candidateEntityName,
      normalizedEntityName: r.normalizedCandidateEntityName,
      addressRaw: r.mailingAddress,
      addressType: "mailing_address",
      state: st || stateFromAddressOrField(r.mailingAddress, r.state),
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      evidence: { sosCandidateId: r.id, kind: "mailingAddress" },
    } : null);
    pushIf(sources, r.registeredAgentAddress ? {
      entityName: r.candidateEntityName,
      normalizedEntityName: r.normalizedCandidateEntityName,
      addressRaw: r.registeredAgentAddress,
      addressType: "registered_office",
      state: st || stateFromAddressOrField(r.registeredAgentAddress, r.state),
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      evidence: { sosCandidateId: r.id, kind: "registeredAgentAddress" },
    } : null);
  }

  // UCC results: debtor / secured party address (debtor address high value).
  for (const r of ucc) {
    const st = usStateAbbrFromText(r.jurisdiction) ?? "";
    pushIf(sources, r.debtorAddress ? {
      entityName: r.debtorNameFound,
      normalizedEntityName: normalizeEntityName(r.debtorNameFound).normalized,
      addressRaw: r.debtorAddress,
      addressType: "unknown",
      state: st || stateFromAddressOrField(r.debtorAddress, r.jurisdiction),
      sourceName: "UCC search result (debtor address)",
      sourceUrl: r.sourceUrl ?? "",
      evidence: { uccSearchResultId: r.id, kind: "debtorAddress", filingNumber: r.filingNumber },
    } : null);
    pushIf(sources, r.securedPartyAddress ? {
      entityName: r.securedPartyName ?? "Secured party",
      normalizedEntityName: normalizeEntityName(r.securedPartyName ?? "").normalized,
      addressRaw: r.securedPartyAddress,
      addressType: "unknown",
      state: st || stateFromAddressOrField(r.securedPartyAddress, r.jurisdiction),
      sourceName: "UCC search result (secured party address)",
      sourceUrl: r.sourceUrl ?? "",
      evidence: { uccSearchResultId: r.id, kind: "securedPartyAddress", filingNumber: r.filingNumber },
    } : null);
  }

  // Verified entity records.
  for (const r of verified) {
    const st = usStateAbbrFromText(r.state) ?? "";
    pushIf(sources, r.principalOfficeAddress ? {
      entityName: r.officialEntityName,
      normalizedEntityName: r.normalizedOfficialEntityName,
      addressRaw: r.principalOfficeAddress,
      addressType: "principal_office",
      state: st || stateFromAddressOrField(r.principalOfficeAddress, r.state),
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      evidence: { verifiedEntityRecordId: r.id, kind: "principalOfficeAddress" },
    } : null);
    pushIf(sources, r.mailingAddress ? {
      entityName: r.officialEntityName,
      normalizedEntityName: r.normalizedOfficialEntityName,
      addressRaw: r.mailingAddress,
      addressType: "mailing_address",
      state: st || stateFromAddressOrField(r.mailingAddress, r.state),
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      evidence: { verifiedEntityRecordId: r.id, kind: "mailingAddress" },
    } : null);
    pushIf(sources, r.registeredAgentAddress ? {
      entityName: r.officialEntityName,
      normalizedEntityName: r.normalizedOfficialEntityName,
      addressRaw: r.registeredAgentAddress,
      addressType: "registered_office",
      state: st || stateFromAddressOrField(r.registeredAgentAddress, r.state),
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      evidence: { verifiedEntityRecordId: r.id, kind: "registeredAgentAddress", registeredAgentName: r.registeredAgentName },
    } : null);
  }

  // Entity Universe items already merged from other workflows often have vetted addresses.
  for (const r of universe) {
    const st = usStateAbbrFromText(r.state) ?? usStateAbbrFromText(r.jurisdiction) ?? "";
    pushIf(sources, r.principalOfficeAddress ? {
      entityName: r.entityName,
      normalizedEntityName: r.normalizedEntityName,
      addressRaw: r.principalOfficeAddress,
      addressType: "principal_office",
      state: st || stateFromAddressOrField(r.principalOfficeAddress, r.state),
      sourceName: "Entity universe (principal office)",
      sourceUrl: r.sourceDocumentUrl ?? "",
      evidence: { entityUniverseItemId: r.id, kind: "principalOfficeAddress" },
    } : null);
    pushIf(sources, r.mailingAddress ? {
      entityName: r.entityName,
      normalizedEntityName: r.normalizedEntityName,
      addressRaw: r.mailingAddress,
      addressType: "mailing_address",
      state: st || stateFromAddressOrField(r.mailingAddress, r.state),
      sourceName: "Entity universe (mailing)",
      sourceUrl: r.sourceDocumentUrl ?? "",
      evidence: { entityUniverseItemId: r.id, kind: "mailingAddress" },
    } : null);
    pushIf(sources, r.registeredAgentAddress ? {
      entityName: r.entityName,
      normalizedEntityName: r.normalizedEntityName,
      addressRaw: r.registeredAgentAddress,
      addressType: "registered_office",
      state: st || stateFromAddressOrField(r.registeredAgentAddress, r.state),
      sourceName: "Entity universe (registered agent)",
      sourceUrl: r.sourceDocumentUrl ?? "",
      evidence: { entityUniverseItemId: r.id, kind: "registeredAgentAddress", registeredAgentName: r.registeredAgentName },
    } : null);
    pushIf(sources, r.matchedAddress ? {
      entityName: r.entityName,
      normalizedEntityName: r.normalizedEntityName,
      addressRaw: r.matchedAddress,
      addressType: "unknown",
      state: st || stateFromAddressOrField(r.matchedAddress, r.state),
      sourceName: "Entity universe (matched address)",
      sourceUrl: r.sourceDocumentUrl ?? "",
      evidence: { entityUniverseItemId: r.id, kind: "matchedAddress" },
    } : null);
  }

  // Credit-doc matrix (key evidence often includes notice addresses; we use only when explicitly present in keyEvidence).
  // Conservative: only cluster when the matrix row already has a stored address in EntityUniverseItem or other sources;
  // so here we only use this for name-family + address corroboration, not primary discovery.
  // (No-op for now unless you later persist addresses per matrix row.)
  void creditDocs;
  void ex21;

  const normalized = sources
    .map((s) => {
      const n = normalizeAddress(s.addressRaw);
      return { ...s, addressNorm: n.normalizedAddress, isPoBox: n.isPoBox, isLikelyRegisteredAgent: n.isLikelyRegisteredAgent };
    })
    .filter((s) => s.addressNorm);

  const byAddress = new Map<string, typeof normalized>();
  for (const s of normalized) {
    const k = `${s.addressNorm}|${s.state || ""}`;
    const arr = byAddress.get(k) ?? [];
    arr.push(s);
    byAddress.set(k, arr);
  }

  // Persist candidates as AddressClusterCandidate rows for later review (does NOT assert affiliation).
  // If migrations are not applied yet, we degrade gracefully and still return computed clusters.
  let persistenceBlockedReason: string | null = null;
  let created = 0;
  const createdRows: Record<string, unknown>[] = [];
  try {
    const existing = await prisma.addressClusterCandidate.findMany({
      where: { userId: ctx.userId, ticker: ctx.ticker },
      select: { normalizedCandidateEntityName: true, matchedAddress: true, state: true },
    });
    const existingKey = new Set(
      existing.map(
        (r) =>
          `${r.normalizedCandidateEntityName}|${normalizeAddress(r.matchedAddress).normalizedAddress}|${r.state}`
      )
    );

    for (const group of byAddress.values()) {
      for (const s of group) {
        const entityNorm = s.normalizedEntityName || normalizeEntityName(s.entityName).normalized;
        const k = `${entityNorm}|${s.addressNorm}|${s.state}`;
        if (!entityNorm || existingKey.has(k)) continue;
        const row = await prisma.addressClusterCandidate.create({
          data: {
            userId: ctx.userId,
            ticker: ctx.ticker,
            candidateEntityName: s.entityName,
            normalizedCandidateEntityName: entityNorm,
            matchedAddress: s.addressRaw,
            addressType: s.addressType,
            state: s.state || "",
            sourceName: s.sourceName,
            sourceUrl: s.sourceUrl || "",
            evidenceJson: s.evidence === undefined ? undefined : (s.evidence as Prisma.InputJsonValue),
            confidence: s.isPoBox || s.isLikelyRegisteredAgent ? "low" : "medium",
            relevanceScore: 0,
            reviewStatus: "unreviewed",
            notes: s.isPoBox
              ? "PO Box address — low-confidence address cluster signal."
              : s.isLikelyRegisteredAgent
                ? "Registered agent / service address — treat as weak evidence unless corroborated."
                : null,
          },
        });
        created++;
        existingKey.add(k);
        createdRows.push(serEntityUniverseRow(row as unknown as Record<string, unknown>));
      }
    }
  } catch (e) {
    const code =
      e instanceof Prisma.PrismaClientKnownRequestError ? String(e.code ?? "") : "";
    // P2021: table does not exist
    if (code === "P2021") {
      persistenceBlockedReason =
        "Database migrations not applied: `address_cluster_candidates` table is missing. Clusters are computed but cannot be saved yet.";
    } else {
      persistenceBlockedReason = e instanceof Error ? e.message : "Could not persist address-cluster candidates.";
    }
  }

  const clusters = [...byAddress.entries()]
    .map(([k, rows]) => {
      const [addrNorm, st] = k.split("|");
      const nonLow = rows.filter((r) => !r.isPoBox && !r.isLikelyRegisteredAgent);
      const priority =
        nonLow.length >= 3 ? "high" : nonLow.length === 2 ? "medium" : rows.length >= 2 ? "low" : "low";
      return {
        clusterId: k,
        normalizedAddress: addrNorm,
        state: st,
        sourcesCount: rows.length,
        entityCount: new Set(rows.map((r) => r.normalizedEntityName || r.entityName)).size,
        priority,
      };
    })
    .sort((a, b) => (a.priority === b.priority ? b.sourcesCount - a.sourcesCount : a.priority === "high" ? -1 : a.priority === "medium" && b.priority === "low" ? -1 : 1))
    .slice(0, 250);

  return NextResponse.json({
    ok: true,
    ticker: ctx.ticker,
    addressesCollected: sources.length,
    note:
      sources.length === 0
        ? "No addresses available yet. Add a principal executive office address in Public Records Profile, run SOS verification to capture principal/agent addresses, ingest UCC results with debtor addresses, or push confirmed entities into the Entity Universe with addresses."
        : null,
    persistenceBlockedReason,
    clusters: clusters,
    candidatesCreated: created,
    createdCandidates: createdRows,
  });
}

