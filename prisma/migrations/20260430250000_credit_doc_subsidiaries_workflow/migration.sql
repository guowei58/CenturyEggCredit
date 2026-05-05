-- Credit Document subsidiaries workflow: sources, extractions, relationships, matrix, workflow issues.
--
-- Prerequisite fixes for DBs created only from migrations:
-- - `entity_universe_items` was never created by an earlier migration (schema drift); skip ALTER if absent.
-- - `EntityUniverseItemRole` / `EntityUniverseConfidenceKind` are referenced below but were not created here; add idempotently.

DO $$ BEGIN
  CREATE TYPE "EntityUniverseConfidenceKind" AS ENUM ('high', 'medium', 'low', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EntityUniverseItemRole" AS ENUM (
    'public_parent',
    'exhibit_21_subsidiary',
    'borrower',
    'issuer',
    'co_issuer',
    'guarantor',
    'grantor',
    'pledgor',
    'collateral_owner',
    'restricted_subsidiary',
    'unrestricted_subsidiary',
    'excluded_subsidiary',
    'immaterial_subsidiary',
    'non_guarantor_subsidiary',
    'finance_sub',
    'funding_sub',
    'receivables_sub',
    'securitization_vehicle',
    'leasing_sub',
    'ip_holding_entity',
    'real_estate_holding_entity',
    'operating_company',
    'holding_company',
    'management_company',
    'services_company',
    'joint_venture',
    'dba',
    'former_name',
    'possible_affiliate',
    'unknown'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'entity_universe_items'
  ) THEN
    ALTER TABLE "entity_universe_items" ADD COLUMN IF NOT EXISTS "role_flags_json" JSONB;
  END IF;
END $$;

CREATE TYPE "CreditDocSourceDocumentType" AS ENUM (
  'credit_agreement', 'amended_and_restated_credit_agreement', 'loan_agreement', 'indenture', 'supplemental_indenture',
  'guarantee_agreement', 'security_agreement', 'pledge_agreement', 'collateral_agreement', 'intercreditor_agreement',
  'collateral_trust_agreement', 'joinder_agreement', 'amendment', 'waiver', 'consent', 'exchange_agreement',
  'restructuring_support_agreement', 'plan_of_reorganization', 'disclosure_statement', 'receivables_agreement',
  'securitization_agreement', 'abs_indenture', 'mortgage', 'deed_of_trust', 'other'
);

CREATE TYPE "CreditDocSourceFilingKind" AS ENUM (
  'sec_8k', 'sec_10k', 'sec_10q', 'sec_s1', 'sec_s3', 'sec_s4', 'sec_424b', 'bankruptcy_docket',
  'company_ir', 'uploaded_document', 'saved_document', 'user_url', 'other'
);

CREATE TYPE "CreditDocSourceProcessingStatus" AS ENUM (
  'not_started', 'downloaded', 'parsed', 'extraction_complete', 'extraction_failed', 'needs_review'
);

CREATE TYPE "CreditDocWorkflowEntityRole" AS ENUM (
  'borrower', 'issuer', 'co_issuer', 'guarantor', 'subsidiary_guarantor', 'parent_guarantor', 'grantor', 'pledgor',
  'collateral_owner', 'loan_party', 'obligor', 'restricted_subsidiary', 'unrestricted_subsidiary',
  'excluded_subsidiary', 'immaterial_subsidiary', 'non_guarantor_subsidiary', 'restricted_non_guarantor_subsidiary',
  'foreign_subsidiary', 'domestic_subsidiary', 'receivables_subsidiary', 'securitization_subsidiary',
  'finance_subsidiary', 'insurance_subsidiary', 'captive_insurance_subsidiary', 'subsidiary', 'parent',
  'holding_company', 'operating_company', 'administrative_agent', 'collateral_agent', 'trustee', 'lender',
  'secured_party', 'other', 'unknown'
);

CREATE TYPE "CreditDocExtractionMethod" AS ENUM (
  'regex', 'llm', 'table_extraction', 'schedule_extraction', 'signature_page_extraction', 'manual'
);

CREATE TYPE "CreditDocExtractionConfidence" AS ENUM ('high', 'medium', 'low');

CREATE TYPE "CreditDocDetailedReviewStatus" AS ENUM (
  'unreviewed', 'confirmed', 'edited', 'rejected', 'needs_follow_up'
);

CREATE TYPE "CreditDocRelationshipType" AS ENUM (
  'borrower_guarantor', 'issuer_guarantor', 'parent_subsidiary', 'restricted_sub_link', 'unrestricted_sub_link',
  'excluded_sub_link', 'non_guarantor_sub_link', 'loan_party_link', 'grantor_collateral_agent', 'pledgor_collateral_agent',
  'obligor_trustee', 'receivables_transfer', 'securitization_transfer', 'collateral_owner_link', 'released_guarantor',
  'added_guarantor', 'added_borrower', 'added_grantor', 'predecessor_successor', 'relationship_other'
);

CREATE TYPE "CreditDocRelationshipConfidence" AS ENUM ('high', 'medium', 'low');

CREATE TYPE "CreditDocWorkflowIssueSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "CreditDocWorkflowIssueWorkflowStatus" AS ENUM (
  'open', 'resolved', 'dismissed', 'needs_follow_up'
);

CREATE TABLE "credit_document_sources" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "document_title" TEXT NOT NULL,
  "document_type" "CreditDocSourceDocumentType" NOT NULL,
  "filing_type" "CreditDocSourceFilingKind" NOT NULL,
  "filing_date" DATE,
  "period_date" DATE,
  "accession_number" TEXT,
  "exhibit_number" VARCHAR(64),
  "sec_url" TEXT,
  "source_url" TEXT,
  "local_file_url" TEXT,
  "saved_document_ref_id" TEXT,
  "html_text_available" BOOLEAN NOT NULL DEFAULT false,
  "pdf_available" BOOLEAN NOT NULL DEFAULT false,
  "processed" BOOLEAN NOT NULL DEFAULT false,
  "processing_status" "CreditDocSourceProcessingStatus" NOT NULL DEFAULT 'not_started',
  "notes" TEXT,
  "extracted_text_digest" TEXT,
  "candidate_relevant" BOOLEAN,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_document_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "credit_document_sources_user_id_ticker_idx" ON "credit_document_sources" ("user_id", "ticker");
CREATE INDEX "credit_document_sources_user_id_ticker_processing_status_idx" ON "credit_document_sources" ("user_id", "ticker", "processing_status");
ALTER TABLE "credit_document_sources" ADD CONSTRAINT "credit_document_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "credit_document_entity_extractions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "credit_document_source_id" TEXT NOT NULL,
  "entity_name" TEXT NOT NULL,
  "normalized_entity_name" TEXT NOT NULL,
  "entity_role" "CreditDocWorkflowEntityRole" NOT NULL,
  "role_confidence" "CreditDocExtractionConfidence" NOT NULL DEFAULT 'medium',
  "source_section" TEXT,
  "source_definition" TEXT,
  "source_schedule" TEXT,
  "source_exhibit" VARCHAR(120),
  "page_number" VARCHAR(32),
  "excerpt" TEXT,
  "extraction_method" "CreditDocExtractionMethod" NOT NULL DEFAULT 'regex',
  "listed_in_exhibit_21" BOOLEAN NOT NULL DEFAULT false,
  "already_in_entity_universe" BOOLEAN NOT NULL DEFAULT false,
  "recommended_entity_universe_role" "EntityUniverseItemRole",
  "relevance_score" INTEGER NOT NULL DEFAULT 0,
  "review_status" "CreditDocDetailedReviewStatus" NOT NULL DEFAULT 'unreviewed',
  "notes" TEXT,
  "evidence_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_document_entity_extractions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "credit_document_entity_extractions_user_id_ticker_idx" ON "credit_document_entity_extractions" ("user_id", "ticker");
CREATE INDEX "credit_document_entity_extractions_user_id_ticker_normalized_entity_name_idx"
  ON "credit_document_entity_extractions" ("user_id", "ticker", "normalized_entity_name");
CREATE INDEX "credit_document_entity_extractions_credit_document_source_id_idx" ON "credit_document_entity_extractions" ("credit_document_source_id");
ALTER TABLE "credit_document_entity_extractions" ADD CONSTRAINT "credit_document_entity_extractions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_document_entity_extractions" ADD CONSTRAINT "credit_document_entity_extractions_credit_document_source_id_fkey"
  FOREIGN KEY ("credit_document_source_id") REFERENCES "credit_document_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "credit_document_entity_relationships" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "credit_document_source_id" TEXT NOT NULL,
  "parent_entity_name" TEXT NOT NULL,
  "child_entity_name" TEXT NOT NULL,
  "relationship_type" "CreditDocRelationshipType" NOT NULL,
  "source_section" TEXT,
  "source_schedule" TEXT,
  "excerpt" TEXT,
  "confidence" "CreditDocRelationshipConfidence" NOT NULL DEFAULT 'medium',
  "notes" TEXT,
  "evidence_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_document_entity_relationships_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "credit_document_entity_relationships_user_id_ticker_idx" ON "credit_document_entity_relationships" ("user_id", "ticker");
CREATE INDEX "credit_document_entity_relationships_credit_document_source_id_idx" ON "credit_document_entity_relationships" ("credit_document_source_id");
ALTER TABLE "credit_document_entity_relationships" ADD CONSTRAINT "credit_document_entity_relationships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_document_entity_relationships" ADD CONSTRAINT "credit_document_entity_relationships_credit_document_source_id_fkey"
  FOREIGN KEY ("credit_document_source_id") REFERENCES "credit_document_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "credit_document_entity_role_matrix_rows" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "entity_name" TEXT NOT NULL,
  "normalized_entity_name" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT '',
  "jurisdiction" TEXT NOT NULL DEFAULT '',
  "source_document_ids" JSONB NOT NULL,
  "source_document_titles" JSONB NOT NULL,
  "source_evidence_json" JSONB NOT NULL,
  "role_flags_json" JSONB NOT NULL,
  "listed_in_exhibit_21" BOOLEAN NOT NULL DEFAULT false,
  "already_in_entity_universe" BOOLEAN NOT NULL DEFAULT false,
  "relevance_score" INTEGER NOT NULL DEFAULT 0,
  "confidence" "EntityUniverseConfidenceKind" NOT NULL DEFAULT 'unknown',
  "review_status" "CreditDocDetailedReviewStatus" NOT NULL DEFAULT 'unreviewed',
  "recommended_primary_role" "EntityUniverseItemRole",
  "key_evidence" TEXT,
  "notes" TEXT,
  "reconciliation_flags_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_document_entity_role_matrix_rows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_document_entity_role_matrix_rows_user_id_ticker_normalized_entity_name_key"
  ON "credit_document_entity_role_matrix_rows" ("user_id", "ticker", "normalized_entity_name");
CREATE INDEX "credit_document_entity_role_matrix_rows_user_id_ticker_idx" ON "credit_document_entity_role_matrix_rows" ("user_id", "ticker");
ALTER TABLE "credit_document_entity_role_matrix_rows" ADD CONSTRAINT "credit_document_entity_role_matrix_rows_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "credit_doc_workflow_issues" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "issue_type" VARCHAR(120) NOT NULL,
  "issue_title" TEXT NOT NULL,
  "issue_description" TEXT NOT NULL,
  "entity_name" TEXT,
  "severity" "CreditDocWorkflowIssueSeverity" NOT NULL,
  "excerpt" TEXT,
  "source_url" TEXT,
  "evidence_json" JSONB,
  "suggested_follow_up" TEXT,
  "status" "CreditDocWorkflowIssueWorkflowStatus" NOT NULL DEFAULT 'open',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_doc_workflow_issues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "credit_doc_workflow_issues_user_id_ticker_idx" ON "credit_doc_workflow_issues" ("user_id", "ticker");
CREATE INDEX "credit_doc_workflow_issues_user_id_ticker_severity_idx" ON "credit_doc_workflow_issues" ("user_id", "ticker", "severity");
ALTER TABLE "credit_doc_workflow_issues" ADD CONSTRAINT "credit_doc_workflow_issues_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
