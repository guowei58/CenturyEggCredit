import type { CreditDocWorkflowIssueSeverity } from "@/generated/prisma/client";
import type { RoleFlagTriState } from "./matrixRoleKeys";

/** Minimal shape from an in-memory matrix row or a persisted matrix DB row. */
export type WorkflowMatrixIssueInput = {
  entityName: string;
  reconciliationFlagsJson: Record<string, boolean>;
  roleFlagsJson: Record<string, RoleFlagTriState | string>;
  keyEvidence?: string | null;
};

export type DraftWorkflowIssue = {
  issueType: string;
  issueTitle: string;
  issueDescription: string;
  entityName: string | null;
  severity: CreditDocWorkflowIssueSeverity;
  excerpt: string | null;
  suggestedFollowUp: string | null;
};

export function generateCreditDocEntityIssues(matrixRows: WorkflowMatrixIssueInput[]): DraftWorkflowIssue[] {
  const out: DraftWorkflowIssue[] = [];
  for (const r of matrixRows) {
    const rec = r.reconciliationFlagsJson ?? {};
    if (rec.borrower_not_in_exhibit_21) {
      out.push({
        issueType: "borrower_not_in_exhibit_21",
        issueTitle: "Borrower not on Exhibit 21",
        issueDescription: `Credit documents name ${r.entityName} as borrower but it is not found on the saved Exhibit 21 subsidiary list.`,
        entityName: r.entityName,
        severity: "high",
        excerpt: r.keyEvidence ?? null,
        suggestedFollowUp:
          "Confirm whether the subsidiary is omitted as immaterial, formed post-filing, or disclosed elsewhere.",
      });
    }
    if (rec.guarantor_not_in_exhibit_21) {
      out.push({
        issueType: "guarantor_not_in_exhibit_21",
        issueTitle: "Guarantor not on Exhibit 21",
        issueDescription: `Guarantor ${r.entityName} appears in credit documents but not on Exhibit 21.`,
        entityName: r.entityName,
        severity: "high",
        excerpt: r.keyEvidence ?? null,
        suggestedFollowUp: "Review guarantee structure, joint-and-several language, and immaterial subsidiary definitions.",
      });
    }
    const nf = r.roleFlagsJson?.needsFollowUp;
    if (nf === "needs_review" || nf === "true") {
      out.push({
        issueType: "entity_role_unclear",
        issueTitle: "Entity needs follow-up",
        issueDescription: `Low or conflicting evidence for ${r.entityName} — confirm party role and materiality.`,
        entityName: r.entityName,
        severity: "medium",
        excerpt: r.keyEvidence ?? null,
        suggestedFollowUp: "Open evidence cells in the matrix and validate against the base agreement.",
      });
    }
  }
  return out;
}
