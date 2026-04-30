import type { CandidateDiscoveryMethod } from "@/generated/prisma/client";
import { normalizeAddress, normalizeEntityName } from "@/lib/entityNormalize";
import type { EntityIntelProfileInput } from "@/lib/generateEntitySearchTasks";

/** Draft rows for persistence — conservative hypotheses only (user review required). */

export type CandidateAffiliateDraft = {
  candidateEntityName: string;
  normalizedCandidateEntityName: string;
  discoveryMethod: CandidateDiscoveryMethod;
  reasonForFlag: string;
  evidenceJson: Record<string, unknown>;
  state: string;
  jurisdiction: string;
};

function uniqPush(arr: CandidateAffiliateDraft[], row: CandidateAffiliateDraft, cap: number) {
  if (arr.length >= cap) return;
  const key = `${row.normalizedCandidateEntityName}|${row.discoveryMethod}|${row.state}`;
  if (arr.some((r) => `${r.normalizedCandidateEntityName}|${r.discoveryMethod}|${r.state}` === key)) return;
  arr.push(row);
}

/** Keyword patterns suggesting finance vehicles / holdings (not conclusions). */
const PATTERN_TAGS: { re: RegExp; tag: string }[] = [
  { re: /\bFINANCE\b|\bFUNDING\b|\bCAPITAL\b|\bSPE\b|\bSPV\b/i, tag: "finance_or_vehicle_keyword_in_name_list" },
  { re: /\bRECEIVABLES\b|\bSECURITIZATION\b|\bMASTER\s+TRUST\b/i, tag: "receivables_or_trust_keyword" },
  { re: /\bIP\s+HOLDINGS?\b|\bINTELLECTUAL\s+PROPERTY\b/i, tag: "ip_holdings_keyword" },
  { re: /\bREAL\s+ESTATE\b|\bPROPERTY\b.*\bHOLDINGS?\b/i, tag: "real_estate_holdings_keyword" },
];

/** Name-family rooted on public company trimmed tokens. */
function rootTokens(company?: string | null): string[] {
  if (!company?.trim()) return [];
  const { root } = normalizeEntityName(company);
  return root.split(/\s+/).filter((t) => t.length >= 3).slice(0, 4);
}

/**
 * Produce candidate-affiliate drafts for searches & manual confirmation only.
 */
export function discoverCandidateAffiliateDrafts(inp: EntityIntelProfileInput, cap = 80): CandidateAffiliateDraft[] {
  const out: CandidateAffiliateDraft[] = [];
  const tokens = rootTokens(inp.companyName ?? inp.publicRegistrantName);

  /** A — name family hypothetical strings (not scraped) */
  for (const t of tokens) {
    uniqPush(
      out,
      {
        candidateEntityName: `${inp.companyName ?? t} ${t} SERVICES`,
        normalizedCandidateEntityName: normalizeEntityName(`${inp.companyName ?? t} ${t} SERVICES`).normalized,
        discoveryMethod: "name_similarity",
        reasonForFlag: "Hypothetical name-family variant derived from issuer root — requires confirmation in SOS.",
        evidenceJson: { token: t },
        state: "",
        jurisdiction: "",
      },
      cap,
    );
    uniqPush(
      out,
      {
        candidateEntityName: `${t} INTERMEDIATE HOLDINGS LLC`,
        normalizedCandidateEntityName: normalizeEntityName(`${t} INTERMEDIATE HOLDINGS LLC`).normalized,
        discoveryMethod: "name_similarity",
        reasonForFlag: "Intermediate-holding-style pattern aligned to root token — candidate affiliate requiring verification.",
        evidenceJson: { token: t, pattern: "intermediate_holdings" },
        state: "DE",
        jurisdiction: "",
      },
      cap,
    );
  }

  /** B — address cluster hints (manual SOS/officer linkage still required). */
  const addrLines = [inp.hqAddress, inp.principalExecutiveOfficeAddress, ...(inp.majorFacilityAddresses ?? [])].filter(
    Boolean,
  ) as string[];
  for (const addr of addrLines.slice(0, 6)) {
    const norm = normalizeAddress(addr).normalized;
    uniqPush(
      out,
      {
        candidateEntityName: `Entities sharing normalized address (${norm.slice(0, 48)}…)`,
        normalizedCandidateEntityName: normalizeEntityName(norm).normalized.slice(0, 120),
        discoveryMethod: "shared_address",
        reasonForFlag:
          "Possible shared-address cluster candidate — investigate via official officer/address disclosures; same address alone does not prove affiliation.",
        evidenceJson: { addressNormalized: norm, originalHint: addr },
        state: inferStateFromNormalizedAddress(norm),
        jurisdiction: "",
      },
      cap,
    );
  }

  /** D — lists from credit-style names */
  const creditish = [...(inp.borrowerNames ?? []), ...(inp.guarantorNames ?? []), ...(inp.issuerNames ?? [])];
  for (const n of creditish) {
    if (!n?.trim()) continue;
    uniqPush(
      out,
      {
        candidateEntityName: n,
        normalizedCandidateEntityName: normalizeEntityName(n).normalized,
        discoveryMethod: "credit_doc_reference",
        reasonForFlag: "Referenced in modeled credit-party list — verify in SOS and reconcile to Exhibit 21.",
        evidenceJson: {},
        state: "",
        jurisdiction: "",
      },
      cap,
    );
    for (const { re, tag } of PATTERN_TAGS) {
      if (!re.test(n)) continue;
      uniqPush(
        out,
        {
          candidateEntityName: n,
          normalizedCandidateEntityName: normalizeEntityName(n).normalized,
          discoveryMethod: "credit_doc_reference",
          reasonForFlag: `${tag}: pattern flagged for review—not a determination of affiliation.`,
          evidenceJson: { patternTag: tag },
          state: "",
          jurisdiction: "",
        },
        cap,
      );
    }
  }

  /** E — keyword pattern rows on Exhibit 21 / subsidiary names */
  for (const n of inp.subsidiaryNames ?? []) {
    if (!n?.trim()) continue;
    for (const { re, tag } of PATTERN_TAGS) {
      if (!re.test(n)) continue;
      uniqPush(
        out,
        {
          candidateEntityName: n,
          normalizedCandidateEntityName: normalizeEntityName(n).normalized,
          discoveryMethod: "sec_filing_reference",
          reasonForFlag: `${tag}: subsidiary list entry may warrant SOS follow-up.`,
          evidenceJson: { exhibit21Line: true, patternTag: tag },
          state: "",
          jurisdiction: "",
        },
        cap,
      );
    }
  }

  return out;
}

function inferStateFromNormalizedAddress(norm: string): string {
  const m = norm.match(/\b([A-Z]{2})\s+\d{5}\b$/);
  return m?.[1] ?? "";
}
