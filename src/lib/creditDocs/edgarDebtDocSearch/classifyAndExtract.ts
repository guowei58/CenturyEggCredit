import { normalizeDebtMatchText, textMatchesDebtKeywordBlob } from "@/lib/creditDocs/edgarDebtDocSearch/keywords";

/** Step 7 — Classify downloaded/heuristic exhibit text (analyst taxonomy). */
export function classifyExhibit(exhibitTitle: string, exhibitTextSample: string): string {
  const blob = normalizeDebtMatchText(`${exhibitTitle} ${exhibitTextSample.slice(0, 24_000)}`);

  if (/debtor\s*in\s*possession|dip\s+credit|dip\s+facility/.test(blob)) return "DIP Credit Agreement";
  if (/exit\s+(facility|financing)/.test(blob)) return "Exit Facility";
  if (/restructuring\s+support|plan\s+support|rsa\b|transaction\s+support/.test(blob)) return "Restructuring Support Agreement";
  if (/exchange\s+offer|exchange\s+agreement/.test(blob)) return "Exchange Agreement";
  if (/supplemental\s+indenture/.test(blob)) return "Supplemental Indenture";
  if (/\bindenture\b/.test(blob) && !/purchase/.test(blob)) return "Indenture";
  if (/form\s+of\s+note|global\s+note/.test(blob)) return "Notes / Form of Notes";
  if (/intercreditor|subordination\s+agreement/.test(blob)) return "Intercreditor Agreement";
  if (/pledge\s+and\s+security|security\s+agreement|pledge\s+agreement/.test(blob)) return "Security Agreement";
  if (/collateral\s+trust/.test(blob)) return "Collateral Trust Agreement";
  if (/collateral\s+agreement/.test(blob)) return "Collateral Agreement";
  if (/guarantee\s+agreement|guaranty\s+agreement|\bguarantee\b|\bguaranty\b/.test(blob)) return "Guarantee Agreement";
  if (/amended\s+and\s+restated.*credit|amended\s+and\s+restated.*facility/.test(blob)) return "Credit Agreement";
  if (/\bcredit\s+agreement\b|\bfacility\s+agreement\b/.test(blob)) return "Credit Agreement";
  if (/amendment\b/.test(blob) && /credit|facility|loan|indenture/.test(blob)) return "Credit Agreement Amendment";
  if (/\bwaiver\b|\bconsent\b|\bjoinder\b/.test(blob) && /credit|facility|lender|agent/.test(blob))
    return "Waiver / Consent";
  if (/term\s+loan|revolving\s+credit|abl\b|asset\s*based/.test(blob)) return "Credit Agreement";

  if (textMatchesDebtKeywordBlob(blob)) return "Other Debt-Related Document";
  return "Other Debt-Related Document";
}

export function extractEightKItems(html: string): string[] {
  const items = new Set<string>();
  const re = /\bItem\s+(\d+\.\d{2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) items.add(`Item ${m[1]}`);
  return [...items];
}

export function extractCreditParties(text: string): {
  borrowerIssuer?: string;
  guarantorsCreditParties?: string;
  agentTrustee?: string;
} {
  const t = text.slice(0, 35_000);
  const borrower =
    t.match(/\b(?:Borrower|Issuers?)[:\s]+([^\n,.]{4,160})/i)?.[1]?.trim() ??
    t.match(/\n\s*([A-Z][^\n]{3,80}?)\s*\(?[\"']?Borrower[\"']?\)?/i)?.[1]?.trim();

  const agent =
    t.match(/\b(?:Administrative\s+Agent|Collateral\s+Agent)[:\s]+([^\n,.]{4,120})/i)?.[1]?.trim() ??
    t.match(/\bTrustee[:\s]+([^\n,.]{4,120})/i)?.[1]?.trim();

  const guarantors = t.match(/\b(?:Guarantors?|Subsidiary\s+Guarantors?)[:\s]+([^\n]{10,280})/i)?.[1]?.trim();

  return {
    borrowerIssuer: borrower ?? undefined,
    guarantorsCreditParties: guarantors ?? undefined,
    agentTrustee: agent ?? undefined,
  };
}

export function extractDebtTerms(text: string): {
  principalAmount?: string;
  maturity?: string;
  securedUnsecured?: string;
  lienPriority?: string;
} {
  const t = text.slice(0, 40_000);
  const principal =
    t.match(/\$\s*[\d,]+(?:\.\d+)?\s*(?:million|billion|M|MM|B)?/i)?.[0]?.trim() ??
    t.match(/principal\s+(?:amount)?[^.\n]{0,40}\$?\s*[\d,]+/i)?.[0]?.trim();

  const maturity =
    t.match(/\b(?:Maturity|Maturity\s+Date)[^.\n]{0,60}\d{4}/i)?.[0]?.trim() ??
    t.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/)?.[0]?.trim();

  let securedUnsecured: string | undefined;
  if (/\bsecured\b/i.test(t) && !/\bunsecured\b/i.test(t.slice(0, 5000))) securedUnsecured = "Secured";
  else if (/\bunsecured\b/i.test(t)) securedUnsecured = "Unsecured";

  let lienPriority: string | undefined;
  if (/first\s+lien/i.test(t)) lienPriority = "First lien";
  else if (/second\s+lien/i.test(t)) lienPriority = "Second lien";
  else if (/junior|subordinated/i.test(t)) lienPriority = "Subordinated";

  return { principalAmount: principal, maturity, securedUnsecured, lienPriority };
}
