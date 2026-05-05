/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import type {
  AddressClusterCandidate,
  CreditDocumentEntity,
  EntityUniverseItem,
  SosNameFamilyCandidate,
  UccDebtorCandidate,
} from "@/generated/prisma/client";
import type {
  CreditDocumentPartyRole,
  EntityUniverseIssueKind,
  EntityUniverseIssueSeverityLevel,
  VerifiedBusinessEntityStatus,
} from "@/generated/prisma/client";

export type GeneratedUniverseIssue = {
  relatedEntityUniverseItemId?: string | null;
  relatedEntityName: string;
  issueType: EntityUniverseIssueKind;
  severity: EntityUniverseIssueSeverityLevel;
  issueTitle: string;
  issueDescription: string;
  evidenceJson?: Record<string, unknown> | null;
  sourceUrl?: string | null;
};

const BAD_VERIFIED: VerifiedBusinessEntityStatus[] = [
  "inactive",
  "dissolved",
  "forfeited",
  "withdrawn",
  "cancelled",
  "revoked",
  "expired",
];

function severityForCreditPartyMissingEx21(role: CreditDocumentPartyRole | null | undefined): EntityUniverseIssueSeverityLevel | null {
  if (!role) return null;
  if (role === "borrower" || role === "issuer" || role === "co_issuer" || role === "guarantor") return "high";
  if (role === "grantor" || role === "pledgor" || role === "collateral_owner") return "medium";
  if (role === "receivables_subsidiary" || role === "securitization_subsidiary") return "medium";
  return null;
}

function inactiveCreditParty(role: CreditDocumentPartyRole | null | undefined): boolean {
  return role === "borrower" || role === "issuer" || role === "co_issuer" || role === "guarantor";
}

export function generateEntityUniverseIssuesFromLayers(input: {
  creditDocs: Pick<CreditDocumentEntity, "entityName" | "listedInExhibit21" | "entityRole">[];
  uccCandidates: Pick<
    UccDebtorCandidate,
    "debtorName" | "listedInExhibit21" | "appearsInCreditDocs" | "collateralDescription" | "confidence" | "relevanceScore"
  >[];
  sosCandidates: Pick<
    SosNameFamilyCandidate,
    "candidateEntityName" | "listedInExhibit21" | "confidence" | "relevanceScore" | "status"
  >[];
  addressCandidates: Pick<
    AddressClusterCandidate,
    "candidateEntityName" | "listedInExhibit21" | "confidence" | "relevanceScore" | "appearsInCreditDocs"
  >[];
  masterItems?: Pick<
    EntityUniverseItem,
    | "id"
    | "entityName"
    | "entityRole"
    | "listedInExhibit21"
    | "relevanceScore"
    | "status"
    | "appearsInCreditDocs"
    | "appearsInUccSearch"
  >[];
}): GeneratedUniverseIssue[] {
  const out: GeneratedUniverseIssue[] = [];

  for (const c of input.creditDocs) {
    if (c.listedInExhibit21) continue;
    const sev = severityForCreditPartyMissingEx21(c.entityRole as CreditDocumentPartyRole);
    if (!sev) continue;
    const role = c.entityRole as CreditDocumentPartyRole;
    let kind: EntityUniverseIssueKind = "credit_doc_entity_not_in_exhibit_21";
    if (role === "receivables_subsidiary") kind = "receivables_entity_not_in_exhibit_21";
    else if (role === "securitization_subsidiary") kind = "securitization_entity_not_in_exhibit_21";

    out.push({
      relatedEntityName: c.entityName,
      issueType: kind,
      severity: sev,
      issueTitle: `Credit-document party not listed in Exhibit 21 (${roleLabel(role)})`,
      issueDescription: `${roleLabel(role)} from credit-document capture is flagged **not listed in Exhibit 21** — requires follow-up.`,
      evidenceJson: {
        listedInExhibit21: false,
        entityRole: role,
        sourceHint: "credit_document",
      },
    });

    if (role === "unrestricted_subsidiary" || role === "excluded_subsidiary") {
      out.push({
        relatedEntityName: c.entityName,
        issueType: "credit_doc_entity_not_in_exhibit_21",
        severity: "low",
        issueTitle: `Subsidiary classification note (${role.replace(/_/g, " ")})`,
        issueDescription:
          `Entity categorized as ${roleLabel(role)} in credit-document capture — cross-check Exhibit 21 and agreement definitions.`,
        evidenceJson: { entityRole: role },
      });
    }
  }

  for (const u of input.uccCandidates) {
    if (u.listedInExhibit21) continue;
    const mat = !!(
      u.collateralDescription &&
      /receivable|equipment|inventory|deposit|fixture|intellectual|real\s+estate|\ball\s+assets\b/i.test(u.collateralDescription)
    );
    const lev =
      mat || u.appearsInCreditDocs ? "medium" : u.relevanceScore >= 55 ? "medium" : "low";
    out.push({
      relatedEntityName: u.debtorName,
      issueType: looksFinanceVehicle(u.debtorName) ? "finance_entity_not_in_exhibit_21" : "ucc_debtor_not_in_exhibit_21",
      severity: lev,
      issueTitle: "UCC debtor candidate — not listed in Exhibit 21",
      issueDescription: manualReviewDesc("UCC debtor candidate", Boolean(u.appearsInCreditDocs), mat),
      evidenceJson: {
        entityNameHint: u.debtorName,
        collateralMaterialHint: mat,
        appearsInCreditDocs: u.appearsInCreditDocs,
      },
    });
    if (!u.appearsInCreditDocs && u.confidence !== "unknown") {
      out.push({
        relatedEntityName: u.debtorName,
        issueType: "needs_manual_confirmation",
        severity: "low",
        issueTitle: "UCC debtor — limited cross-document linkage",
        issueDescription: needsConfirmationPhrase(),
        evidenceJson: { lane: "ucc" },
      });
    }
  }

  for (const s of input.sosCandidates) {
    if (s.listedInExhibit21) continue;
    const highRel = (s.relevanceScore ?? 0) >= 60;
    if (BAD_VERIFIED.includes(String(s.status) as VerifiedBusinessEntityStatus)) {
      out.push({
        relatedEntityName: s.candidateEntityName,
        issueType: "inactive_or_dissolved_candidate",
        severity: highRel ? "medium" : "low",
        issueTitle: "Registry status flagged for SOS name-family candidate",
        issueDescription:
          `Registry lists status "${String(s.status).replace(/_/g, " ")}" — corroborate with agreements or other official excerpts before reliance.`,
      });
      continue;
    }
    if ((s.relevanceScore ?? 0) >= 65 && s.confidence !== "high") {
      out.push({
        relatedEntityName: s.candidateEntityName,
        issueType: "name_family_candidate",
        severity: "medium",
        issueTitle: "High-scoring name-family candidate needing confirmation",
        issueDescription: nameFamilyFollowUpDesc(),
      });
    }
  }

  for (const a of input.addressCandidates) {
    if (a.listedInExhibit21) continue;
    if ((a.relevanceScore ?? 0) >= 55) {
      out.push({
        relatedEntityName: a.candidateEntityName,
        issueType: "address_cluster_candidate",
        severity: a.confidence === "high" ? "medium" : "low",
        issueTitle: "Address-cluster candidate — not listed in Exhibit 21",
        issueDescription: manualReviewDesc("Address-cluster candidate", Boolean(a.appearsInCreditDocs), false),
      });
    }
  }

  const seenDup = new Map<string, number>();
  if (input.masterItems) {
    for (const m of input.masterItems) {
      const kdup = `${m.entityName}|${inactiveCreditParty(m.entityRole as CreditDocumentPartyRole)}`;
      seenDup.set(kdup, (seenDup.get(kdup) ?? 0) + 1);

      if (m.listedInExhibit21) continue;

      if (looksIp(m.entityRole, m.entityName)) {
        out.push({
          relatedEntityUniverseItemId: m.id,
          relatedEntityName: m.entityName,
          issueType: "ip_holding_entity_not_in_exhibit_21",
          severity: m.relevanceScore >= 55 ? "high" : "medium",
          issueTitle: `Possible IP-focused entity candidate — ${notListedEx21Short}`,
          issueDescription: labelingOnlyDesc("IP-holding pattern"),
          evidenceJson: { relevanceScore: m.relevanceScore },
        });
      }

      if (looksRe(m.entityName, m.entityRole)) {
        out.push({
          relatedEntityUniverseItemId: m.id,
          relatedEntityName: m.entityName,
          issueType: "real_estate_entity_not_in_exhibit_21",
          severity: m.relevanceScore >= 55 ? "high" : "medium",
          issueTitle: `Possible real-estate-holding candidate — ${notListedEx21Short}`,
          issueDescription: labelingOnlyDesc("real-estate-related pattern"),
        });
      }

      if (
        inactiveCreditParty(m.entityRole as CreditDocumentPartyRole) &&
        BAD_VERIFIED.includes(String(m.status) as VerifiedBusinessEntityStatus)
      ) {
        out.push({
          relatedEntityUniverseItemId: m.id,
          relatedEntityName: m.entityName,
          issueType: "borrower_or_guarantor_status_issue",
          severity: "critical",
          issueTitle: "Credit-party consolidated row with adverse registry marker",
          issueDescription:
            "**Requires follow-up:** verify charter or registry excerpts against borrower / guarantor status assumptions.",
          evidenceJson: { registryStatus: m.status },
        });
      }
    }

    for (const [key, ct] of seenDup) {
      if (ct <= 1) continue;
      const name = key.split("|")[0]!;
      out.push({
        relatedEntityName: name,
        issueType: "multiple_name_matches",
        severity: "medium",
        issueTitle: "Multiple consolidated captures with similar borrower/guarantor tags",
        issueDescription:
          "**Multiple possible matches** — review normalization and merge keys before concluding identity.",
      });
    }
  }

  return dedupeSuggestedIssues(out);
}

function roleLabel(role: string) {
  return role.replace(/_/g, " ");
}

const notListedEx21Short = "not listed in Exhibit 21";

function labelingOnlyDesc(kind: string) {
  return `Consolidation suggests a candidate entity (${kind}), **${notListedEx21Short}** — **needs confirmation.**`;
}

function manualReviewDesc(lane: string, inCd: boolean, collat: boolean) {
  let t = `${lane}: flagged **${notListedEx21Short}** (**requires follow-up**).`;
  if (inCd) t += " Appears linked to credit-document capture.";
  if (collat) t += " Collateral excerpt suggests prioritizing substantive review.";
  return t;
}

function nameFamilyFollowUpDesc() {
  return "Name-root lead only — corroborate with credit documents, UCC, addresses, officers, or registry excerpts (**needs confirmation**).";
}

function needsConfirmationPhrase() {
  return "Limited independent corroboration in captured exhibits — proceed with incremental confirmation.";
}

function looksFinanceVehicle(name: string) {
  return /\b(funding|finance|receivables|\btrust\b|\babs\b|\bspe\b|\bspv\b|capital|leasing|holdings)\b/i.test(name);
}

function looksIp(role: unknown, name: string) {
  const n = /\b(ip|intellectual\s+property|patent)\b/i.test(name);
  return String(role).includes("ip") || n;
}

function looksRe(name: string, role: unknown) {
  return /\b(real\s+estate|properties?\b|prop\.?\s*llc|r\.e\.?\b)/i.test(name) || String(role).includes("real_estate");
}

function dedupeSuggestedIssues(rows: GeneratedUniverseIssue[]): GeneratedUniverseIssue[] {
  const m = new Map<string, GeneratedUniverseIssue>();
  for (const r of rows) {
    const key = `${r.issueType}|${r.relatedEntityName}|${r.issueTitle}`;
    if (!m.has(key)) m.set(key, r);
  }
  return [...m.values()];
}
