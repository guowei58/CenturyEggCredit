import {
  confidenceDefinedTermBlock,
  confidenceKeywordInference,
  confidencePartyBlockLine,
  clampConfidence,
} from "@/lib/debt-map/confidence";
import { normalizeEntityNameForMatch } from "@/lib/debt-map/normalizeEntityName";
import type { DebtInstrumentEntityRoleKind, DebtLegalEntityKind } from "@/generated/prisma/client";

export type ExtractedEntityHint = {
  legalName: string;
  normalizedName: string;
  /** Broad bucket for the legal-entity table; roles on instruments are more specific. */
  entityType: DebtLegalEntityKind;
  role: DebtInstrumentEntityRoleKind;
  sourceSnippet: string;
  confidenceScore: number;
};

const LINE_LABEL =
  /^(issuer|issuers|company|borrower|borrowers|parent|guarantor|guarantors|co-issuer|co-issuers)\s*[:：]\s*(.+)$/i;

function roleFromLabel(label: string): DebtInstrumentEntityRoleKind | null {
  const u = label.toLowerCase();
  if (u.startsWith("co-issuer")) return "co_issuer";
  if (u.startsWith("issuer")) return "issuer";
  if (u.startsWith("borrower")) return "borrower";
  if (u.startsWith("company")) return "borrower";
  if (u.startsWith("parent")) return "parent_guarantor";
  if (u.startsWith("guarantor")) return "subsidiary_guarantor";
  return null;
}

function entityKindFromRole(r: DebtInstrumentEntityRoleKind): DebtLegalEntityKind {
  switch (r) {
    case "issuer":
    case "co_issuer":
      return "issuer";
    case "borrower":
      return "borrower";
    case "parent_guarantor":
      return "guarantor";
    case "subsidiary_guarantor":
      return "guarantor";
    default:
      return "unknown";
  }
}

function cleanEntityName(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim().replace(/^["“]+|["”]+$/g, "");
  if (t.length < 3 || t.length > 280) return null;
  if (/xxxx|redacted|\[.*\]/.test(t.toLowerCase())) return null;
  return t;
}

/**
 * Deterministic extraction of party-line labels and "means" definitions (conservative).
 */
export function extractEntityHintsFromText(text: string, maxHints = 80): ExtractedEntityHint[] {
  const partySlice = text.slice(0, 5000);
  const lines = partySlice.split(/\n+/);
  const out: ExtractedEntityHint[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const m = line.trim().match(LINE_LABEL);
    if (!m) continue;
    const role = roleFromLabel(m[1]);
    const name = cleanEntityName(m[2] ?? "");
    if (!role || !name) continue;
    const key = `${role}::${normalizeEntityNameForMatch(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      legalName: name,
      normalizedName: normalizeEntityNameForMatch(name),
      entityType: entityKindFromRole(role),
      role,
      sourceSnippet: line.trim().slice(0, 420),
      confidenceScore: clampConfidence(confidencePartyBlockLine()),
    });
    if (out.length >= maxHints) return out;
  }

  let dm: RegExpExecArray | null;
  const defText = text.slice(0, 25_000);
  const defRe =
    /\b(Issuer|Issuers|Borrower|Borrowers|Company|Parent|Guarantors?)\s+means\s+["“']([^"”']{4,240})["”']/gi;
  while ((dm = defRe.exec(defText)) !== null) {
    const label = dm[1] ?? "";
    const name = cleanEntityName(dm[2] ?? "");
    const role = roleFromLabel(label);
    if (!role || !name) continue;
    const key = `def-${role}::${normalizeEntityNameForMatch(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      legalName: name,
      normalizedName: normalizeEntityNameForMatch(name),
      entityType: entityKindFromRole(role),
      role,
      sourceSnippet: dm[0].trim().slice(0, 420),
      confidenceScore: clampConfidence(confidenceDefinedTermBlock()),
    });
    if (out.length >= maxHints) break;
  }

  return out;
}

/** Keyword-only candidates (low confidence, marked in notes by caller). */
export function extractFinanceSubsidiaryCandidates(text: string): string[] {
  const lines = text.slice(0, 20_000).split(/\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/\b(Funding|Finance|Receivables|Securitization)\b.*\b(LLC|L\.L\.C\.|Inc\.?|Corp\.?|LP|L\.P\.)\b/i.test(line)) {
      const t = line.replace(/^[^A-Za-z0-9(]+/, "").replace(/\s+/g, " ").trim();
      if (t.length > 8 && t.length < 220) out.push(t);
    }
  }
  return [...new Set(out)].slice(0, 20);
}

export function extractLowConfidenceFromKeywords(text: string): ExtractedEntityHint[] {
  const low = extractFinanceSubsidiaryCandidates(text);
  return low.map((legalName) => ({
    legalName,
    normalizedName: normalizeEntityNameForMatch(legalName),
    entityType: "finance_subsidiary" as const,
    role: "borrower" as const,
    sourceSnippet: "(keyword heuristic — verify in source)",
    confidenceScore: clampConfidence(confidenceKeywordInference()),
  }));
}
