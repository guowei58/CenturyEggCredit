import type { Exhibit21GridSnapshotV1 } from "@/lib/exhibit21GridSnapshot";

/** Payload returned by GET …/public-records/profile/prefill-from-sec (merged into profile draft on the client). */
export type PublicRecordsSecPrefill = {
  companyName: string | null;
  legalNames: string[];
  formerNames: string[];
  subsidiaryNames: string[];
  subsidiaryDomiciles: string[];
  /** Full Exhibit 21 table as scraped when a standalone exhibit file is resolved. */
  subsidiaryExhibit21Snapshot: Exhibit21GridSnapshotV1 | null;
  issuerNames: string[];
  stateOfIncorporation: string | null;
  hqState: string | null;
  hqCity: string | null;
  hqCounty: string | null;
  principalExecutiveOfficeAddress: string | null;
  /** SEC submissions CIK — 10 digits */
  cik: string | null;
  /** From 10-K cover when scraped */
  irsEmployerIdentificationNumber: string | null;
  fiscalYearEnd: string | null;
  sources: string[];
  warnings: string[];
  filing: {
    form: string;
    filingDate: string;
    docUrl: string;
    exhibit21DocUrl?: string | null;
  } | null;
};
