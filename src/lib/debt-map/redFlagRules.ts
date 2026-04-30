import type { DebtMapRedFlagCategory, DebtMapRedFlagSeverity } from "@/generated/prisma/client";

export type RedFlagDraft = {
  severity: DebtMapRedFlagSeverity;
  category: DebtMapRedFlagCategory;
  title: string;
  description: string;
  manualFollowUp: string;
  relatedInstrumentId?: string | null;
  relatedEntityId?: string | null;
  sourceSnippet?: string | null;
};

export function buildRedFlagsMvp(input: {
  publicParentName: string | null;
  issuerNames: string[];
  instrumentsWithoutFootnote: string[];
  footnotesWithoutInstrument: number;
  hasSecuredWithoutGrantors: boolean;
  hasReceivablesLanguage: boolean;
  hasUnrestrictedLanguage: boolean;
  materialSubsNames: string[];
  guarantorNames: string[];
}): RedFlagDraft[] {
  const out: RedFlagDraft[] = [];

  for (const insId of input.instrumentsWithoutFootnote) {
    out.push({
      severity: "medium",
      category: "reconciliation_gap",
      title: "Debt exhibit without footnote match",
      description:
        "An extracted instrument from an SEC exhibit did not align with a parsed line in the latest periodic debt footnote (heuristic).",
      manualFollowUp: "Open the latest 10-K/10-Q debt footnote and tie out principal/maturity to this exhibit manually.",
      relatedInstrumentId: insId,
    });
  }

  if (input.footnotesWithoutInstrument > 0) {
    out.push({
      severity: "medium",
      category: "missing_document",
      title: "Footnote lines without a matched debt exhibit",
      description: `${input.footnotesWithoutInstrument} footnote row(s) lacked a confident match to downloaded indentures/credit agreements.`,
      manualFollowUp: "Locate supplemental indentures, joinders, or credit agreement amendments filed after the latest 10-Q.",
    });
  }

  if (input.publicParentName && input.issuerNames.length > 0) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const p = norm(input.publicParentName);
    const issuersDifferent = input.issuerNames.some((i) => i && norm(i) !== p && !norm(i).includes(p) && !p.includes(norm(i)));
    if (issuersDifferent) {
      out.push({
        severity: "high",
        category: "structural_subordination",
        title: "Issuers may sit below the listed parent",
        description:
          "Debt instruments name issuer entities that do not exactly match the SEC registrant name — common for holding-company structures.",
        manualFollowUp: "Trace equity ownership vs. debt obligors on org charts; confirm guarantees at each issuer/borrower level.",
      });
    }
  }

  if (input.hasSecuredWithoutGrantors) {
    out.push({
      severity: "high",
      category: "collateral_gap",
      title: "Secured language without extracted collateral grantors",
      description: "A document appears secured, but no collateral grantor / pledge schedule was extracted in this pass.",
      manualFollowUp: "Open security/pledge schedules and UCC search collateral agent vs. grantor names.",
    });
  }

  if (input.hasReceivablesLanguage) {
    out.push({
      severity: "medium",
      category: "receivables_or_spv",
      title: "Receivables / SPV language detected",
      description: "Text references receivables facilities, securitization, or special-purpose structures.",
      manualFollowUp: "Verify bankruptcy-remoteness and true-sale opinions for receivables SPVs outside the guarantor group.",
    });
  }

  if (input.hasUnrestrictedLanguage) {
    out.push({
      severity: "medium",
      category: "unrestricted_subsidiary",
      title: "Unrestricted subsidiary concepts referenced",
      description: "Documents mention unrestricted subsidiaries — assets may sit outside the collateral / guarantor perimeter.",
      manualFollowUp: "Compare unrestricted subsidiary list against EBITDA/contributed asset baskets in the credit agreement.",
    });
  }

  if (input.materialSubsNames.length > 0 && input.guarantorNames.length > 0) {
    const gSet = new Set(input.guarantorNames.map((g) => g.toLowerCase()));
    const missing = input.materialSubsNames.filter((m) => m && !gSet.has(m.toLowerCase()));
    if (missing.length > 0) {
      out.push({
        severity: "medium",
        category: "guarantor_gap",
        title: "Exhibit 21 names not obviously overlapping guarantor extraction",
        description:
          "Some subsidiary names from Exhibit 21-style schedules did not appear in guarantor-related extractions (do not assume guaranty status).",
        manualFollowUp: "Compare Exhibit 22 / supplemental indenture guarantor schedules against Exhibit 21 operating subsidiaries.",
      });
    }
  }

  return out;
}
