-- OpenCorporates address finder: API response cache + per-subsidiary results

CREATE TABLE "opencorporates_api_cache_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "cik" TEXT,
    "cache_key" TEXT NOT NULL,
    "normalized_subsidiary_name" TEXT NOT NULL,
    "jurisdiction_filter" TEXT NOT NULL,
    "query_used" TEXT NOT NULL,
    "api_endpoint" TEXT NOT NULL,
    "response_at" TIMESTAMP(3) NOT NULL,
    "result_count" INTEGER NOT NULL,
    "raw_response_json" JSONB NOT NULL,
    "selected_result_json" JSONB,
    "error_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opencorporates_api_cache_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "opencorporates_api_cache_entries_user_id_cache_key_key"
    ON "opencorporates_api_cache_entries"("user_id", "cache_key");

CREATE INDEX "opencorporates_api_cache_entries_user_id_ticker_idx"
    ON "opencorporates_api_cache_entries"("user_id", "ticker");

ALTER TABLE "opencorporates_api_cache_entries"
    ADD CONSTRAINT "opencorporates_api_cache_entries_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "opencorporates_subsidiary_address_results" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "cik" TEXT,
    "parent_company_name" TEXT,
    "subsidiary_row_index" INTEGER NOT NULL,
    "exhibit_legal_name" TEXT NOT NULL,
    "exhibit_jurisdiction" TEXT,
    "entity_type" TEXT,
    "source_filing" TEXT,
    "filing_date" TEXT,
    "search_query_used" TEXT NOT NULL,
    "matched_name" TEXT,
    "oc_jurisdiction" TEXT,
    "company_number" TEXT,
    "company_status" TEXT,
    "registered_address" TEXT,
    "raw_address" TEXT,
    "normalized_address" TEXT,
    "address_confidence" TEXT,
    "match_confidence" TEXT,
    "oc_url" TEXT,
    "registry_url" TEXT,
    "retrieval_timestamp" TIMESTAMP(3),
    "result_status" TEXT NOT NULL,
    "notes" TEXT,
    "top_candidates_json" JSONB,
    "raw_search_response_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opencorporates_subsidiary_address_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "opencorporates_subsidiary_address_results_user_id_ticker_subsidiary_row_index_key"
    ON "opencorporates_subsidiary_address_results"("user_id", "ticker", "subsidiary_row_index");

CREATE INDEX "opencorporates_subsidiary_address_results_user_id_ticker_idx"
    ON "opencorporates_subsidiary_address_results"("user_id", "ticker");

ALTER TABLE "opencorporates_subsidiary_address_results"
    ADD CONSTRAINT "opencorporates_subsidiary_address_results_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
