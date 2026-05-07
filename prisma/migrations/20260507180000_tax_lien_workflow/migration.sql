-- Tax lien & release research workflow (queue, documents, manual tasks)
--
-- `entity_universe_items` may be absent on DBs that never got a CREATE for that table (schema drift);
-- match credit_doc_subsidiaries_workflow: only ALTER when the table exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'entity_universe_items'
  ) THEN
    ALTER TABLE "entity_universe_items" ADD COLUMN IF NOT EXISTS "tax_lien_summary_json" JSONB;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "tax_lien_workflow_candidates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "entity_legal_name" TEXT NOT NULL,
    "normalized_entity_name" TEXT NOT NULL,
    "is_parent_issuer" BOOLEAN NOT NULL DEFAULT false,
    "formation_jurisdiction_raw" TEXT,
    "formation_state_abbr" TEXT NOT NULL DEFAULT 'UN',
    "entity_type" TEXT,
    "principal_office_address" TEXT,
    "mailing_address" TEXT,
    "registered_office_address" TEXT,
    "ucc_debtor_address" TEXT,
    "aliases_json" JSONB,
    "source_filing" TEXT,
    "source_date" DATE,
    "search_jurisdictions_json" JSONB NOT NULL,
    "search_counties_json" JSONB,
    "query_variants_json" JSONB,
    "search_plan_json" JSONB,
    "workflow_search_status" TEXT NOT NULL DEFAULT 'queued',
    "results_found" INTEGER NOT NULL DEFAULT 0,
    "manual_required" BOOLEAN NOT NULL DEFAULT true,
    "workflow_entity_sources" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "federal_tax_lien_found" BOOLEAN NOT NULL DEFAULT false,
    "state_tax_lien_found" BOOLEAN NOT NULL DEFAULT false,
    "tax_lien_released" BOOLEAN NOT NULL DEFAULT false,
    "unreleased_tax_lien_flag" BOOLEAN NOT NULL DEFAULT false,
    "latest_lien_filing_date" DATE,
    "latest_release_date" DATE,
    "lien_amount_text" TEXT,
    "source_evidence_count" INTEGER NOT NULL DEFAULT 0,
    "highest_match_confidence" TEXT NOT NULL DEFAULT 'unknown',
    "mapper_manual_review_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_lien_workflow_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tax_lien_documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "candidate_id" TEXT,
    "entity_searched" TEXT NOT NULL,
    "matched_taxpayer_name" TEXT NOT NULL,
    "normalized_taxpayer_name" TEXT,
    "taxpayer_address" TEXT,
    "match_confidence" TEXT NOT NULL DEFAULT 'unknown',
    "lien_kind" TEXT NOT NULL DEFAULT 'unknown',
    "document_category" TEXT NOT NULL DEFAULT 'unknown',
    "document_type_label" TEXT NOT NULL,
    "filing_jurisdiction" TEXT NOT NULL,
    "county_recording_office" TEXT,
    "filing_date" DATE,
    "recording_date" DATE,
    "tax_period_text" TEXT,
    "assessment_date" DATE,
    "amount_text" TEXT,
    "filing_number" TEXT,
    "book_page_text" TEXT,
    "derived_status" TEXT NOT NULL DEFAULT 'unknown',
    "release_date" DATE,
    "related_primary_document_id" TEXT,
    "source_url" TEXT,
    "document_image_url" TEXT,
    "raw_source_text" TEXT,
    "source_method" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_lien_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tax_lien_manual_search_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "candidate_id" TEXT,
    "entity_legal_name" TEXT NOT NULL,
    "state_abbr" TEXT NOT NULL,
    "county_name" TEXT,
    "reason_manual" TEXT NOT NULL,
    "search_url" TEXT NOT NULL,
    "exact_search_query" TEXT NOT NULL,
    "suggested_doc_type_filters_json" JSONB,
    "task_status" TEXT NOT NULL DEFAULT 'open',
    "user_notes" TEXT,
    "upload_result_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_lien_manual_search_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tax_lien_workflow_candidates_user_id_ticker_idx" ON "tax_lien_workflow_candidates"("user_id", "ticker");
CREATE INDEX IF NOT EXISTS "tax_lien_workflow_candidates_user_id_ticker_normalized_entity_name_idx" ON "tax_lien_workflow_candidates"("user_id", "ticker", "normalized_entity_name");

CREATE INDEX IF NOT EXISTS "tax_lien_documents_user_id_ticker_idx" ON "tax_lien_documents"("user_id", "ticker");
CREATE INDEX IF NOT EXISTS "tax_lien_documents_candidate_id_idx" ON "tax_lien_documents"("candidate_id");

CREATE INDEX IF NOT EXISTS "tax_lien_manual_search_tasks_user_id_ticker_idx" ON "tax_lien_manual_search_tasks"("user_id", "ticker");

ALTER TABLE "tax_lien_workflow_candidates" ADD CONSTRAINT "tax_lien_workflow_candidates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tax_lien_documents" ADD CONSTRAINT "tax_lien_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tax_lien_documents" ADD CONSTRAINT "tax_lien_documents_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "tax_lien_workflow_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tax_lien_manual_search_tasks" ADD CONSTRAINT "tax_lien_manual_search_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tax_lien_manual_search_tasks" ADD CONSTRAINT "tax_lien_manual_search_tasks_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "tax_lien_workflow_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
