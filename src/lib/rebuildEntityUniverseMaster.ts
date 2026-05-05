import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  EntityUniverseSourceCategory,
  EntityUniverseItemRole,
  EntityUniverseConfidenceKind,
  EntityUniverseReviewStatus,
  CreditDocumentPartyRole,
  AddressClusterAddressKind,
} from "@/generated/prisma/client";
import { normalizeEntityName, isGenericRegisteredAgent } from "@/lib/entityNormalize";
import {
  addressKindForBonus,
  collateralFlags,
  debtorNameFinancePattern,
  scoreEntityRelevance,
} from "@/lib/scoreEntityRelevance";
import { scoreEntityConfidence } from "@/lib/scoreEntityConfidence";

function normKey(name: string): string {
  return normalizeEntityName(name).normalized;
}

function stateKey(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  if (t.length === 2 && t === t.toUpperCase()) return t;
  return t.slice(0, 2).toUpperCase();
}

function masterDedupKey(parts: { name: string; state: string; entityId?: string | null }): string {
  const eid = parts.entityId?.trim() || "";
  if (eid) return `id:${eid}`;
  return `${normKey(parts.name)}|${stateKey(parts.state)}`;
}

type Acc = {
  entityName: string;
  normalizedEntityName: string;
  state: string;
  jurisdiction: string;
  entityId: string | null;
  entityRole: EntityUniverseItemRole;
  primarySourceCategory: EntityUniverseSourceCategory;
  mergedSourceCategories: string[];
  sourceDocumentTitle: string | null;
  sourceDocumentUrl: string | null;
  sourceDate: Date | null;
  entityType: string | null;
  status: import("@/generated/prisma/client").VerifiedBusinessEntityStatus;
  formationDate: Date | null;
  registeredAgentName: string | null;
  registeredAgentAddress: string | null;
  principalOfficeAddress: string | null;
  mailingAddress: string | null;
  matchedAddress: string | null;
  matchedOfficerOrManager: string | null;
  listedInExhibit21: boolean;
  appearsInCreditDocs: boolean;
  appearsInUccSearch: boolean;
  appearsInSosSearch: boolean;
  appearsInAddressCluster: boolean;
  evidenceJson: Record<string, unknown>[];
  relevanceScore: number;
  confidence: EntityUniverseConfidenceKind;
  reviewStatus: EntityUniverseReviewStatus;
  notesParts: string[];
  creditRole?: CreditDocumentPartyRole | null;
  addressKind?: AddressClusterAddressKind | null;
};

function uniqPush(arr: string[], v: string) {
  if (!v || arr.includes(v)) return;
  arr.push(v);
}

function mapCreditRole(r: CreditDocumentPartyRole): EntityUniverseItemRole {
  const m: Partial<Record<CreditDocumentPartyRole, EntityUniverseItemRole>> = {
    borrower: "borrower",
    issuer: "issuer",
    co_issuer: "co_issuer",
    guarantor: "guarantor",
    grantor: "grantor",
    pledgor: "pledgor",
    collateral_owner: "collateral_owner",
    restricted_subsidiary: "restricted_subsidiary",
    unrestricted_subsidiary: "unrestricted_subsidiary",
    excluded_subsidiary: "excluded_subsidiary",
    immaterial_subsidiary: "immaterial_subsidiary",
    receivables_subsidiary: "receivables_sub",
    securitization_subsidiary: "securitization_vehicle",
    foreign_subsidiary: "possible_affiliate",
    non_guarantor_subsidiary: "non_guarantor_subsidiary",
    loan_party: "unknown",
    other: "unknown",
  };
  return m[r] ?? "unknown";
}

export async function rebuildEntityUniverseMaster(prismaInput: PrismaClient | Prisma.TransactionClient, userId: string, ticker: string) {
  const e21Rows = await prismaInput.exhibit21Subsidiary.findMany({ where: { userId, ticker } });
  const exSet = new Set(e21Rows.map((r) => normKey(r.entityName)));

  const syncListed = async () => {
    const cd = await prismaInput.creditDocumentEntity.findMany({ where: { userId, ticker } });
    for (const r of cd) {
      const v = exSet.has(normKey(r.entityName));
      if (r.listedInExhibit21 !== v) await prismaInput.creditDocumentEntity.update({ where: { id: r.id }, data: { listedInExhibit21: v } });
    }
    const ucc = await prismaInput.uccDebtorCandidate.findMany({ where: { userId, ticker } });
    for (const r of ucc) {
      const v = exSet.has(normKey(r.debtorName));
      if (r.listedInExhibit21 !== v) await prismaInput.uccDebtorCandidate.update({ where: { id: r.id }, data: { listedInExhibit21: v } });
    }
    const sos = await prismaInput.sosNameFamilyCandidate.findMany({ where: { userId, ticker } });
    for (const r of sos) {
      const v = exSet.has(normKey(r.candidateEntityName));
      if (r.listedInExhibit21 !== v)
        await prismaInput.sosNameFamilyCandidate.update({ where: { id: r.id }, data: { listedInExhibit21: v } });
    }
    const ad = await prismaInput.addressClusterCandidate.findMany({ where: { userId, ticker } });
    for (const r of ad) {
      const v = exSet.has(normKey(r.candidateEntityName));
      if (r.listedInExhibit21 !== v)
        await prismaInput.addressClusterCandidate.update({ where: { id: r.id }, data: { listedInExhibit21: v } });
    }
  };

  await syncListed();

  const cds = await prismaInput.creditDocumentEntity.findMany({ where: { userId, ticker } });
  const uccs = await prismaInput.uccDebtorCandidate.findMany({ where: { userId, ticker } });
  const soss = await prismaInput.sosNameFamilyCandidate.findMany({ where: { userId, ticker } });
  const adds = await prismaInput.addressClusterCandidate.findMany({ where: { userId, ticker } });

  const merged = new Map<string, Acc>();

  type BumpInit = Omit<Acc, "evidenceJson" | "mergedSourceCategories" | "notesParts"> & {
    mergedSourceCategories?: string[];
  };

  const bump = (key: string, init: BumpInit) => {
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, {
        ...init,
        mergedSourceCategories: init.mergedSourceCategories ?? [],
        evidenceJson: [],
        notesParts: [],
        creditRole: init.creditRole,
        addressKind: init.addressKind,
      });
      return merged.get(key)!;
    }
    prev.listedInExhibit21 ||= init.listedInExhibit21;
    prev.appearsInCreditDocs ||= init.appearsInCreditDocs;
    prev.appearsInUccSearch ||= init.appearsInUccSearch;
    prev.appearsInSosSearch ||= init.appearsInSosSearch;
    prev.appearsInAddressCluster ||= init.appearsInAddressCluster;
    prev.entityId ||= init.entityId;
    if ((init.entityRole as string) !== "unknown") prev.entityRole = init.entityRole;
    if ((init.primarySourceCategory as string) !== "other") prev.primarySourceCategory = init.primarySourceCategory;
    for (const sc of init.mergedSourceCategories ?? []) uniqPush(prev.mergedSourceCategories, sc);
    prev.relevanceScore = Math.max(prev.relevanceScore, init.relevanceScore);
    mergeConfidence(prev, init.confidence);
    if (!prev.sourceDocumentTitle && init.sourceDocumentTitle) prev.sourceDocumentTitle = init.sourceDocumentTitle;
    if (!prev.sourceDocumentUrl && init.sourceDocumentUrl) prev.sourceDocumentUrl = init.sourceDocumentUrl;
    if (!prev.sourceDate && init.sourceDate) prev.sourceDate = init.sourceDate;
    prev.creditRole = prev.creditRole ?? init.creditRole;
    prev.addressKind = prev.addressKind ?? init.addressKind;
    return prev;
  };

  for (const row of e21Rows) {
    const st = row.jurisdiction ? stateKey(row.jurisdiction) : "";
    const key = masterDedupKey({ name: row.entityName, state: st, entityId: null });
    const accInit: BumpInit = {
      entityName: row.entityName,
      normalizedEntityName: normKey(row.entityName),
      state: st,
      jurisdiction: row.jurisdiction ?? "",
      entityId: null,
      entityRole: "exhibit_21_subsidiary",
      primarySourceCategory: "exhibit_21",
      mergedSourceCategories: ["exhibit_21"],
      sourceDocumentTitle: row.source10KTitle,
      sourceDocumentUrl: row.source10KUrl,
      sourceDate: null,
      entityType: null,
      status: "unknown",
      formationDate: null,
      registeredAgentName: null,
      registeredAgentAddress: null,
      principalOfficeAddress: null,
      mailingAddress: null,
      matchedAddress: null,
      matchedOfficerOrManager: null,
      listedInExhibit21: true,
      appearsInCreditDocs: false,
      appearsInUccSearch: false,
      appearsInSosSearch: false,
      appearsInAddressCluster: false,
      relevanceScore: 0,
      confidence: "unknown",
      reviewStatus: "unreviewed",
    };
    const rel = scoreEntityRelevance({
      listedInExhibit21: true,
      creditRole: null,
      hasUccDebtorEvidence: false,
      nameRootMatch: true,
      caution: {},
    });
    const conf = scoreEntityConfidence({
      inOfficialSubsidiaryList: true,
      exactNameRegistry: false,
      sourceUrlCaptured: Boolean(row.source10KUrl),
    });
    accInit.relevanceScore = rel;
    accInit.confidence = conf;
    bump(key, accInit);
    const tgt = merged.get(key)!;
    tgt.evidenceJson.push({ layer: "exhibit_21", title: row.source10KTitle, fiscalYear: row.fiscalYear });
  }

  for (const c of cds) {
    const st = "";
    const key = masterDedupKey({ name: c.entityName, state: st, entityId: null });
    const rel = scoreEntityRelevance({
      listedInExhibit21: exSet.has(normKey(c.entityName)),
      creditRole: c.entityRole as CreditDocumentPartyRole,
      nameRootMatch: true,
      caution: {},
    });
    const conf = scoreEntityConfidence({
      exactNameRegistry: false,
      sourceUrlCaptured: Boolean(c.sourceDocumentUrl),
      inCreditDocsWithExcerpt: Boolean(c.excerpt),
    });
    bump(key, {
      entityName: c.entityName,
      normalizedEntityName: normKey(c.entityName),
      state: st,
      jurisdiction: "",
      entityId: null,
      entityRole: mapCreditRole(c.entityRole),
      primarySourceCategory: "credit_document",
      mergedSourceCategories: ["credit_document"],
      sourceDocumentTitle: c.sourceDocumentTitle,
      sourceDocumentUrl: c.sourceDocumentUrl,
      sourceDate: c.sourceDate,
      entityType: null,
      status: "unknown",
      formationDate: null,
      registeredAgentName: null,
      registeredAgentAddress: null,
      principalOfficeAddress: null,
      mailingAddress: null,
      matchedAddress: null,
      matchedOfficerOrManager: null,
      listedInExhibit21: exSet.has(normKey(c.entityName)),
      appearsInCreditDocs: true,
      appearsInUccSearch: false,
      appearsInSosSearch: false,
      appearsInAddressCluster: false,
      relevanceScore: Math.max(rel, c.relevanceScore ?? 0),
      confidence: conf,
      reviewStatus: "unreviewed",
      creditRole: c.entityRole as CreditDocumentPartyRole,
    });
    merged.get(key)!.evidenceJson.push({ layer: "credit_document", excerpt: (c.excerpt ?? "").slice(0, 500), doc: c.sourceDocumentTitle });
  }

  for (const u of uccs) {
    const cf = collateralFlags(u.collateralDescription ?? undefined);
    const key = masterDedupKey({ name: u.debtorName, state: stateKey(u.state), entityId: null });
    const rel = scoreEntityRelevance({
      listedInExhibit21: exSet.has(normKey(u.debtorName)),
      hasUccDebtorEvidence: true,
      collateralLooksMaterial: cf.collateralLooksMaterial,
      collateralReceivablesInventoryEquipmentDepositIp: cf.collateralReceivablesInventoryEquipmentDepositIp,
      financeSpvPattern: debtorNameFinancePattern(u.debtorName),
    });
    bump(key, {
      entityName: u.debtorName,
      normalizedEntityName: normKey(u.debtorName),
      state: stateKey(u.state),
      jurisdiction: u.state,
      entityId: null,
      entityRole: debtorNameFinancePattern(u.debtorName) ? "finance_sub" : "possible_affiliate",
      primarySourceCategory: "ucc_debtor_search",
      mergedSourceCategories: ["ucc_debtor_search"],
      sourceDocumentTitle: null,
      sourceDocumentUrl: null,
      sourceDate: u.filingDate,
      entityType: null,
      status: "unknown",
      formationDate: null,
      registeredAgentName: null,
      registeredAgentAddress: null,
      principalOfficeAddress: null,
      mailingAddress: null,
      matchedAddress: null,
      matchedOfficerOrManager: null,
      listedInExhibit21: exSet.has(normKey(u.debtorName)),
      appearsInCreditDocs: u.appearsInCreditDocs,
      appearsInUccSearch: true,
      appearsInSosSearch: false,
      appearsInAddressCluster: false,
      relevanceScore: Math.max(rel, u.relevanceScore),
      confidence: u.confidence,
      reviewStatus: u.reviewStatus,
    });
    merged.get(key)!.evidenceJson.push({
      layer: "ucc",
      filingNumber: u.filingNumber,
      securedParty: u.securedPartyName,
      collateral: (u.collateralDescription ?? "").slice(0, 400),
    });
  }

  for (const s of soss) {
    const gra = Boolean(s.registeredAgentName && isGenericRegisteredAgent(s.registeredAgentName));
    const key = masterDedupKey({ name: s.candidateEntityName, state: stateKey(s.state), entityId: s.entityId });
    const nk = normalizeEntityName(s.candidateEntityName);
    const nm =
      nk.root.length >= 4 && e21Rows.some((e) => normalizeEntityName(e.entityName).root === nk.root);
    const rel = scoreEntityRelevance({
      listedInExhibit21: exSet.has(normKey(s.candidateEntityName)),
      creditRole: null,
      nameRootMatch: nm,
      financeSpvPattern: debtorNameFinancePattern(s.candidateEntityName),
      ipRealEstateAssetHoldingsPattern: /\b(ip|real\s+estate)\b/i.test(s.candidateEntityName),
      caution: {
        genericRegisteredAgentOnly: gra && !nm && !s.appearsInCreditDocs,
        nameSimilarityOnly: !gra && nm && !s.appearsInCreditDocs,
      },
    });
    const conf = scoreEntityConfidence({
      exactNameRegistry: Boolean(s.entityId),
      sourceUrlCaptured: Boolean(s.sourceUrl),
      genericRegisteredAgentOnly: gra && !s.appearsInCreditDocs,
      strongUccEvidence: false,
      nameSimilarityOnly: nm && !s.entityId && !gra,
      inCreditDocsWithExcerpt: s.appearsInCreditDocs,
    });
    bump(key, {
      entityName: s.candidateEntityName,
      normalizedEntityName: normKey(s.candidateEntityName),
      state: stateKey(s.state),
      jurisdiction: s.state,
      entityId: s.entityId ?? null,
      entityType: s.entityType,
      formationDate: s.formationDate,
      registeredAgentName: s.registeredAgentName,
      registeredAgentAddress: s.registeredAgentAddress,
      principalOfficeAddress: s.principalOfficeAddress,
      mailingAddress: s.mailingAddress,
      status: s.status,
      entityRole: "possible_affiliate",
      primarySourceCategory: "sos_name_family_search",
      mergedSourceCategories: ["sos_name_family_search"],
      sourceDocumentTitle: null,
      sourceDocumentUrl: s.sourceUrl,
      sourceDate: null,
      matchedAddress: null,
      matchedOfficerOrManager: null,
      listedInExhibit21: exSet.has(normKey(s.candidateEntityName)),
      appearsInCreditDocs: s.appearsInCreditDocs,
      appearsInUccSearch: false,
      appearsInSosSearch: true,
      appearsInAddressCluster: false,
      relevanceScore: Math.max(rel, s.relevanceScore),
      confidence: conf,
      reviewStatus: s.reviewStatus,
    });
    merged.get(key)!.evidenceJson.push({ layer: "sos_candidate", matchedSearchTerm: s.matchedSearchTerm });
  }

  for (const a of adds) {
    const nk = normalizeEntityName(a.candidateEntityName);
    const nm =
      nk.root.length >= 4 && e21Rows.some((e) => normalizeEntityName(e.entityName).root === nk.root);
    const adj = addressKindForBonus(a.addressType);
    const addrKey = masterDedupKey({ name: a.candidateEntityName, state: stateKey(a.state), entityId: a.entityId });
    const relAddr = scoreEntityRelevance({
      listedInExhibit21: exSet.has(normKey(a.candidateEntityName)),
      financeSpvPattern: debtorNameFinancePattern(a.candidateEntityName),
      nameRootMatch: nm,
      ...adj,
      caution: nm ? {} : { nameSimilarityOnly: true },
    });
    bump(addrKey, {
      entityName: a.candidateEntityName,
      normalizedEntityName: normKey(a.candidateEntityName),
      state: stateKey(a.state),
      jurisdiction: a.state,
      entityId: a.entityId ?? null,
      entityType: a.entityType,
      status: a.status,
      formationDate: null,
      registeredAgentName: null,
      registeredAgentAddress: null,
      principalOfficeAddress: null,
      mailingAddress: null,
      matchedAddress: a.matchedAddress,
      matchedOfficerOrManager: null,
      entityRole: "possible_affiliate",
      primarySourceCategory: "address_cluster_search",
      mergedSourceCategories: ["address_cluster_search"],
      sourceDocumentTitle: null,
      sourceDocumentUrl: a.sourceUrl,
      sourceDate: null,
      listedInExhibit21: exSet.has(normKey(a.candidateEntityName)),
      appearsInCreditDocs: a.appearsInCreditDocs,
      appearsInUccSearch: false,
      appearsInSosSearch: false,
      appearsInAddressCluster: true,
      relevanceScore: Math.max(relAddr, a.relevanceScore),
      confidence: a.confidence,
      reviewStatus: a.reviewStatus,
      addressKind: a.addressType,
    });
    const tg = merged.get(addrKey)!;
    if (Array.isArray(a.evidenceJson) || (typeof a.evidenceJson === "object" && a.evidenceJson))
      tg.evidenceJson.push({ layer: "address_cluster", snippets: a.evidenceJson });
  }

  /** Recalculate consolidated relevance/confidence-ish max */
  const rows = [...merged.values()].map((acc) => {
    const recapRel = scoreEntityRelevance({
      listedInExhibit21: acc.listedInExhibit21,
      creditRole: acc.creditRole ?? null,
      hasUccDebtorEvidence: acc.appearsInUccSearch,
      nameRootMatch: acc.appearsInSosSearch || acc.appearsInAddressCluster,
      financeSpvPattern: debtorNameFinancePattern(acc.entityName),
      ipRealEstateAssetHoldingsPattern: /\b(ip|intellectual\s+property|patent)\b/i.test(acc.entityName),
      ...addressKindForBonus(acc.addressKind ?? undefined),
      caution:
        String(acc.entityRole) === "possible_affiliate" && !acc.appearsInCreditDocs && acc.appearsInSosSearch
          ? { nameSimilarityOnly: true }
          : {},
    });
    acc.relevanceScore = Math.max(acc.relevanceScore, recapRel);

    mergeConfidence(acc, scoreEntityConfidence({ inCreditDocsWithExcerpt: acc.appearsInCreditDocs, strongUccEvidence: acc.appearsInUccSearch }));

    return {
      userId,
      ticker,
      entityName: acc.entityName,
      normalizedEntityName: acc.normalizedEntityName,
      entityRole: acc.entityRole,
      primarySourceCategory: acc.primarySourceCategory,
      mergedSourceCategories: acc.mergedSourceCategories,
      sourceDocumentTitle: acc.sourceDocumentTitle,
      sourceDocumentUrl: acc.sourceDocumentUrl,
      sourceDate: acc.sourceDate,
      state: acc.state,
      jurisdiction: acc.jurisdiction,
      entityId: acc.entityId,
      entityType: acc.entityType,
      status: acc.status,
      formationDate: acc.formationDate,
      registeredAgentName: acc.registeredAgentName,
      registeredAgentAddress: acc.registeredAgentAddress,
      principalOfficeAddress: acc.principalOfficeAddress,
      mailingAddress: acc.mailingAddress,
      matchedAddress: acc.matchedAddress,
      matchedOfficerOrManager: acc.matchedOfficerOrManager,
      listedInExhibit21: acc.listedInExhibit21,
      appearsInCreditDocs: acc.appearsInCreditDocs,
      appearsInUccSearch: acc.appearsInUccSearch,
      appearsInSosSearch: acc.appearsInSosSearch,
      appearsInAddressCluster: acc.appearsInAddressCluster,
      evidenceJson: acc.evidenceJson.slice(0, 24),
      confidence: acc.confidence,
      relevanceScore: clampScore(acc.relevanceScore),
      reviewStatus: acc.reviewStatus,
      duplicateGroupKey: `${acc.normalizedEntityName}|${acc.state}|${acc.entityId ?? ""}`,
      notes: acc.notesParts.length ? acc.notesParts.join("\n") : null,
    };
  });

  await prismaInput.entityUniverseItem.deleteMany({ where: { userId, ticker } });
  if (rows.length > 0) {
    /** createMany skips duplicate duplicateGroupKey — uniq first */
    const byKey = new Map<string, (typeof rows)[0]>();
    for (const r of rows) {
      const dk = `${r.normalizedEntityName}|${r.state}|${r.entityId ?? ""}`;
      const prev = byKey.get(dk);
      if (!prev) byKey.set(dk, r);
      else {
        prev.evidenceJson = [...(prev.evidenceJson as unknown[]), ...((r.evidenceJson as unknown[]) ?? [])].slice(0, 24) as never;
        prev.relevanceScore = Math.max(prev.relevanceScore, r.relevanceScore);
        mergeRow(prev, r);
      }
    }
    const finalRows = [...byKey.values()];
    await prismaInput.entityUniverseItem.createMany({
      data: finalRows.map((r) => ({
        ...r,
        evidenceJson: r.evidenceJson as Prisma.InputJsonValue | undefined,
      })),
    });
  }
}

function mergeRow(prev: { [k: string]: unknown }, cur: { [k: string]: unknown }) {
  const bools = [
    "listedInExhibit21",
    "appearsInCreditDocs",
    "appearsInUccSearch",
    "appearsInSosSearch",
    "appearsInAddressCluster",
  ] as const;
  for (const b of bools) prev[b] = Boolean(prev[b] || cur[b]);
}

function clampScore(s: number) {
  return Math.max(0, Math.min(100, Math.round(s)));
}

const confOrder: EntityUniverseConfidenceKind[] = ["unknown", "low", "medium", "high"];

function mergeConfidence(acc: Pick<Acc, "confidence">, next: EntityUniverseConfidenceKind) {
  const a = Math.max(confOrder.indexOf(acc.confidence), confOrder.indexOf(next));
  acc.confidence = confOrder[a] ?? acc.confidence;
}
