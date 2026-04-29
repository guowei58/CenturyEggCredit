/** Payload returned by GET …/public-records/profile/prefill-from-sec (merged into profile draft on the client). */
export type PublicRecordsSecPrefill = {
  companyName: string | null;
  legalNames: string[];
  formerNames: string[];
  subsidiaryNames: string[];
  issuerNames: string[];
  stateOfIncorporation: string | null;
  hqState: string | null;
  hqCity: string | null;
  hqCounty: string | null;
  principalExecutiveOfficeAddress: string | null;
  sources: string[];
  warnings: string[];
  filing: { form: string; filingDate: string; docUrl: string } | null;
};
