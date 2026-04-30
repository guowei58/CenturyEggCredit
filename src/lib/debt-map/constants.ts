/** SEC form types prioritized for debt / capital structure analysis. */
export const DEBT_PRIORITY_FORMS = new Set([
  "10-K",
  "10-Q",
  "8-K",
  "S-1",
  "S-3",
  "S-4",
  "424B2",
  "424B3",
  "424B5",
  "424B7",
  "424B9",
  "424B1",
  "DEF 14A",
  "6-K",
  "20-F",
  "FWP",
]);

/** Exhibit filename / description tokens that signal debt-related attachments. */
export const DEBT_EXHIBIT_KEYWORDS = [
  "indenture",
  "supplemental indenture",
  "notes",
  "credit agreement",
  "loan agreement",
  "guarantee",
  "security agreement",
  "collateral agreement",
  "pledge agreement",
  "intercreditor",
  "joinder",
  "accession",
  "amendment",
  "refinancing",
  "receivables",
  "securitization",
  "purchase agreement",
  "exchange agreement",
] as const;

export const DEBT_DOC_CONTENT_KEYWORDS = [
  "Indenture",
  "Supplemental Indenture",
  "Senior Notes",
  "Secured Notes",
  "Unsecured Notes",
  "Credit Agreement",
  "Term Loan",
  "Revolving Credit",
  "Borrower",
  "Issuer",
  "Co-Issuer",
  "Guarantor",
  "Collateral Agent",
  "Security Agreement",
  "Intercreditor",
  "Receivables",
  "Securitization",
  "SPV",
] as const;

export const MAX_RAW_TEXT_CHARS = 200_000;
export const MAX_PDF_PAGES_DEBT_MAP = 40;
export const SEC_REQUEST_GAP_MS = 130;
export const MAX_FILINGS_TO_SCAN = 120;
export const MAX_DEBT_DOCUMENTS_TO_DOWNLOAD = 32;
