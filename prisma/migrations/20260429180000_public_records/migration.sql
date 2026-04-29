-- State & Local Public Records — per-user per-ticker diligence workspace

CREATE TYPE "PublicRecordCategory" AS ENUM (
  'entity_sos',
  'ucc_secured_debt',
  'tax_liens_releases',
  'real_estate_recorder',
  'property_tax_assessor',
  'permits_zoning_co',
  'environmental_compliance',
  'courts_judgments',
  'licenses_regulatory',
  'economic_incentives',
  'procurement_contracts',
  'gis_facility_mapping',
  'other'
);

CREATE TYPE "PublicRecordJurisdictionType" AS ENUM (
  'state',
  'county',
  'city',
  'court',
  'agency',
  'regional',
  'other'
);

CREATE TYPE "PublicRecordChecklistStatus" AS ENUM (
  'not_started',
  'searched_no_result',
  'potential_match',
  'confirmed_result',
  'needs_follow_up',
  'blocked_login_required',
  'blocked_fee_required',
  'not_applicable'
);

CREATE TYPE "PublicRecordFindingStatus" AS ENUM (
  'active',
  'inactive',
  'open',
  'released',
  'terminated',
  'expired',
  'resolved',
  'pending',
  'dismissed',
  'unknown',
  'no_result'
);

CREATE TYPE "PublicRecordRelatedRole" AS ENUM (
  'parent',
  'issuer',
  'borrower',
  'guarantor',
  'subsidiary',
  'former_name',
  'dba',
  'property_owner',
  'vendor',
  'unknown'
);

CREATE TYPE "PublicRecordRiskLevel" AS ENUM (
  'low',
  'medium',
  'high',
  'critical',
  'unknown'
);

CREATE TYPE "PublicRecordConfidenceLevel" AS ENUM (
  'high',
  'medium',
  'low'
);

CREATE TYPE "PublicRecordsCoverageQuality" AS ENUM (
  'high',
  'medium',
  'low'
);

CREATE TABLE "public_records_profiles" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "company_name" TEXT,
  "legal_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "former_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "dba_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "subsidiary_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "borrower_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "guarantor_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "issuer_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "restricted_subsidiary_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "unrestricted_subsidiary_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "parent_company_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "operating_company_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "hq_state" TEXT,
  "hq_county" TEXT,
  "hq_city" TEXT,
  "principal_executive_office_address" TEXT,
  "state_of_incorporation" TEXT,
  "major_facility_locations" JSONB,
  "known_property_locations" JSONB,
  "known_permit_jurisdictions" JSONB,
  "known_regulatory_jurisdictions" JSONB,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "public_records_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_records_profiles_user_id_ticker_key" ON "public_records_profiles"("user_id", "ticker");
CREATE INDEX "public_records_profiles_user_id_ticker_idx" ON "public_records_profiles"("user_id", "ticker");

ALTER TABLE "public_records_profiles" ADD CONSTRAINT "public_records_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_public_record_sources" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "category" "PublicRecordCategory" NOT NULL,
  "jurisdiction_type" "PublicRecordJurisdictionType" NOT NULL,
  "jurisdiction_name" TEXT,
  "state" TEXT,
  "county" TEXT,
  "city" TEXT,
  "agency_name" TEXT,
  "source_name" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "search_instructions" TEXT,
  "search_use_case" TEXT,
  "requires_login" BOOLEAN NOT NULL DEFAULT false,
  "has_fees" BOOLEAN NOT NULL DEFAULT false,
  "supports_name_search" BOOLEAN NOT NULL DEFAULT true,
  "supports_address_search" BOOLEAN NOT NULL DEFAULT false,
  "supports_parcel_search" BOOLEAN NOT NULL DEFAULT false,
  "supports_instrument_search" BOOLEAN NOT NULL DEFAULT false,
  "supports_pdf_download" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "last_checked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_public_record_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_public_record_sources_user_id_ticker_idx" ON "user_public_record_sources"("user_id", "ticker");

ALTER TABLE "user_public_record_sources" ADD CONSTRAINT "user_public_record_sources_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public_records" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "category" "PublicRecordCategory" NOT NULL,
  "source_key" TEXT,
  "record_type" TEXT,
  "status" "PublicRecordFindingStatus" NOT NULL DEFAULT 'unknown',
  "searched_entity_name" TEXT,
  "matched_entity_name" TEXT,
  "related_entity_role" "PublicRecordRelatedRole" NOT NULL DEFAULT 'unknown',
  "filing_date" TIMESTAMP(3),
  "effective_date" TIMESTAMP(3),
  "expiration_date" TIMESTAMP(3),
  "release_date" TIMESTAMP(3),
  "recording_number" TEXT,
  "instrument_number" TEXT,
  "case_number" TEXT,
  "permit_number" TEXT,
  "license_number" TEXT,
  "parcel_number" TEXT,
  "account_number" TEXT,
  "contract_number" TEXT,
  "amount" TEXT,
  "tax_period" TEXT,
  "creditor_or_agency" TEXT,
  "secured_party" TEXT,
  "counterparty" TEXT,
  "property_address" TEXT,
  "jurisdiction_state" TEXT,
  "jurisdiction_county" TEXT,
  "jurisdiction_city" TEXT,
  "document_title" TEXT,
  "document_url" TEXT,
  "local_file_url" TEXT,
  "source_url" TEXT,
  "extracted_text" TEXT,
  "summary" TEXT,
  "notes" TEXT,
  "risk_level" "PublicRecordRiskLevel" NOT NULL DEFAULT 'unknown',
  "confidence" "PublicRecordConfidenceLevel" NOT NULL DEFAULT 'medium',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "public_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "public_records_user_id_ticker_idx" ON "public_records"("user_id", "ticker");
CREATE INDEX "public_records_user_id_ticker_category_idx" ON "public_records"("user_id", "ticker", "category");

ALTER TABLE "public_records" ADD CONSTRAINT "public_records_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public_records_search_runs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "run_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "searched_by" TEXT,
  "categories_included" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "search_scope" JSONB,
  "search_terms_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sources_checked" JSONB,
  "summary" TEXT,
  "open_items_count" INTEGER NOT NULL DEFAULT 0,
  "high_risk_items_count" INTEGER NOT NULL DEFAULT 0,
  "unresolved_items_count" INTEGER NOT NULL DEFAULT 0,
  "no_result_items_count" INTEGER NOT NULL DEFAULT 0,
  "coverage_quality" "PublicRecordsCoverageQuality" NOT NULL DEFAULT 'low',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "public_records_search_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "public_records_search_runs_user_id_ticker_idx" ON "public_records_search_runs"("user_id", "ticker");

ALTER TABLE "public_records_search_runs" ADD CONSTRAINT "public_records_search_runs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public_records_checklist_items" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "category" "PublicRecordCategory" NOT NULL,
  "source_key" TEXT NOT NULL,
  "entity_name" TEXT,
  "jurisdiction_name" TEXT,
  "status" "PublicRecordChecklistStatus" NOT NULL DEFAULT 'not_started',
  "notes" TEXT,
  "checked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "public_records_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_records_checklist_items_user_id_ticker_source_key_key"
  ON "public_records_checklist_items"("user_id", "ticker", "source_key");
CREATE INDEX "public_records_checklist_items_user_id_ticker_idx" ON "public_records_checklist_items"("user_id", "ticker");

ALTER TABLE "public_records_checklist_items" ADD CONSTRAINT "public_records_checklist_items_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public_records_documents" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "content_type" TEXT,
  "body" BYTEA NOT NULL,
  "extracted_text" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "public_records_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "public_records_documents_user_id_ticker_idx" ON "public_records_documents"("user_id", "ticker");

ALTER TABLE "public_records_documents" ADD CONSTRAINT "public_records_documents_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
