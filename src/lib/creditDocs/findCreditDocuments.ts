import type { CreditDocSourceDocumentType } from "@/generated/prisma/client";
import type { CreditDocSourceFilingKind } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { listCreditAgreementsFiles } from "@/lib/credit-agreements-files";

const TITLE_KEYWORDS: { kw: RegExp; type: CreditDocSourceDocumentType }[] = [
  { kw: /\bamended\s+and\s+restated.*credit\b/i, type: "amended_and_restated_credit_agreement" },
  { kw: /\bamended\s+and\s+restated.*facility\b/i, type: "amended_and_restated_credit_agreement" },
  { kw: /\bsupplemental\s+indenture\b/i, type: "supplemental_indenture" },
  { kw: /\babs\s+indenture\b|\basset[\s-]backed\s+indenture\b/i, type: "abs_indenture" },
  { kw: /\btrust\s+indenture\b|\bindenture\s+trustee\b/i, type: "indenture" },
  { kw: /\b(convertible|subordinated)\s+notes?\b|\bsenior\s+(secured\s+)?notes?\b/i, type: "indenture" },
  { kw: /\bdebentures?\b/i, type: "indenture" },
  { kw: /\bindenture\b/i, type: "indenture" },
  { kw: /\bcredit\s+agreement\b|\bcredit\s+facility\b|\bfacility\s+agreement\b/i, type: "credit_agreement" },
  { kw: /\b(term|revolving|ABL|asset[\s-]based).*credit\b/i, type: "credit_agreement" },
  { kw: /\brevolving\s+(credit\s+)?facility\b|\bterm\s+loan\s+facility\b|\bbridge\s+loan\b/i, type: "credit_agreement" },
  { kw: /\bcommitment\s+letter\b|\bfee\s+letter\b|\bengagement\s+letter\b.*\b(lender|bank|agent)\b/i, type: "credit_agreement" },
  { kw: /\bloan\s+agreement\b|\blending\s+agreement\b/i, type: "loan_agreement" },
  { kw: /\b(term\s+)?loan\s+facility\b/i, type: "loan_agreement" },
  { kw: /\bguaranty\b|\bguarantee\b/i, type: "guarantee_agreement" },
  { kw: /\bsecurity\s+agreement\b/i, type: "security_agreement" },
  { kw: /\bpledge\b/i, type: "pledge_agreement" },
  { kw: /\bcollateral\s+trust\s+agreement\b/i, type: "collateral_trust_agreement" },
  { kw: /\bcollateral\s+agreement\b|\bcollateral\s+trust\b/i, type: "collateral_agreement" },
  { kw: /\bintercreditor\b/i, type: "intercreditor_agreement" },
  { kw: /\breceivables\s+(purchase|sale|transfer)\b/i, type: "receivables_agreement" },
  { kw: /\bsecuritization\b|\bmaster\s+trust\b/i, type: "securitization_agreement" },
  { kw: /\bexchange\s+agreement\b|\bdebt\s+exchange\b/i, type: "exchange_agreement" },
  { kw: /\bmortgage\b/i, type: "mortgage" },
  { kw: /\bdeed\s+of\s+trust\b/i, type: "deed_of_trust" },
  { kw: /\bjoinder\b/i, type: "joinder_agreement" },
  { kw: /\bamendment\b/i, type: "amendment" },
  { kw: /\bwaiver\b/i, type: "waiver" },
  { kw: /\bconsent\b/i, type: "consent" },
  { kw: /\brestructuring\s+support\b|\bRSA\b/i, type: "restructuring_support_agreement" },
  { kw: /\bplan\s+of\s+reorganization\b|\bchapter\s+11\s+plan\b/i, type: "plan_of_reorganization" },
  { kw: /\bdisclosure\s+statement\b/i, type: "disclosure_statement" },
  { kw: /exhibit[^\n]{0,120}(credit|loan|lender|indenture|guarantee|guaranty|pledge|collateral|debenture|notes?\s+)/i, type: "credit_agreement" },
  { kw: /\bSEC[-_][^\s]{0,80}(credit|indenture|loan|guarantee|guaranty|ABL|facility)\b/i, type: "credit_agreement" },
];

export function inferCreditDocumentTitleType(title: string): CreditDocSourceDocumentType {
  const t = title.trim();
  for (const { kw, type } of TITLE_KEYWORDS) if (kw.test(t)) return type;
  return "other";
}

function inferSavedFilingKind(url: string): CreditDocSourceFilingKind {
  void url;
  return "saved_document";
}

export type FinderCandidate = {
  documentTitle: string;
  documentType: CreditDocSourceDocumentType;
  filingType: CreditDocSourceFilingKind;
  sourceUrl: string | null;
  savedDocumentRefId: string | null;
  extractedTextDigest: string | null;
  /** Relative URL to open the stored file (same-origin). */
  openUrl: string | null;
  /** Present for SEC EDGAR rows (YYYY-MM-DD). */
  filingDate?: string | null;
};

function tickerSeg(ticker: string): string {
  return encodeURIComponent(ticker.trim().toUpperCase());
}

function isCreditFinderRow(c: FinderCandidate): boolean {
  if (c.savedDocumentRefId?.startsWith("credit_workspace:")) return true;
  return c.documentType !== "other";
}

export async function findCreditDocumentsInDb(
  db: Pick<PrismaClient, "userSavedDocument" | "publicRecordsDocument">,
  opts: { userId: string; ticker: string }
): Promise<FinderCandidate[]> {
  const { userId, ticker } = opts;
  const tk = tickerSeg(ticker);
  const [saved, pr, creditFiles] = await Promise.all([
    db.userSavedDocument.findMany({ where: { userId, ticker } }),
    db.publicRecordsDocument.findMany({ where: { userId, ticker } }),
    listCreditAgreementsFiles(userId, ticker),
  ]);
  const out: FinderCandidate[] = [];
  for (const d of saved) {
    const title = d.title?.trim() || d.filename;
    const type = inferCreditDocumentTitleType(title);
    out.push({
      documentTitle: title,
      documentType: type,
      filingType: inferSavedFilingKind(d.originalUrl),
      sourceUrl: d.originalUrl,
      savedDocumentRefId: `user_saved:${d.id}`,
      extractedTextDigest: null,
      openUrl: `/api/saved-documents/${tk}?file=${encodeURIComponent(d.filename)}`,
    });
  }
  for (const d of pr) {
    const title = d.filename?.trim() || "Public Records document";
    const type = inferCreditDocumentTitleType(title);
    out.push({
      documentTitle: title,
      documentType: type,
      filingType: "saved_document",
      sourceUrl: null,
      savedDocumentRefId: `public_records:${d.id}`,
      extractedTextDigest:
        typeof d.extractedText === "string" && d.extractedText.length > 0
          ? `len:${Math.min(d.extractedText.length, 100_000)}`
          : null,
      openUrl: `/api/companies/${tk}/public-records/documents/${encodeURIComponent(d.id)}`,
    });
  }
  if (creditFiles) {
    for (const it of creditFiles) {
      const title = (it.originalName || "").trim() || it.filename;
      let type = inferCreditDocumentTitleType(title);
      if (type === "other") type = "credit_agreement";
      out.push({
        documentTitle: title,
        documentType: type,
        filingType: "uploaded_document",
        sourceUrl: null,
        savedDocumentRefId: `credit_workspace:${it.filename}`,
        extractedTextDigest: null,
        openUrl: `/api/credit-agreements-files/${tk}?file=${encodeURIComponent(it.filename)}&inline=1`,
      });
    }
  }

  const narrowed = out.filter(isCreditFinderRow);
  const seen = new Set<string>();
  return narrowed.filter((c) => {
    const k = c.savedDocumentRefId ?? c.documentTitle.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
