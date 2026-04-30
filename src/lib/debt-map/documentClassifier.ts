export type DocumentClassification =
  | "indenture"
  | "credit_agreement"
  | "security_or_guarantee"
  | "prospectus"
  | "exhibit_21"
  | "exhibit_22"
  | "periodic_filing"
  | "other";

export function classifyDebtDocumentText(
  fileName: string,
  text: string,
  filingForm: string
): DocumentClassification {
  const fn = fileName.toLowerCase();
  const head = text.slice(0, 12_000).toLowerCase();

  if (/ex[\-\s]?21|subsidiar/i.test(fn) || /\bsubsidiaries\s+of\s+the\s+registrant\b/i.test(head)) {
    return "exhibit_21";
  }
  if (/ex[\-\s]?22|guarantor/i.test(fn) && /guarantor/i.test(head)) {
    return "exhibit_22";
  }

  if (/\b424b|s-1|s-3|prospectus/i.test(filingForm.toLowerCase()) || fn.includes("prospectus") || fn.includes("424b")) {
    if (/\bsenior\s+notes\b|\bdebentures\b|\bindenture\b/i.test(head)) return "prospectus";
  }

  if (/\bcredit\s+agreement\b|\bloan\s+agreement\b|\brevolving\b.*\bcredit\b/i.test(head)) {
    return "credit_agreement";
  }
  if (/\bindenture\b|\bsupplemental\s+indenture\b|\bsenior\s+secured\s+notes\b|\bsenior\s+notes\b/i.test(head)) {
    return "indenture";
  }
  if (/\bguarantee\b|\bsecurity\s+agreement\b|\bpledge\s+agreement\b|\bcollateral\b/i.test(head)) {
    return "security_or_guarantee";
  }

  if (/^(10-k|10-q|20-f|6-k)$/i.test(filingForm.trim())) {
    return "periodic_filing";
  }

  return "other";
}
