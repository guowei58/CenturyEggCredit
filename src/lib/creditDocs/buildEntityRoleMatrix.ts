import type { CreditDocWorkflowEntityRole } from "@/generated/prisma/client";
import type { CreditDocExtractionConfidence } from "@/generated/prisma/client";
import type { CreditMatrixRoleKey, RoleFlagTriState } from "./matrixRoleKeys";
import { emptyRoleFlagsJson } from "./matrixRoleKeys";
import { mergeRoleFlag, triStateFromExtractionConfidence, workflowRoleToMatrixKey } from "./workflowRoleMatrixMerge";
import { scoreFromRoles } from "./scoreCreditDocEntityRelevance";
import type { EntityUniverseConfidenceKind } from "@/generated/prisma/client";

const NON_BRANCH_AFFILIATE: CreditDocWorkflowEntityRole[] = [
  "administrative_agent",
  "trustee",
  "lender",
  "secured_party",
  "collateral_agent",
  "other",
  "unknown",
];

export type MinimalExtraction = {
  id: string;
  entityName: string;
  normalizedEntityName: string;
  entityRole: CreditDocWorkflowEntityRole;
  roleConfidence: CreditDocExtractionConfidence;
  creditDocumentSourceId: string;
  sourceSection: string | null;
  sourceSchedule: string | null;
  excerpt: string | null;
};

export type MatrixBuildRow = {
  entityName: string;
  normalizedEntityName: string;
  state: string;
  jurisdiction: string;
  sourceDocumentIds: string[];
  sourceDocumentTitles: string[];
  /** role key → excerpts list */
  sourceEvidenceJson: Record<string, unknown>;
  roleFlagsJson: Record<CreditMatrixRoleKey, RoleFlagTriState>;
  listedInExhibit21: boolean;
  alreadyInEntityUniverse: boolean;
  reconciliationFlagsJson: Record<string, boolean>;
  relevanceScore: number;
  confidence: EntityUniverseConfidenceKind;
  recommendedPrimaryRole?: import("@/generated/prisma/client").EntityUniverseItemRole;
  keyEvidence: string;
};

/** Merge duplicated extractions per normalized entity. */
export function buildEntityRoleMatrixRows(
  rows: MinimalExtraction[],
  sourceTitleById: Map<string, string>,
  exhibit21Norms: Set<string>,
  universeNorms: Set<string>
): MatrixBuildRow[] {
  const groups = new Map<string, MinimalExtraction[]>();
  for (const r of rows) {
    const k = r.normalizedEntityName;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const out: MatrixBuildRow[] = [];

  for (const [normKey, grp] of groups) {
    const displayName =
      grp
        .map((g) => g.entityName)
        .sort((a, b) => b.length - a.length)[0] ?? normKey;

    const flags = emptyRoleFlagsJson();
    /** Evidence map: camelCase matrix key → { extractions[] } */
    const evidenceCells: Record<string, { excerpts: Array<Record<string, unknown>> }> = {};
    const docIdsSet = new Set<string>();
    const titles: string[] = [];
    let keySnippet = "";

    const roleBag: CreditDocWorkflowEntityRole[] = [];

    for (const ext of grp) {
      docIdsSet.add(ext.creditDocumentSourceId);
      titles.push(sourceTitleById.get(ext.creditDocumentSourceId) ?? "(document)");
      if (!keySnippet && ext.excerpt) keySnippet = ext.excerpt.slice(0, 280);

      const mk = workflowRoleToMatrixKey(ext.entityRole);
      roleBag.push(ext.entityRole);
      if (mk) {
        const isAffiliate = !NON_BRANCH_AFFILIATE.includes(ext.entityRole);
        const ts = triStateFromExtractionConfidence(ext.roleConfidence, isAffiliate);
        flags[mk] = mergeRoleFlag(flags[mk], ts);
        if (!evidenceCells[mk]) evidenceCells[mk] = { excerpts: [] };
        evidenceCells[mk]!.excerpts.push({
          extractionId: ext.id,
          documentId: ext.creditDocumentSourceId,
          documentTitle: sourceTitleById.get(ext.creditDocumentSourceId),
          section: ext.sourceSection,
          schedule: ext.sourceSchedule,
          excerpt: ext.excerpt,
          roleConfidence: ext.roleConfidence,
        });
      }
    }

    const inEx21 = exhibit21Norms.has(normKey);
    const inUniverse = universeNorms.has(normKey);
    /** Entity appears as party in extracted rows but subsidiary schedule may omit it. */
    flags.notListedInExhibit21 = inEx21 ? "false" : grp.length > 0 ? "true" : "unknown";

    /** needsFollowUp heuristic */
    for (const ext of grp) {
      if (ext.roleConfidence === "low") flags.needsFollowUp = mergeRoleFlag(flags.needsFollowUp, "needs_review");
    }

    const { score, tier } = scoreFromRoles({
      roles: roleBag,
      notInEx21: !inEx21 && roleBag.some((r) => !NON_BRANCH_AFFILIATE.includes(r)),
      docCountBoost: docIdsSet.size >= 2,
    });

    const conf: EntityUniverseConfidenceKind =
      tier === "high" ? "high" : tier === "medium" ? "medium" : tier === "low" ? "low" : "unknown";

    const recFlags: Record<string, boolean> = {
      borrower_not_in_exhibit_21: grp.some((e) => e.entityRole === "borrower") && !inEx21,
      guarantor_not_in_exhibit_21: grp.some((e) => e.entityRole === "guarantor") && !inEx21,
    };

    out.push({
      entityName: displayName,
      normalizedEntityName: normKey,
      state: "",
      jurisdiction: "",
      sourceDocumentIds: [...docIdsSet],
      sourceDocumentTitles: [...new Set(titles)],
      sourceEvidenceJson: evidenceCells,
      roleFlagsJson: flags,
      listedInExhibit21: inEx21,
      alreadyInEntityUniverse: inUniverse,
      reconciliationFlagsJson: recFlags,
      relevanceScore: score,
      confidence: conf,
      keyEvidence: keySnippet,
    });
  }

  /** Sort descending relevance */
  out.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return out;
}

export function derivePrimaryUniverseRole(
  matrixFlags: Partial<Record<CreditMatrixRoleKey, RoleFlagTriState>>
): import("@/generated/prisma/client").EntityUniverseItemRole {
  /** Spec §15 hierarchy applied to affirmative cells */
  const order: CreditMatrixRoleKey[] = [
    "borrower",
    "issuer",
    "coIssuer",
    "guarantor",
    "grantor",
    "pledgor",
    "collateralOwner",
    "receivablesSubsidiary",
    "securitizationSubsidiary",
    "financeSubsidiary",
    "unrestrictedSubsidiary",
    "restrictedNonGuarantorSubsidiary",
    "nonGuarantorSubsidiary",
    "restrictedSubsidiary",
    "excludedSubsidiary",
    "immaterialSubsidiary",
    "parent",
    "holdingCompany",
    "operatingCompany",
  ];

  const mapRole: Partial<Record<CreditMatrixRoleKey, import("@/generated/prisma/client").EntityUniverseItemRole>> = {
    borrower: "borrower",
    issuer: "issuer",
    coIssuer: "co_issuer",
    guarantor: "guarantor",
    grantor: "grantor",
    pledgor: "pledgor",
    collateralOwner: "collateral_owner",
    receivablesSubsidiary: "receivables_sub",
    securitizationSubsidiary: "securitization_vehicle",
    financeSubsidiary: "finance_sub",
    unrestrictedSubsidiary: "unrestricted_subsidiary",
    restrictedNonGuarantorSubsidiary: "non_guarantor_subsidiary",
    nonGuarantorSubsidiary: "non_guarantor_subsidiary",
    restrictedSubsidiary: "restricted_subsidiary",
    excludedSubsidiary: "excluded_subsidiary",
    immaterialSubsidiary: "immaterial_subsidiary",
    parent: "public_parent",
    holdingCompany: "holding_company",
    operatingCompany: "operating_company",
  };

  for (const mk of order) {
    if (matrixFlags[mk] === "true") {
      return mapRole[mk] ?? "unknown";
    }
  }
  return "unknown";
}
