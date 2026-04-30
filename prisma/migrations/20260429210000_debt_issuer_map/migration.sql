-- Debt issuer / obligor entity mapper (SEC EDGAR)

CREATE TYPE "DebtIssuerMapJobStatus" AS ENUM (
  'pending',
  'resolving_company',
  'fetching_sec_filings',
  'extracting_documents',
  'parsing_debt_docs',
  'reconciling',
  'complete',
  'failed'
);

CREATE TYPE "DebtMapSourceType" AS ENUM (
  'SEC_FILING',
  'SEC_EXHIBIT',
  'COMPANY_IR',
  'RATING_AGENCY',
  'FINRA',
  'UCC',
  'OTHER'
);

CREATE TYPE "DebtMapParsedStatus" AS ENUM (
  'pending',
  'parsed',
  'failed',
  'skipped'
);

CREATE TYPE "DebtLegalEntityKind" AS ENUM (
  'public_parent',
  'issuer',
  'co_issuer',
  'borrower',
  'guarantor',
  'collateral_grantor',
  'restricted_subsidiary',
  'unrestricted_subsidiary',
  'excluded_subsidiary',
  'finance_subsidiary',
  'receivables_entity',
  'securitization_entity',
  'unknown'
);

CREATE TYPE "DebtInstrumentEntityRoleKind" AS ENUM (
  'issuer',
  'co_issuer',
  'borrower',
  'parent_guarantor',
  'subsidiary_guarantor',
  'collateral_grantor',
  'pledgor',
  'restricted_subsidiary',
  'unrestricted_subsidiary',
  'excluded_subsidiary',
  'agent',
  'trustee',
  'administrative_agent',
  'collateral_agent'
);

CREATE TYPE "DebtMapRedFlagSeverity" AS ENUM (
  'low',
  'medium',
  'high'
);

CREATE TYPE "DebtMapRedFlagCategory" AS ENUM (
  'missing_document',
  'structural_subordination',
  'guarantor_gap',
  'collateral_gap',
  'unrestricted_subsidiary',
  'excluded_subsidiary',
  'stale_document',
  'conflicting_sources',
  'financing_subsidiary',
  'receivables_or_spv',
  'reconciliation_gap',
  'other'
);

CREATE TABLE "debt_issuer_map_jobs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "company_input" TEXT NOT NULL,
  "ticker" TEXT,
  "cik" TEXT,
  "company_name" TEXT,
  "status" "DebtIssuerMapJobStatus" NOT NULL DEFAULT 'pending',
  "error_message" TEXT,
  "lookback_years" INTEGER NOT NULL DEFAULT 10,
  "options_json" JSONB,
  "filings_scanned_count" INTEGER NOT NULL DEFAULT 0,
  "documents_downloaded_count" INTEGER NOT NULL DEFAULT 0,
  "candidate_debt_docs_count" INTEGER NOT NULL DEFAULT 0,
  "instruments_count" INTEGER NOT NULL DEFAULT 0,
  "legal_entities_count" INTEGER NOT NULL DEFAULT 0,
  "red_flags_count" INTEGER NOT NULL DEFAULT 0,
  "reconciliation_confidence" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "debt_issuer_map_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debt_map_source_documents" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "source_type" "DebtMapSourceType" NOT NULL,
  "filing_type" TEXT,
  "accession_number" TEXT,
  "filing_date" TEXT,
  "exhibit_type" TEXT,
  "document_name" TEXT,
  "document_description" TEXT,
  "source_url" TEXT NOT NULL,
  "local_text_path" TEXT,
  "raw_text" TEXT,
  "classified_as" TEXT,
  "parsed_status" "DebtMapParsedStatus" NOT NULL DEFAULT 'pending',
  "why_included" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debt_map_source_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debt_legal_entities" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "legal_name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "entity_type" "DebtLegalEntityKind" NOT NULL,
  "jurisdiction" TEXT,
  "source_document_id" TEXT,
  "source_snippet" TEXT,
  "confidence_score" DOUBLE PRECISION NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debt_legal_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debt_instruments" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "instrument_name" TEXT NOT NULL,
  "instrument_type" TEXT NOT NULL,
  "principal_amount" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "coupon_or_rate" TEXT,
  "maturity_date" TEXT,
  "secured_status" TEXT,
  "ranking" TEXT,
  "issue_date" TEXT,
  "source_document_id" TEXT NOT NULL,
  "source_snippet" TEXT,
  "confidence_score" DOUBLE PRECISION NOT NULL,
  "extraction_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debt_instruments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debt_instrument_entity_roles" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "debt_instrument_id" TEXT NOT NULL,
  "legal_entity_id" TEXT NOT NULL,
  "role" "DebtInstrumentEntityRoleKind" NOT NULL,
  "source_document_id" TEXT,
  "source_snippet" TEXT,
  "confidence_score" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debt_instrument_entity_roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debt_footnote_items" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "principal_amount" TEXT,
  "carrying_value" TEXT,
  "maturity_date" TEXT,
  "rate" TEXT,
  "source_document_id" TEXT,
  "matched_debt_instrument_id" TEXT,
  "confidence_score" DOUBLE PRECISION NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debt_footnote_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debt_map_red_flags" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "severity" "DebtMapRedFlagSeverity" NOT NULL,
  "category" "DebtMapRedFlagCategory" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "related_instrument_id" TEXT,
  "related_entity_id" TEXT,
  "source_document_id" TEXT,
  "source_snippet" TEXT,
  "manual_follow_up" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debt_map_red_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "debt_issuer_map_jobs_user_id_created_at_idx" ON "debt_issuer_map_jobs"("user_id", "created_at" DESC);

CREATE INDEX "debt_map_source_documents_job_id_idx" ON "debt_map_source_documents"("job_id");

CREATE INDEX "debt_legal_entities_job_id_idx" ON "debt_legal_entities"("job_id");

CREATE INDEX "debt_instruments_job_id_idx" ON "debt_instruments"("job_id");

CREATE INDEX "debt_instrument_entity_roles_job_id_idx" ON "debt_instrument_entity_roles"("job_id");

CREATE INDEX "debt_instrument_entity_roles_debt_instrument_id_idx" ON "debt_instrument_entity_roles"("debt_instrument_id");

CREATE INDEX "debt_footnote_items_job_id_idx" ON "debt_footnote_items"("job_id");

CREATE INDEX "debt_map_red_flags_job_id_idx" ON "debt_map_red_flags"("job_id");

ALTER TABLE "debt_issuer_map_jobs" ADD CONSTRAINT "debt_issuer_map_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_map_source_documents" ADD CONSTRAINT "debt_map_source_documents_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "debt_issuer_map_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_legal_entities" ADD CONSTRAINT "debt_legal_entities_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "debt_issuer_map_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_legal_entities" ADD CONSTRAINT "debt_legal_entities_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "debt_map_source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debt_instruments" ADD CONSTRAINT "debt_instruments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "debt_issuer_map_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_instruments" ADD CONSTRAINT "debt_instruments_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "debt_map_source_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_instrument_entity_roles" ADD CONSTRAINT "debt_instrument_entity_roles_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "debt_issuer_map_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_instrument_entity_roles" ADD CONSTRAINT "debt_instrument_entity_roles_debt_instrument_id_fkey" FOREIGN KEY ("debt_instrument_id") REFERENCES "debt_instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_instrument_entity_roles" ADD CONSTRAINT "debt_instrument_entity_roles_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "debt_legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_instrument_entity_roles" ADD CONSTRAINT "debt_instrument_entity_roles_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "debt_map_source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debt_footnote_items" ADD CONSTRAINT "debt_footnote_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "debt_issuer_map_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_footnote_items" ADD CONSTRAINT "debt_footnote_items_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "debt_map_source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debt_footnote_items" ADD CONSTRAINT "debt_footnote_items_matched_debt_instrument_id_fkey" FOREIGN KEY ("matched_debt_instrument_id") REFERENCES "debt_instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debt_map_red_flags" ADD CONSTRAINT "debt_map_red_flags_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "debt_issuer_map_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_map_red_flags" ADD CONSTRAINT "debt_map_red_flags_related_instrument_id_fkey" FOREIGN KEY ("related_instrument_id") REFERENCES "debt_instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debt_map_red_flags" ADD CONSTRAINT "debt_map_red_flags_related_entity_id_fkey" FOREIGN KEY ("related_entity_id") REFERENCES "debt_legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debt_map_red_flags" ADD CONSTRAINT "debt_map_red_flags_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "debt_map_source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
