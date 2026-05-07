import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import {
  clusterAddresses,
  normalizeAndShapeAddress,
  scoreAddress,
  type AddressCluster,
  type HarvestedAddress,
  type HarvestedAddressType,
} from "@/lib/address/addressHarvester";
import { usStateAbbrFromText } from "@/lib/usStates";
import { Prisma } from "@/generated/prisma/client";
import { parseCreditDocumentToPlainText } from "@/lib/creditDocs/parseCreditDocument";
import { getCreditAgreementsFileBuffer } from "@/lib/credit-agreements-files";
import { downloadAndExtractSecDocument } from "@/lib/debt-map/documentFetch";
import { getCompanyProfileAndPrincipalBusinessAddress } from "@/lib/sec-edgar";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type HarvestBody = {
  includeCreditDocScan?: boolean;
  maxCreditDocumentsToScan?: number;
};

function safeJson(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : dflt;
  return Math.max(min, Math.min(max, n));
}

function harvestTypeFromLabel(label: string): HarvestedAddressType {
  const t = label.toLowerCase();
  if (t.includes("registered agent")) return "registered_agent";
  if (t.includes("registered office")) return "registered_office";
  if (t.includes("principal executive")) return "principal_executive_office";
  if (t.includes("chief executive")) return "principal_executive_office";
  if (t.includes("principal office")) return "principal_office";
  if (t.includes("mail")) return "mailing_address";
  if (t.includes("hq") || t.includes("headquarters")) return "headquarters";
  if (t.includes("ucc debtor")) return "ucc_debtor_address";
  if (t.includes("secured party")) return "ucc_secured_party_address";
  if (t.includes("notice")) return "notice_address";
  return "unknown";
}

function extractLikelyAddressesFromText(text: string): Array<{ raw: string; quote: string; kind: HarvestedAddressType }> {
  // Conservative US-style patterns: street + city + state + ZIP OR PO BOX + city + state + ZIP.
  const patterns: Array<{ re: RegExp; kind: HarvestedAddressType }> = [
    {
      kind: "notice_address",
      re: /\b(\d{1,6}\s+[A-Z0-9 .,'-]{3,60}\s+(?:ST|AVE|RD|DR|BLVD|LN|CT|PKWY|HWY)\.?\s*(?:STE|SUITE|UNIT|FL|FLOOR|BLDG|BUILDING)?\s*[A-Z0-9-]{0,10}\s*,?\s*[A-Z .'-]{2,40}\s*,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)\b/gi,
    },
    {
      kind: "mailing_address",
      re: /\b(PO BOX\s+\d{1,10}\s*,?\s*[A-Z .'-]{2,40}\s*,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)\b/gi,
    },
  ];

  const hits: Array<{ raw: string; quote: string; kind: HarvestedAddressType }> = [];
  const cap = 80;
  for (const p of patterns) {
    for (const m of text.matchAll(p.re)) {
      const raw = String(m[1] ?? "").trim();
      if (!raw) continue;
      const idx = m.index ?? 0;
      const before = text.slice(Math.max(0, idx - 120), idx);
      const after = text.slice(idx, Math.min(text.length, idx + raw.length + 120));
      const quote = `${before}${after}`.replace(/\s+/g, " ").trim();
      hits.push({ raw, quote, kind: p.kind });
      if (hits.length >= cap) return hits;
    }
  }
  return hits;
}

async function plainTextForCreditDocSource(userId: string, ticker: string, source: { savedDocumentRefId: string | null; secUrl: string | null; sourceUrl: string | null }) {
  const ref = source.savedDocumentRefId;
  if (ref?.startsWith("user_saved:")) {
    const id = ref.split(":")[1]!;
    const doc = await prisma.userSavedDocument.findFirst({ where: { id, userId, ticker } });
    if (!doc) return "";
    return parseCreditDocumentToPlainText(Buffer.from(doc.body));
  }
  if (ref?.startsWith("public_records:")) {
    const id = ref.split(":")[1]!;
    const doc = await prisma.publicRecordsDocument.findFirst({ where: { id, userId, ticker } });
    if (!doc) return "";
    const fromExtracted = doc.extractedText && doc.extractedText.length > 0 ? doc.extractedText : "";
    return fromExtracted ? fromExtracted.slice(0, 1_200_000) : parseCreditDocumentToPlainText(Buffer.from(doc.body));
  }
  if (ref?.startsWith("credit_workspace:")) {
    const filename = ref.slice("credit_workspace:".length).trim();
    const found = filename ? await getCreditAgreementsFileBuffer(userId, ticker, filename) : null;
    if (!found?.buf?.length) return "";
    return parseCreditDocumentToPlainText(found.buf);
  }
  const secPick = source.secUrl?.trim() || source.sourceUrl?.trim();
  if (secPick?.startsWith("https://www.sec.gov/")) {
    const fetched = await downloadAndExtractSecDocument(secPick);
    return fetched.text ?? "";
  }
  return "";
}

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const body = safeJson(await req.json().catch(() => ({}))) as HarvestBody;
  const includeCreditDocScan = bool(body.includeCreditDocScan, true);
  const maxCreditDocumentsToScan = clampInt(body.maxCreditDocumentsToScan, 12, 0, 40);

  const [
    pubProfile,
    intel,
    universe,
    ex21,
    sos,
    verified,
    ucc,
    creditSources,
  ] = await Promise.all([
    prisma.publicRecordsProfile.findUnique({ where: { userId_ticker: { userId: ctx.userId, ticker: ctx.ticker } } }).catch(() => null),
    prisma.entityIntelligenceProfile.findFirst({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => null),
    prisma.entityUniverseItem.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
    prisma.exhibit21Subsidiary.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
    prisma.sosNameFamilyCandidate.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
    prisma.verifiedEntityRecord.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
    prisma.uccSearchResult.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker } }).catch(() => []),
    prisma.creditDocumentSource.findMany({ where: { userId: ctx.userId, ticker: ctx.ticker }, orderBy: [{ filingDate: "desc" }, { updatedAt: "desc" }] }).catch(() => []),
  ]);

  const shaped: Array<Omit<HarvestedAddress, "score" | "priority" | "confidence">> = [];

  // SEC submissions JSON principal business address (often the best HQ/principal office baseline).
  const secBundle = await getCompanyProfileAndPrincipalBusinessAddress(ctx.ticker).catch(() => null);
  if (secBundle?.principalBusiness?.formatted?.trim()) {
    const nm = secBundle.profile?.name?.trim() || pubProfile?.companyName?.trim() || ctx.ticker;
    const x = normalizeAndShapeAddress({
      entityName: nm,
      addressRaw: secBundle.principalBusiness.formatted,
      addressType: "principal_executive_office",
      sourceCategory: "sec_edgar",
      sourceName: "SEC submissions (principal business address)",
      exactSourceQuote: "SEC submissions JSON `addresses.business` / `addresses.mailing`.",
    });
    if (x) shaped.push(x);
  }

  // Public Records Profile addresses
  if (pubProfile?.principalExecutiveOfficeAddress?.trim()) {
    const nm = pubProfile.legalNames?.[0]?.trim() || pubProfile.companyName?.trim() || ctx.ticker;
    const x = normalizeAndShapeAddress({
      entityName: nm,
      addressRaw: pubProfile.principalExecutiveOfficeAddress,
      addressType: "principal_executive_office",
      sourceCategory: "public_records_profile",
      sourceName: "Public Records Profile",
      exactSourceQuote: "Principal executive office address (profile field).",
    });
    if (x) shaped.push(x);
  }
  if (pubProfile?.hqCity || pubProfile?.hqState) {
    const addr = [pubProfile.hqCity, pubProfile.hqState].filter(Boolean).join(", ").trim();
    if (addr) {
      const nm = pubProfile.legalNames?.[0]?.trim() || pubProfile.companyName?.trim() || ctx.ticker;
      const x = normalizeAndShapeAddress({
        entityName: nm,
        addressRaw: addr,
        addressType: "headquarters",
        sourceCategory: "public_records_profile",
        sourceName: "Public Records Profile",
        exactSourceQuote: "HQ city/state (profile fields).",
      });
      if (x) shaped.push(x);
    }
  }

  // Entity intelligence profile
  if (intel?.hqAddress?.trim()) {
    const x = normalizeAndShapeAddress({
      entityName: intel.publicRegistrantName?.trim() || pubProfile?.companyName?.trim() || ctx.ticker,
      addressRaw: intel.hqAddress,
      addressType: "headquarters",
      sourceCategory: "entity_intelligence_profile",
      sourceName: "Entity intelligence profile",
      sourceUrl: intel.source10KUrl ?? null,
      filingDate: intel.source10KDate ? intel.source10KDate.toISOString().slice(0, 10) : null,
      exactSourceQuote: "HQ address (intelligence profile field).",
    });
    if (x) shaped.push(x);
  }
  if (intel?.principalExecutiveOfficeAddress?.trim()) {
    const x = normalizeAndShapeAddress({
      entityName: intel.publicRegistrantName?.trim() || pubProfile?.companyName?.trim() || ctx.ticker,
      addressRaw: intel.principalExecutiveOfficeAddress,
      addressType: "principal_executive_office",
      sourceCategory: "entity_intelligence_profile",
      sourceName: "Entity intelligence profile",
      sourceUrl: intel.source10KUrl ?? null,
      filingDate: intel.source10KDate ? intel.source10KDate.toISOString().slice(0, 10) : null,
      exactSourceQuote: "Principal executive office address (intelligence profile field).",
    });
    if (x) shaped.push(x);
  }
  for (const a of intel?.majorFacilityAddresses ?? []) {
    const x = normalizeAndShapeAddress({
      entityName: intel?.publicRegistrantName?.trim() || pubProfile?.companyName?.trim() || ctx.ticker,
      addressRaw: a,
      addressType: "facility_address",
      sourceCategory: "entity_intelligence_profile",
      sourceName: "Entity intelligence profile",
      exactSourceQuote: "Major facility address (intelligence profile).",
    });
    if (x) shaped.push(x);
  }

  // Exhibit 21 (we typically do not have addresses here, but keep hook for future structured address fields)
  void ex21;

  // SOS candidates
  for (const r of sos) {
    if (r.principalOfficeAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.candidateEntityName,
        addressRaw: r.principalOfficeAddress,
        addressType: "principal_office",
        sourceCategory: "sos",
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        exactSourceQuote: "Principal office address (SOS record).",
      });
      if (x) shaped.push(x);
    }
    if (r.mailingAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.candidateEntityName,
        addressRaw: r.mailingAddress,
        addressType: "mailing_address",
        sourceCategory: "sos",
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        exactSourceQuote: "Mailing address (SOS record).",
      });
      if (x) shaped.push(x);
    }
    if (r.registeredAgentAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.candidateEntityName,
        addressRaw: r.registeredAgentAddress,
        addressType: "registered_agent",
        sourceCategory: "sos",
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        exactSourceQuote: "Registered agent address (SOS record).",
      });
      if (x) shaped.push(x);
    }
  }

  // Verified registry records
  for (const r of verified) {
    if (r.principalOfficeAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.officialEntityName,
        addressRaw: r.principalOfficeAddress,
        addressType: "principal_office",
        sourceCategory: "verified_registry",
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        exactSourceQuote: "Principal office (verified registry record).",
      });
      if (x) shaped.push(x);
    }
    if (r.mailingAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.officialEntityName,
        addressRaw: r.mailingAddress,
        addressType: "mailing_address",
        sourceCategory: "verified_registry",
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        exactSourceQuote: "Mailing address (verified registry record).",
      });
      if (x) shaped.push(x);
    }
    if (r.registeredAgentAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.officialEntityName,
        addressRaw: r.registeredAgentAddress,
        addressType: "registered_agent",
        sourceCategory: "verified_registry",
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        exactSourceQuote: "Registered agent address (verified registry record).",
      });
      if (x) shaped.push(x);
    }
  }

  // UCC
  for (const r of ucc) {
    if (r.debtorAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.debtorNameFound,
        addressRaw: r.debtorAddress,
        addressType: "ucc_debtor_address",
        sourceCategory: "ucc",
        sourceName: "UCC search result",
        sourceUrl: r.sourceUrl ?? null,
        filingDate: r.filingDate ? r.filingDate.toISOString().slice(0, 10) : null,
        sectionReference: r.filingNumber ? `UCC filing ${r.filingNumber}` : null,
        exactSourceQuote: "Debtor address field (UCC result).",
      });
      if (x) shaped.push(x);
    }
    if (r.securedPartyAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.securedPartyName ?? "Secured party",
        addressRaw: r.securedPartyAddress,
        addressType: "ucc_secured_party_address",
        sourceCategory: "ucc",
        sourceName: "UCC search result",
        sourceUrl: r.sourceUrl ?? null,
        filingDate: r.filingDate ? r.filingDate.toISOString().slice(0, 10) : null,
        sectionReference: r.filingNumber ? `UCC filing ${r.filingNumber}` : null,
        exactSourceQuote: "Secured party address field (UCC result).",
      });
      if (x) shaped.push(x);
    }
  }

  // Entity universe items
  for (const r of universe) {
    if (r.principalOfficeAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.entityName,
        addressRaw: r.principalOfficeAddress,
        addressType: "principal_office",
        sourceCategory: "entity_universe",
        sourceName: "Entity universe",
        sourceUrl: r.sourceDocumentUrl ?? null,
        exactSourceQuote: "Principal office (entity universe field).",
      });
      if (x) shaped.push(x);
    }
    if (r.mailingAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.entityName,
        addressRaw: r.mailingAddress,
        addressType: "mailing_address",
        sourceCategory: "entity_universe",
        sourceName: "Entity universe",
        sourceUrl: r.sourceDocumentUrl ?? null,
        exactSourceQuote: "Mailing address (entity universe field).",
      });
      if (x) shaped.push(x);
    }
    if (r.registeredAgentAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.entityName,
        addressRaw: r.registeredAgentAddress,
        addressType: "registered_agent",
        sourceCategory: "entity_universe",
        sourceName: "Entity universe",
        sourceUrl: r.sourceDocumentUrl ?? null,
        exactSourceQuote: "Registered agent address (entity universe field).",
      });
      if (x) shaped.push(x);
    }
    if (r.matchedAddress?.trim()) {
      const x = normalizeAndShapeAddress({
        entityName: r.entityName,
        addressRaw: r.matchedAddress,
        addressType: "unknown",
        sourceCategory: "entity_universe",
        sourceName: "Entity universe",
        sourceUrl: r.sourceDocumentUrl ?? null,
        exactSourceQuote: "Matched address (entity universe field).",
      });
      if (x) shaped.push(x);
    }
  }

  // Optional: scan queued credit documents for address blocks (best-effort, capped).
  const creditScanFindings: Array<{ documentId: string; documentTitle: string; hits: number }> = [];
  if (includeCreditDocScan && maxCreditDocumentsToScan > 0) {
    for (const src of creditSources.slice(0, maxCreditDocumentsToScan)) {
      const plain = await plainTextForCreditDocSource(ctx.userId, ctx.ticker, {
        savedDocumentRefId: src.savedDocumentRefId,
        secUrl: src.secUrl,
        sourceUrl: src.sourceUrl,
      }).catch(() => "");
      if (!plain.trim()) continue;
      const extracted = extractLikelyAddressesFromText(plain.slice(0, 700_000));
      let hits = 0;
      for (const h of extracted) {
        const x = normalizeAndShapeAddress({
          entityName: intel?.publicRegistrantName?.trim() || pubProfile?.companyName?.trim() || ctx.ticker,
          addressRaw: h.raw,
          addressType: h.kind,
          sourceCategory: "credit_document",
          sourceName: "Credit document text scan",
          sourceDocumentTitle: src.documentTitle,
          sourceUrl: src.sourceUrl ?? src.secUrl ?? null,
          filingDate: src.filingDate ? src.filingDate.toISOString().slice(0, 10) : null,
          sectionReference: "Text scan (pattern-based)",
          exactSourceQuote: h.quote.slice(0, 420),
        });
        if (x) {
          shaped.push(x);
          hits++;
        }
      }
      if (hits) creditScanFindings.push({ documentId: src.id, documentTitle: src.documentTitle, hits });
    }
  }

  // Dedupe by normalized address + entity + type + source category
  const dedup = new Map<string, Omit<HarvestedAddress, "score" | "priority" | "confidence">>();
  for (const a of shaped) {
    const key = `${a.normalizedEntityName}|${a.normalizedAddress}|${a.addressType}|${a.sourceCategory}`;
    if (!dedup.has(key)) dedup.set(key, a);
  }
  const uniq = [...dedup.values()];

  // Multiplicity stats for scoring
  const addrKey = (a: { normalizedAddress: string; state?: string | null }) => `${a.normalizedAddress}|${a.state ?? ""}`;
  const sourceCountByAddr = new Map<string, number>();
  const entityCountByAddr = new Map<string, number>();
  const sourceCatsByAddr = new Map<string, Set<string>>();
  const entByAddr = new Map<string, Set<string>>();
  for (const a of uniq) {
    const k = addrKey(a);
    if (!sourceCatsByAddr.has(k)) sourceCatsByAddr.set(k, new Set());
    sourceCatsByAddr.get(k)!.add(a.sourceCategory);
    if (!entByAddr.has(k)) entByAddr.set(k, new Set());
    entByAddr.get(k)!.add(a.normalizedEntityName);
  }
  for (const [k, s] of sourceCatsByAddr.entries()) sourceCountByAddr.set(k, s.size);
  for (const [k, s] of entByAddr.entries()) entityCountByAddr.set(k, s.size);

  const addresses: HarvestedAddress[] = uniq.map((a) => {
    const state = a.state ? usStateAbbrFromText(a.state) ?? a.state : null;
    const k = addrKey({ normalizedAddress: a.normalizedAddress, state });
    const scored = scoreAddress({
      addressType: a.addressType,
      sourceCategory: a.sourceCategory,
      isPoBox: a.flags.isPoBox,
      isLikelyRegisteredAgent: a.flags.isLikelyRegisteredAgent,
      sourceMultiplicity: sourceCountByAddr.get(k) ?? 1,
      entityMultiplicity: entityCountByAddr.get(k) ?? 1,
    });
    return {
      ...a,
      state,
      score: scored.score,
      priority: scored.priority,
      confidence: scored.confidence,
    };
  });

  const rejected = addresses
    .filter((a) => a.flags.isLikelyRegisteredAgent || a.flags.isPoBox)
    .map((a) => ({
      address: a.rawAddress,
      normalizedAddress: a.normalizedAddress,
      reason: a.flags.isLikelyRegisteredAgent ? "Registered agent/service address (downranked)" : "PO Box (downranked)",
      source: `${a.sourceCategory} · ${a.sourceName}`,
      entity: a.entityName,
      notes: a.exactSourceQuote ?? "",
    }));

  const kept = addresses
    .filter((a) => !(a.flags.isLikelyRegisteredAgent && a.priority === "low"))
    .sort((a, b) => b.score - a.score);

  const clusters: AddressCluster[] = clusterAddresses(kept);

  // Attempt to persist (optional) into existing tables only (AddressClusterCandidate exists in schema but may not in DB).
  // If tables are missing, return results without saving.
  let persistenceBlockedReason: string | null = null;
  try {
    // Touch existing table to detect migrations.
    await prisma.addressClusterCandidate.findFirst({ where: { userId: ctx.userId, ticker: ctx.ticker }, select: { id: true } });
  } catch (e) {
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? String(e.code ?? "") : "";
    if (code === "P2021") {
      persistenceBlockedReason =
        "Database migrations not applied (address tables missing). Addresses/clusters are computed but not saved yet.";
    }
  }

  return NextResponse.json({
    ok: true,
    ticker: ctx.ticker,
    inputsSummary: {
      publicRecordsProfile: Boolean(pubProfile),
      entityIntelProfile: Boolean(intel),
      entityUniverseItems: universe.length,
      sosCandidates: sos.length,
      verifiedEntityRecords: verified.length,
      uccResults: ucc.length,
      creditDocumentSources: creditSources.length,
      creditDocScanEnabled: includeCreditDocScan,
    },
    persistenceBlockedReason,
    executiveSummary: {
      addressesRawCollected: shaped.length,
      addressesDeduped: uniq.length,
      addressesKept: kept.length,
      clusters: clusters.length,
      rejected: rejected.length,
      creditDocScanFindings: creditScanFindings.length,
    },
    tables: {
      addresses: kept.slice(0, 600),
      clusters: clusters.slice(0, 250),
      entityToAddress: kept
        .slice(0, 900)
        .map((a) => ({
          entityName: a.entityName,
          normalizedEntityName: a.normalizedEntityName,
          entitySource: a.sourceCategory,
          address: a.rawAddress,
          addressType: a.addressType,
          source: a.sourceName,
          confidence: a.confidence,
          notes: a.exactSourceQuote ?? "",
        })),
      rejected,
      manualQueue: persistenceBlockedReason
        ? clusters
            .filter((c) => c.priority !== "low")
            .slice(0, 60)
            .map((c) => ({
              entity: "(cluster)",
              state: c.state ?? "",
              searchTarget: c.normalizedAddress,
              searchSource: "SOS portal (manual) / bulk data",
              reason: "Automation not configured or blocked; use manual registry address search where available.",
              suggestedQuery: `"${c.normalizedAddress}"`,
              status: "open",
              userNotes: c.recommendedNextAction,
            }))
        : [],
    },
  });
}

