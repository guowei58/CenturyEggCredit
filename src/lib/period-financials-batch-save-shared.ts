import type { PeriodFinancialsFilingLabelRow } from "@/lib/period-financials-roic";

export const PERIOD_FINANCIALS_BATCH_QUARTER_COUNT = 8;
export const PERIOD_FINANCIALS_BATCH_STEPS_PER_PERIOD = 4;
export const PERIOD_FINANCIALS_BATCH_SEC_PACE_MS = 450;

export type PeriodFinancialsBatchSaveProgress = {
  done: number;
  total: number;
  label: string;
  detail: string;
};

export type PeriodFinancialsBatchSaveResult = {
  saved: number;
  skipped: number;
  failed: number;
  errors: string[];
};

export type PresentedFiling = PeriodFinancialsFilingLabelRow & {
  periodLabel: string;
  primaryDocument?: string;
  reportDate?: string | null;
};

export type IxbrlBatchJson = {
  ok?: boolean;
  error?: string;
  cik?: string;
  earningsPressRelease?: {
    exhibitClass?: string;
    source?: { primaryDocumentUrl?: string; documentRole?: string };
  };
  earningsSlideDeck?: { source?: { primaryDocumentUrl?: string } };
  ebitdaReconciliation?: {
    status?: string;
    supplementalSource?: { primaryDocumentUrl?: string };
    suggestedPressRelease?: { primaryDocumentUrl?: string };
  };
  selected?: {
    primaryDocument?: string;
    accessionNumber?: string;
    reportDate?: string;
    filingDate?: string;
  };
};

export function secPrimaryDocUrl(
  cik: string | undefined,
  accessionNumber: string | undefined,
  primaryDocument: string | undefined
): string | null {
  if (!cik?.trim() || !accessionNumber?.trim() || !primaryDocument?.trim()) return null;
  const cikNum = cik.replace(/^0+/, "") || cik;
  const acc = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${primaryDocument.trim()}`;
}

export function earningsReleaseUrl(ix: IxbrlBatchJson): string | null {
  const embedded = ix.earningsPressRelease?.source?.primaryDocumentUrl?.trim();
  if (embedded) return embedded;
  const er = ix.ebitdaReconciliation;
  if (!er) return null;
  const fromDetected = er.status === "tables" ? er.supplementalSource?.primaryDocumentUrl : null;
  const fromSuggestion = er.suggestedPressRelease?.primaryDocumentUrl ?? null;
  return (fromDetected ?? fromSuggestion)?.trim() || null;
}

export function managementPresentationUrl(ix: IxbrlBatchJson): string | null {
  const slide = ix.earningsSlideDeck?.source?.primaryDocumentUrl?.trim();
  if (slide) return slide;
  const pr = ix.earningsPressRelease;
  if (pr?.exhibitClass === "slide_deck" && pr.source?.primaryDocumentUrl?.trim()) {
    return pr.source.primaryDocumentUrl.trim();
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
