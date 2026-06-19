import type { CreditDocSavedBoxKey } from "@/lib/credit-doc-save-targets";
import { parseCreditDocListRows, type CreditDocListRow } from "@/lib/extract-credit-doc-save-label";

export type BulkCreditDocCategory = CreditDocSavedBoxKey;

export const BULK_CREDIT_DOC_CATEGORY_STEPS: ReadonlyArray<{
  category: BulkCreditDocCategory;
  label: string;
  analyzeFromListLabel: string;
}> = [
  {
    category: "credit-agreements-indentures-credit-agreement",
    label: "Credit Agreement",
    analyzeFromListLabel: "credit agreement",
  },
  {
    category: "credit-agreements-indentures-first-lien-indenture",
    label: "First Lien Notes",
    analyzeFromListLabel: "first lien notes",
  },
  {
    category: "credit-agreements-indentures-second-lien-indenture",
    label: "2nd Lien Notes",
    analyzeFromListLabel: "2nd lien notes",
  },
  {
    category: "credit-agreements-indentures-unsecured",
    label: "Unsecured Notes",
    analyzeFromListLabel: "unsecured notes",
  },
  {
    category: "credit-agreements-indentures-other-credit-documents",
    label: "Other Credit Documents",
    analyzeFromListLabel: "other credit documents",
  },
];

function hay(row: CreditDocListRow): string {
  return [row.securityFacility, row.documentType, row.documentTitle, row.label]
    .join(" ")
    .toLowerCase();
}

function parseFilingDateMs(raw: string): number {
  const t = raw.trim();
  if (!t) return 0;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

/** Score how well a list row matches a credit-doc workspace category (higher = better). */
export function scoreCreditDocRowForCategory(row: CreditDocListRow, category: BulkCreditDocCategory): number {
  const h = hay(row);
  if (!row.url.trim()) return -1;

  const isIndenture = /\bindenture\b/.test(h);
  const isCreditAgreement =
    /\bcredit agreement\b/.test(h) ||
    /\bloan agreement\b/.test(h) ||
    /\bterm loan\b/.test(h) ||
    /\brevolv/.test(h) ||
    /\babl\b/.test(h) ||
    /\brevolving credit\b/.test(h);
  const isNote = /\bnotes?\b/.test(h) || /\bbond\b/.test(h) || isIndenture;
  const firstLien =
    /\bfirst lien\b/.test(h) ||
    /\b1st lien\b/.test(h) ||
    /\bsenior secured notes?\b/.test(h) ||
    /\bsr\.?\s*secured\b/.test(h) ||
    /\bsenior secured indenture\b/.test(h);
  const secondLien =
    /\bsecond lien\b/.test(h) ||
    /\b2nd lien\b/.test(h) ||
    /\bjunior lien\b/.test(h) ||
    /\bjunior secured\b/.test(h) ||
    /\bsubordinated notes?\b/.test(h);
  const seniorSecuredOnly =
    (/\bsenior secured\b/.test(h) || (/\bsecured\b/.test(h) && isNote)) && !secondLien && !/\bunsecured\b/.test(h);
  const unsecured =
    /\bunsecured\b/.test(h) ||
    (/\bsenior notes\b/.test(h) && !firstLien && !secondLien && !seniorSecuredOnly);
  const otherDoc =
    /\bintercreditor\b/.test(h) ||
    /\bguarantee\b/.test(h) ||
    /\bcollateral\b/.test(h) ||
    /\bsecurity agreement\b/.test(h) ||
    /\bpledge\b/.test(h) ||
    /\bjoinder\b/.test(h) ||
    /\bsupplemental\b/.test(h) ||
    /\bamendment\b/.test(h) ||
    /\bwaiver\b/.test(h) ||
    /\bexchange offer\b/.test(h);

  switch (category) {
    case "credit-agreements-indentures-credit-agreement":
      if (isCreditAgreement && !isIndenture) return 100;
      if (isCreditAgreement) return 80;
      if (/\bcredit\b/.test(h) && /\bagreement\b/.test(h)) return 60;
      return -1;
    case "credit-agreements-indentures-first-lien-indenture":
      if (firstLien && isNote) return 100;
      if (firstLien && isIndenture) return 90;
      if (seniorSecuredOnly && isNote) return 88;
      if (seniorSecuredOnly && isIndenture) return 82;
      if (firstLien) return 70;
      if (seniorSecuredOnly) return 68;
      return -1;
    case "credit-agreements-indentures-second-lien-indenture":
      if (secondLien && isNote) return 100;
      if (secondLien && isIndenture) return 90;
      if (secondLien) return 70;
      if (/\bsubordinated\b/.test(h) && isNote) return 75;
      return -1;
    case "credit-agreements-indentures-unsecured":
      if (unsecured && isNote) return 100;
      if (unsecured && isIndenture) return 85;
      if (isIndenture && !firstLien && !secondLien && /\bsenior\b/.test(h)) return 65;
      return -1;
    case "credit-agreements-indentures-other-credit-documents":
      if (otherDoc) return 80;
      if (!isCreditAgreement && !isNote && !isIndenture) return 30;
      return -1;
    default:
      return -1;
  }
}

const MIN_MATCH_SCORE = 55;

/** Best matching document URL for a category, or null if none qualifies. */
export function pickCreditDocUrlForCategory(
  listContent: string,
  category: BulkCreditDocCategory
): { url: string; row: CreditDocListRow; score: number } | null {
  const rows = parseCreditDocListRows(listContent);
  let best: { url: string; row: CreditDocListRow; score: number; dateMs: number } | null = null;

  for (const row of rows) {
    const score = scoreCreditDocRowForCategory(row, category);
    if (score < MIN_MATCH_SCORE) continue;
    const url = row.url.trim();
    if (!url.startsWith("http")) continue;
    const dateMs = parseFilingDateMs(row.filingDate);
    if (
      !best ||
      score > best.score ||
      (score === best.score && dateMs > best.dateMs)
    ) {
      best = { url, row, score, dateMs };
    }
  }

  return best ? { url: best.url, row: best.row, score: best.score } : null;
}
