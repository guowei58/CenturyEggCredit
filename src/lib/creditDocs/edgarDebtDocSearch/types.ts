/** SEC EDGAR debt-document search — structured outputs per analyst playbook. */

export type DebtDocStatus =
  | "Found"
  | "Missing"
  | "Incorporated by reference"
  | "Superseded"
  | "Possibly inactive"
  | "Needs review";

export type ConfidenceLevel = "High" | "Medium" | "Low";

/** Full source-backed table row (spec Step 10 / OUTPUT FORMAT). */
export interface DebtDocumentTableRow {
  status: DebtDocStatus;
  instrumentOrFacilityName: string;
  documentType: string;
  exhibitNumber: string;
  filingForm: string;
  filingDate: string;
  filingItemEightK: string | null;
  accessionNumber: string;
  directExhibitLink: string;
  filingLink: string;
  borrowerIssuer: string | null;
  guarantorsCreditParties: string | null;
  agentTrustee: string | null;
  principalAmount: string | null;
  maturity: string | null;
  securedUnsecured: string | null;
  lienPriority: string | null;
  amendmentSequence: string | null;
  baseDocumentLink: string | null;
  notesWhyRelevant: string;
  confidenceLevel: ConfidenceLevel;
  sourceSnippet: string;
}

export interface ExecutiveSummary {
  debtRelatedDocumentsFound: number;
  creditAgreementsFound: number;
  indenturesNoteDocumentsFound: number;
  amendmentsFound: number;
  materialMissingDocuments: string[];
}

export interface EdgarDebtDocSearchResult {
  identity: {
    cikPadded: string;
    cikNumeric: number;
    ticker: string | null;
    companyLegalName: string;
  };
  executiveSummary: ExecutiveSummary;
  /** Grouped map (spec section B). */
  debtDocumentMap: Record<string, DebtDocumentTableRow[]>;
  table: DebtDocumentTableRow[];
  missingChecklist: Array<{ instrumentOrDescription: string; reason: string }>;
  recommendedNextSearches: string[];
  rawAudit: {
    filingsConsidered: number;
    exhibitsIndexed: number;
    exhibitsDownloadedForClassification: number;
  };
}

export interface DebtDocSearchInputs {
  ticker?: string;
  companyName?: string;
  cik?: string;
  /** Prioritize last N years; older filings rank lower but remain discoverable when capacity allows. */
  lookbackYears?: number;
  /** Include DEF 14A when restructuring/M&A debt cues appear in filing description. */
  includeDef14a?: boolean;
  /** Max filings after relevance ranking (clamped 20–180). Default 75. */
  maxFilingsCap?: number;
  /** Max exhibits to download for text classification (clamped 12–72). Default 36. */
  maxDownloadClassify?: number;
}
