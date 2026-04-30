import type {
  CandidateAffiliateEntity,
  KnownEntityInput,
  VerifiedEntityRecord,
  EntityDiligenceIssueKind,
  EntityDiligenceSeverity,
  EntityConfidenceLevel,
} from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";

export type GeneratedIssueDraft = {
  issueType: EntityDiligenceIssueKind;
  issueTitle: string;
  issueDescription: string;
  relatedEntityName: string | null;
  relatedEntityId: string | null;
  relatedCandidateId: string | null;
  severity: EntityDiligenceSeverity;
  evidenceJson?: Record<string, unknown>;
  sourceUrl?: string | null;
  isSystemGenerated: true;
};

const INACTIVE: VerifiedEntityRecord["status"][] = [
  "dissolved",
  "forfeited",
  "withdrawn",
  "inactive",
  "cancelled",
  "revoked",
  "expired",
];

const CREDIT_ROLES = new Set<KnownEntityInput["entityRole"]>(["borrower", "guarantor", "issuer", "co_issuer", "collateral_owner"]);

export function normalizeKey(s: string) {
  return normalizeEntityName(s).normalized;
}

function inExhibit21Set(rows: KnownEntityInput[]) {
  const s = new Set<string>();
  for (const k of rows) {
    if (k.sourceType === "exhibit_21" || k.entityRole === "subsidiary" || k.entityRole === "material_subsidiary") {
      s.add(k.normalizedEntityName);
      s.add(normalizeKey(k.entityName));
    }
  }
  return s;
}

/**
 * Automated issue hypotheses — conservative wording; user may dismiss as not material.
 */
export function generateEntityDiligenceIssues(
  knownEntities: KnownEntityInput[],
  verified: VerifiedEntityRecord[],
  candidates: CandidateAffiliateEntity[],
): GeneratedIssueDraft[] {
  const issues: GeneratedIssueDraft[] = [];

  const exSet = inExhibit21Set(knownEntities);

  /** A — known entities without confirmed verification */
  for (const k of knownEntities) {
    const ok = verified.filter(
      (v) =>
        v.knownEntityInputId === k.id &&
        (v.verificationStatus === "verified_exact_match" || v.verificationStatus === "verified_probable_match"),
    );
    const badStatus = verified.filter((v) => v.knownEntityInputId === k.id && INACTIVE.includes(v.status));

    if (!ok.length) {
      const sev: EntityDiligenceSeverity =
        CREDIT_ROLES.has(k.entityRole) || k.sourceType === "credit_agreement" ? "high" : "medium";
      issues.push({
        issueType: "known_entity_not_verified",
        issueTitle: `Unverified entity — ${k.entityName}`,
        issueDescription:
          "Known entity from filings or input has no verified official record linked (exact or probable SOS match may be missing). Requires follow-up.",
        relatedEntityName: k.entityName,
        relatedEntityId: k.id,
        relatedCandidateId: null,
        severity: sev,
        evidenceJson: { knownEntityInputId: k.id },
        isSystemGenerated: true,
      });
    }

    if (badStatus.length) {
      const v = badStatus[0]!;
      const sev =
        CREDIT_ROLES.has(k.entityRole) &&
        ["dissolved", "forfeited", "revoked", "cancelled"].includes(v.status)
          ? ("critical" as const)
          : ("medium" as const);
      issues.push({
        issueType: v.status === "dissolved" ? "dissolved_entity" : v.status === "forfeited" ? "forfeited_entity" : "inactive_entity",
        issueTitle: `Inactive SOS status — ${k.entityName}`,
        issueDescription:
          `Official record shows "${v.status}" for an entity mapped to "${k.entityName}". Borrower/guarantor/issuer linkage may need confirmation with documents.`,
        relatedEntityName: k.entityName,
        relatedEntityId: k.id,
        relatedCandidateId: null,
        severity: sev,
        sourceUrl: v.sourceUrl ?? null,
        evidenceJson: { verifiedId: v.id, status: v.status },
        isSystemGenerated: true,
      });
    }

    /** B — Official name differs materially */
    const match = verified.find(
      (v) =>
        v.knownEntityInputId === k.id &&
        (v.verificationStatus === "verified_exact_match" || v.verificationStatus === "verified_probable_match"),
    );
    if (match) {
      const kn = normalizeKey(k.entityName);
      const vn = normalizeKey(match.officialEntityName);
      if (kn !== vn && kn.slice(0, 6) !== vn.slice(0, 6)) {
        issues.push({
          issueType: "official_name_mismatch",
          issueTitle: `Official-name mismatch candidate — ${k.entityName}`,
          issueDescription:
            `Filing/source name "${k.entityName}" differs from SOS official "${match.officialEntityName}". Requires confirmation.`,
          relatedEntityName: k.entityName,
          relatedEntityId: k.id,
          relatedCandidateId: null,
          severity: "medium",
          sourceUrl: match.sourceUrl ?? null,
          evidenceJson: { verifiedId: match.id },
          isSystemGenerated: true,
        });
      }
    }
  }

  /** E — Credit party possibly not Exhibit 21 */
  for (const k of knownEntities) {
    if (!CREDIT_ROLES.has(k.entityRole)) continue;
    if (exSet.has(k.normalizedEntityName)) continue;
    issues.push({
      issueType: "entity_in_credit_docs_not_in_exhibit_21",
      issueTitle: `Credit-party not listed in Exhibit 21 model — ${k.entityName}`,
      issueDescription:
        "Entity appears in modeled credit-capacity lists but does not align with Exhibit 21 subsidiary rows imported here. Exhibit 21 omissions may be permitted by materiality and disclosure practices; consider further documentary review.",
      relatedEntityName: k.entityName,
      relatedEntityId: k.id,
      relatedCandidateId: null,
      severity: "medium",
      isSystemGenerated: true,
    });
  }

  /** F/G — Candidate affiliates scoring high/medium and not Exhibit 21 */
  for (const c of candidates) {
    const exHit = exSet.has(c.normalizedCandidateEntityName);
    if (
      !exHit &&
      c.reviewStatus === "unreviewed" &&
      (c.confidence === "high" || c.confidence === "medium")
    ) {
      issues.push({
        issueType: "possible_unlisted_affiliate",
        issueTitle: `Possible affiliate not in Exhibit 21 — ${c.candidateEntityName}`,
        issueDescription:
          "Candidate affiliate scored medium/high under conservative signals. Listing not in Exhibit 21 is not automatically problematic; disclosure rules vary. Requires user review.",
        relatedEntityName: c.candidateEntityName,
        relatedEntityId: null,
        relatedCandidateId: c.id,
        severity: c.confidence === "high" ? "high" : "medium",
        evidenceJson: { affiliationScore: c.affiliationScore, discoveryMethod: c.discoveryMethod },
        sourceUrl: c.sourceUrl ?? null,
        isSystemGenerated: true,
      });
    }
  }

  /** Finance / SPV keyword pattern unexplained — link to subsidiaries that look like finance vehicles */
  for (const k of knownEntities) {
    const fn = /\bFinance\b|\bFunding\b|\bReceivables\b|\bTrust\b|\bSPE\b|\bSPV\b|\bCapital\b|\bLeasing\b/i;
    if (!fn.test(k.entityName)) continue;
    if (!verified.some((v) => v.knownEntityInputId === k.id)) {
      issues.push({
        issueType: "unexplained_finance_sub",
        issueTitle: `Finance / vehicle-style name needing SOS mapping — ${k.entityName}`,
        issueDescription:
          "Name suggests finance/receivables/trust/tranche vehicle styling. Verification may need official records and transactional documents—not a determination of omission.",
        relatedEntityName: k.entityName,
        relatedEntityId: k.id,
        relatedCandidateId: null,
        severity: "medium",
        isSystemGenerated: true,
      });
    }
  }

  /** Deduplicate by coarse key */
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.issueType}|${i.relatedEntityId ?? ""}|${i.relatedCandidateId ?? ""}|${i.issueTitle}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Map score confidence to issue severity helper */
export function severityForCandidateConfidence(c: EntityConfidenceLevel): EntityDiligenceSeverity {
  if (c === "high") return "high";
  if (c === "medium") return "medium";
  return "low";
}
