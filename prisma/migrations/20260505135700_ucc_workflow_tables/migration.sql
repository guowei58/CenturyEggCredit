-- UCC workflow: extend debtor candidates + structured results, manual queue, credit matches, discovered entities.

ALTER TABLE "ucc_debtor_candidates" ADD COLUMN IF NOT EXISTS "workflow_entity_sources" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ucc_debtor_candidates" ADD COLUMN IF NOT EXISTS "jurisdiction_formation_raw" TEXT;
ALTER TABLE "ucc_debtor_candidates" ADD COLUMN IF NOT EXISTS "secondary_states" JSONB;
ALTER TABLE "ucc_debtor_candidates" ADD COLUMN IF NOT EXISTS "query_variants_json" JSONB;
ALTER TABLE "ucc_debtor_candidates" ADD COLUMN IF NOT EXISTS "jurisdiction_plan_json" JSONB;
ALTER TABLE "ucc_debtor_candidates" ADD COLUMN IF NOT EXISTS "workflow_search_status" TEXT NOT NULL DEFAULT 'pending_manual';
ALTER TABLE "ucc_debtor_candidates" ADD COLUMN IF NOT EXISTS "workflow_hit_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "ucc_search_results" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "candidate_id" TEXT,
  "entity_searched" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "search_query_used" TEXT,
  "debtor_name_found" TEXT NOT NULL,
  "debtor_address" TEXT,
  "secured_party_name" TEXT,
  "secured_party_address" TEXT,
  "filing_number" TEXT,
  "filing_type" "UccDebtorFilingKind" NOT NULL DEFAULT 'unknown',
  "filing_date" DATE,
  "lapse_date" DATE,
  "filing_status" TEXT NOT NULL DEFAULT 'unknown',
  "collateral_description" TEXT,
  "collateral_description_available" BOOLEAN NOT NULL DEFAULT false,
  "document_link" TEXT,
  "pdf_downloaded" BOOLEAN NOT NULL DEFAULT false,
  "source_url" TEXT,
  "searched_at" TIMESTAMP(3),
  "likely_financing_relationship" TEXT,
  "confidence" "EntityUniverseConfidenceKind" NOT NULL DEFAULT 'unknown',
  "notes" TEXT,
  "raw_payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ucc_search_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ucc_search_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ucc_search_results_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "ucc_debtor_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ucc_search_results_user_id_ticker_idx" ON "ucc_search_results"("user_id", "ticker");
CREATE INDEX IF NOT EXISTS "ucc_search_results_user_id_ticker_filing_number_idx" ON "ucc_search_results"("user_id", "ticker", "filing_number");

CREATE TABLE IF NOT EXISTS "ucc_manual_search_tasks" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "candidate_id" TEXT,
  "entity_name" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "portal_url" TEXT NOT NULL,
  "exact_search_query" TEXT NOT NULL,
  "normalized_queries_json" JSONB,
  "reason_manual" TEXT NOT NULL,
  "instructions" TEXT NOT NULL,
  "task_status" TEXT NOT NULL DEFAULT 'open',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ucc_manual_search_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ucc_manual_search_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ucc_manual_search_tasks_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "ucc_debtor_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ucc_manual_search_tasks_user_id_ticker_idx" ON "ucc_manual_search_tasks"("user_id", "ticker");

CREATE TABLE IF NOT EXISTS "ucc_credit_document_matches" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "search_result_id" TEXT,
  "ucc_debtor_name" TEXT NOT NULL,
  "secured_party_name" TEXT,
  "matched_credit_party_name" TEXT,
  "matched_facility_instrument" TEXT,
  "filing_date" DATE,
  "document_date" DATE,
  "likely_role" TEXT,
  "source_evidence" TEXT NOT NULL,
  "confidence" "EntityUniverseConfidenceKind" NOT NULL DEFAULT 'unknown',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ucc_credit_document_matches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ucc_credit_document_matches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ucc_credit_document_matches_search_result_id_fkey" FOREIGN KEY ("search_result_id") REFERENCES "ucc_search_results"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ucc_credit_document_matches_user_id_ticker_idx" ON "ucc_credit_document_matches"("user_id", "ticker");

CREATE TABLE IF NOT EXISTS "ucc_discovered_entity_candidates" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "search_result_id" TEXT,
  "new_entity_name" TEXT NOT NULL,
  "jurisdiction" TEXT,
  "debtor_address" TEXT,
  "secured_party_name" TEXT,
  "filing_number" TEXT,
  "reason_flagged" TEXT NOT NULL,
  "suggested_next_step" TEXT NOT NULL,
  "confidence" "EntityUniverseConfidenceKind" NOT NULL DEFAULT 'unknown',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ucc_discovered_entity_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ucc_discovered_entity_candidates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ucc_discovered_entity_candidates_search_result_id_fkey" FOREIGN KEY ("search_result_id") REFERENCES "ucc_search_results"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ucc_discovered_entity_candidates_user_id_ticker_idx" ON "ucc_discovered_entity_candidates"("user_id", "ticker");
