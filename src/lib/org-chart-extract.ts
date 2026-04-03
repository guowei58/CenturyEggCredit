/**
 * Reusable extraction of credit-focused entity structure from 10-K/10-Q text.
 * Ticker-agnostic; no hardcoded company names or structure.
 */

import type { OrgChartData, OrgChartEntity } from "./org-chart-types";

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/** Extract entity names from lines that look like "Entity Name, LLC" or "Entity Name Inc." */
function extractSubsidiaryLikeNames(text: string, maxNames = 30): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const regex = /([A-Z][A-Za-z0-9\s,&.-]+(?:,\s*LLC|,\s*L\.?P\.?|,\s*Inc\.?|,\s*Corp\.?|,\s*Ltd\.?|,\s*Co\.?|,\s*N\.?A\.?|,\s*S\.?A\.?| LLC| L\.?P\.?| Inc\.?| Corp\.?| Ltd\.?| Co\.?| N\.?A\.?| S\.?A\.?)\s*)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const name = m[1].trim();
    if (name.length >= 4 && name.length <= 120 && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names.slice(0, maxNames);
}

/** USPTO / search hints: see `subsidiary-name-hints.ts` (Exhibit 21–only; no whole-filing regex). */
export { extractSubsidiaryNameHintsFromFilingText } from "./subsidiary-name-hints";

/** Detect if text mentions guarantors, issuers, borrowers, restricted/unrestricted. */
function detectDisclosureFlags(text: string) {
  const lower = text.toLowerCase();
  return {
    hasGuarantor: /\bguarantor(s)?\b/.test(lower) || /\bguarantee(s)?\b/.test(lower),
    hasIssuer: /\bissuer(s)?\b/.test(lower),
    hasBorrower: /\bborrower(s)?\b/.test(lower) || /\bcredit facility\b/.test(lower) || /\bterm loan\b/.test(lower),
    hasRestricted: /\brestricted\s+subsidiar(y|ies)\b/.test(lower),
    hasUnrestricted: /\bunrestricted\s+subsidiar(y|ies)\b/.test(lower),
    hasExhibit21: /\bexhibit\s*21\b/.test(lower) || /\bsubsidiaries\s+of\s+(the\s+)?registrant\b/.test(lower),
  };
}

/** Build a simple id from entity name for React keys. */
function toId(name: string, prefix: string): string {
  return prefix + "-" + name.replace(/[^a-z0-9]/gi, "-").slice(0, 40);
}

/**
 * Extract org chart structure from 10-K or 10-Q raw text.
 * Returns null if text is empty or clearly not a filing; otherwise returns
 * at least a parent node and structural notes (may be partial).
 */
export function extractOrgChartFromFilingText(
  companyName: string,
  ticker: string,
  rawText: string
): OrgChartData | null {
  const text = rawText.includes("<") ? stripHtmlToText(rawText) : rawText;
  if (!text || text.length < 500) return null;

  const flags = detectDisclosureFlags(text);
  const subsidiaryCandidates = extractSubsidiaryLikeNames(text);

  const root: OrgChartEntity = {
    id: toId(companyName, "root"),
    name: companyName,
    roles: ["parent"],
    confidence: "confirmed",
    children: [],
  };

  const structuralNotes: string[] = [];
  let partial = false;

  if (flags.hasIssuer || flags.hasBorrower) {
    root.roles.push("issuer", "borrower");
    root.debtInstrument = "See 10-K/10-Q for debt and credit facility disclosure.";
    structuralNotes.push(
      "Filing references issuer(s) and/or borrower(s). Parent is typically the issuer/borrower unless disclosure specifies otherwise; confirm with indenture or credit agreement."
    );
  }

  if (flags.hasGuarantor) {
    structuralNotes.push(
      "Filing references guarantors. Guarantor identities and scope typically disclosed in condensed consolidating financials or in the notes; confirm with credit agreement."
    );
  }

  if (flags.hasRestricted) {
    structuralNotes.push("Filing references restricted subsidiaries. Structure may include a restricted group that guarantees debt.");
  }
  if (flags.hasUnrestricted) {
    root.children!.push({
      id: "bucket-unrestricted",
      name: "Other Unrestricted Subsidiaries",
      roles: ["unrestricted-subsidiary"],
      isBucket: true,
      confidence: "unclear",
    });
    structuralNotes.push("Filing references unrestricted subsidiaries; they are typically outside the guarantee group. Count and materiality need confirmation from debt documents.");
  }

  if (subsidiaryCandidates.length > 0 && subsidiaryCandidates.length <= 25) {
    const displayList = subsidiaryCandidates.slice(0, 12);
    root.children = root.children || [];
    for (const name of displayList) {
      root.children.push({
        id: toId(name, "sub"),
        name,
        roles: ["restricted-subsidiary", "operating-subsidiary"],
        confidence: "likely",
      });
    }
    if (subsidiaryCandidates.length > 12) {
      root.children.push({
        id: "bucket-other",
        name: `Other subsidiaries (${subsidiaryCandidates.length - 12} more in filing)`,
        roles: ["restricted-subsidiary"],
        isBucket: true,
        confidence: "unclear",
      });
    }
    structuralNotes.push(
      `Subsidiary names extracted from filing text (Exhibit 21 or similar). Role (guarantor vs non-guarantor) not determined from text; confirm with indenture or credit agreement.`
    );
    if (!flags.hasGuarantor && !flags.hasIssuer) partial = true;
  } else {
    if (flags.hasExhibit21) {
      root.children!.push({
        id: "bucket-subs",
        name: "Subsidiaries listed in Exhibit 21 (see 10-K)",
        roles: ["restricted-subsidiary"],
        isBucket: true,
        confidence: "unclear",
      });
      structuralNotes.push("Filing references Exhibit 21 (subsidiary list). Full list and guarantor status require review of the exhibit and debt documents.");
    } else {
      root.children!.push({
        id: "bucket-subs",
        name: "Subsidiaries (see 10-K / 10-Q for list)",
        roles: ["restricted-subsidiary"],
        isBucket: true,
        confidence: "unclear",
      });
      structuralNotes.push("Insufficient subsidiary list extracted from current text. Review 10-K Exhibit 21 and guarantor/issuer disclosure for full structure.");
    }
    partial = true;
  }

  structuralNotes.push(
    "This structure is inferred from filing text only. Confirm issuer, borrower, and guarantor definitions with the credit agreement and indentures."
  );

  const sourceNote =
    `Inferred from latest 10-K/10-Q filing text. ${partial ? "Only partial structure available from automated extraction. " : ""}Confirm with indenture, credit agreement, and Exhibit 21.`;

  return {
    ticker,
    companyName,
    sourceNote,
    root,
    structuralNotes,
    partial,
  };
}
