/** Entity Mapper v2 — Exhibit 21 × financing-document role matrices (structured snapshot). */

export type Exhibit21UniverseRow = {
  exhibit21LegalName: string;
  normalizedLegalName: string;
  jurisdiction: string;
  entityType: string;
  sourceFiling: string;
  sourceDate: string;
  sourceLink: string;
};

export type DebtInventoryItem = {
  documentName: string;
  documentType: string;
  facilityInstrumentFamily: string;
  filingForm: string;
  filingDate: string;
  accessionNumber: string;
  exhibitNumber: string;
  directExhibitLink: string;
  filingLink: string;
  documentDate: string;
  docCategory: string;
  baseAgreementRelatesTo: string;
  currentHistoricalUnclear: "Current" | "Historical" | "Unclear";
  confidence: string;
  notes: string;
};

/** Evidence backing ✅ or ? cells */
export type EntityMapperEvidence = {
  id: string;
  subsidiary_name: string;
  normalized_subsidiary_name: string;
  matched_document_entity_name: string;
  role: string;
  role_value: "Yes" | "No" | "Ambiguous" | "Expressly Excluded" | "Not Stated";
  facility_family: string;
  document_name: string;
  document_type: string;
  document_date: string;
  filing_date: string;
  accession_number: string;
  exhibit_number: string;
  direct_exhibit_url: string;
  section_reference: string;
  source_quote: string;
  confidence: "High" | "Medium" | "Low";
  status: "Current" | "Historical" | "Unclear";
  notes: string;
};

export type MatrixCellSymbol = "yes" | "dash" | "question" | "no";

export type MatrixCell = {
  symbol: MatrixCellSymbol;
  evidence_ids: string[];
};

export type FacilityFamilyMatrix = {
  familyId: string;
  familyLabel: string;
  /** Role column headers in display order */
  roleColumns: string[];
  /** Row key = exhibit21LegalName */
  rows: Record<
    string,
    {
      subsidiary_legal_name: string;
      normalized_name: string;
      jurisdiction: string;
      cells: Record<string, MatrixCell>;
      status_summary: string;
      source_evidence_count: number;
      notes: string;
    }
  >;
};

export type ConsolidatedRoleRow = {
  subsidiary_legal_name: string;
  normalized_name: string;
  has_any_current_financing_role: boolean;
  roles_summary: string;
  evidence_ids: string[];
  notes: string;
};

export type RoleChangeLogEntry = {
  date: string;
  document: string;
  entity: string;
  change: string;
  source_quote: string;
  confidence: string;
};

/** Entities named in financing sources that do not map to the saved Exhibit 21 universe (capital-structure diligence). */
export type SubsidiaryNotInExhibit21Row = {
  entity_name: string;
  normalized_name: string;
  role_or_context: string;
  source_document: string;
  filing_date: string;
  evidence_ids: string[];
  notes: string;
  detection: "model" | "evidence_extract";
  /** From model JSON when stated (forensic subsidiary methodology). */
  importance_flag?: string;
  likely_role?: string;
  parent_immediate_owner?: string;
  jurisdiction_hint?: string;
  source_citation_detail?: string;
};

/** Persisted JSON snapshot for GET / POST Entity Mapper v2 */
export type EntityMapperV2Snapshot = {
  version: 2;
  ticker: string;
  generatedAtIso: string;
  exhibit21Universe: Exhibit21UniverseRow[];
  debtInventory: DebtInventoryItem[];
  inventoryFamilies: string[];
  evidence: EntityMapperEvidence[];
  facilityMatrices: FacilityFamilyMatrix[];
  consolidated: ConsolidatedRoleRow[];
  roleChangeLog: RoleChangeLogEntry[];
  ambiguities: string[];
  llmNotes?: string;
  /** Populated on each successful run: names in debt/SEC sources not on the Exhibit 21 list. */
  subsidiariesNotInExhibit21: SubsidiaryNotInExhibit21Row[];
};
