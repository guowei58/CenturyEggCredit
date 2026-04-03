/**
 * Legacy types for the old presentations pipeline (website/IR discovery, PDF ranking).
 * The new Presentations tab uses Claude discovery and @/lib/presentations-types instead.
 */

export type ClaudeSelectionResult = {
  officialWebsite: string | null;
  investorRelationsPage: string | null;
  confidence: "high" | "medium" | "low";
  notes: string | null;
  candidateWebsites: string[];
};

export type PdfForRanking = {
  url: string;
  title: string;
  sourcePage?: string | null;
  date?: string | null;
};

export type RankedPdf = PdfForRanking & {
  classification: "Likely Presentation" | "Other PDF";
  rank: number;
};
