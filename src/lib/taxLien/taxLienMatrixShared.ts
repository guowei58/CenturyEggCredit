/**
 * Client-safe tax lien matrix helpers (no node:fs).
 * Server-side XLSX loading lives in taxLienSourceMatrix.ts.
 */

/** Four-step tax lien search workflow (from `data/taxlien_matrix_steps.xlsx` / committed JSON). */
export type TaxLienSearchStep = {
  step: 1 | 2 | 3 | 4;
  label: string;
  hint: string;
  url: string;
};

export type TaxLienSourceMatrixRow = {
  state: string;
  abbr: string;
  stateTaxLienRoute: string;
  federalTaxLienRoute: string;
  stateTaxLienOrCollectionsUrl: string;
  statewideSearchUrl: string;
  countyClerkRecorderDirectoryUrl: string;
  uccOrRelatedLienUrl: string;
  automationBucket: string;
  implementationNotes: string;
  /** Parsed from steps workbook; optional supplemental links (e.g. county recorders). */
  searchSteps?: TaxLienSearchStep[];
  supplementalUrls?: string[];
};

function matrixText(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** Used when parsing spreadsheet rows on the server. */
export function taxLienMatrixString(v: unknown): string {
  return matrixText(v);
}

export type TaxLienTripleLinkSlot = { label: string; url: string };

export function taxLienMatrixTripleLinkSlots(row: TaxLienSourceMatrixRow | null | undefined): TaxLienTripleLinkSlot[] {
  if (!row) {
    return [
      { label: "State tax lien / collections", url: "" },
      { label: "Statewide search", url: "" },
      { label: "County clerk / recorder directory", url: "" },
    ];
  }
  return [
    { label: "State tax lien / collections", url: matrixText(row.stateTaxLienOrCollectionsUrl) },
    { label: "Statewide search", url: matrixText(row.statewideSearchUrl) },
    { label: "County clerk / recorder directory", url: matrixText(row.countyClerkRecorderDirectoryUrl) },
  ];
}

/** Official UCC (or SOS UCC-adjacent) URL from matrix when present; otherwise callers should use registry fallback. */
export function matrixUccSearchUrl(row: TaxLienSourceMatrixRow | null | undefined): string | null {
  const u = matrixText(row?.uccOrRelatedLienUrl ?? "");
  return u.startsWith("http") ? u : null;
}
