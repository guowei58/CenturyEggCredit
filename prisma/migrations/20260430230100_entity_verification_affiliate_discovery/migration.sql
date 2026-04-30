-- Entity Verification & Affiliate Discovery (manual diligence workflow)

CREATE TYPE "KnownEntitySourceType" AS ENUM (
  'exhibit_21',
  'ten_k',
  'ten_q',
  'credit_agreement',
  'indenture',
  'guarantee_agreement',
  'security_agreement',
  'securitization_doc',
  'company_website',
  'user_input',
  'prior_research',
  'other'
);

CREATE TYPE "KnownEntityRole" AS ENUM (
  'public_parent',
  'issuer',
  'co_issuer',
  'borrower',
  'guarantor',
  'subsidiary',
  'material_subsidiary',
  'restricted_subsidiary',
  'unrestricted_subsidiary',
  'excluded_subsidiary',
  'finance_sub',
  'receivables_sub',
  'securitization_vehicle',
  'collateral_owner',
  'operating_company',
  'holding_company',
  'joint_venture',
  'dba',
  'former_name',
  'unknown'
);

CREATE TYPE "VerifiedDomesticOrForeign" AS ENUM ('domestic', 'foreign', 'unknown');

CREATE TYPE "VerifiedBusinessEntityStatus" AS ENUM (
  'active',
  'good_standing',
  'inactive',
  'dissolved',
  'forfeited',
  'withdrawn',
  'merged',
  'converted',
  'cancelled',
  'revoked',
  'expired',
  'unknown'
);

CREATE TYPE "EntityVerificationOutcome" AS ENUM (
  'verified_exact_match',
  'verified_probable_match',
  'potential_match',
  'no_match_found',
  'blocked_login_required',
  'blocked_fee_required',
  'unresolved'
);

CREATE TYPE "EntityConfidenceLevel" AS ENUM ('high', 'medium', 'low');

CREATE TYPE "CandidateDiscoveryMethod" AS ENUM (
  'name_similarity',
  'shared_address',
  'shared_officer',
  'shared_manager',
  'shared_director',
  'shared_non_generic_registered_agent',
  'shared_property_address',
  'shared_permit_address',
  'credit_doc_reference',
  'sec_filing_reference',
  'ucc_reference',
  'tax_lien_reference',
  'county_record_reference',
  'court_record_reference',
  'public_web_reference',
  'user_added',
  'other'
);

CREATE TYPE "CandidateAffiliateReviewStatus" AS ENUM (
  'unreviewed',
  'confirmed_affiliate',
  'likely_affiliate',
  'possible_affiliate',
  'rejected',
  'needs_follow_up'
);

CREATE TYPE "EntityRelationshipType" AS ENUM (
  'parent_subsidiary',
  'issuer_guarantor',
  'borrower_guarantor',
  'holding_company_operating_company',
  'finance_sub',
  'receivables_sub',
  'securitization_vehicle',
  'collateral_owner',
  'joint_venture',
  'dba',
  'former_name',
  'successor',
  'predecessor',
  'merger_target',
  'possible_affiliate',
  'same_address',
  'same_officer',
  'unknown'
);

CREATE TYPE "EntityFilingEventType" AS ENUM (
  'formation',
  'foreign_registration',
  'name_change',
  'merger',
  'conversion',
  'amendment',
  'reinstatement',
  'forfeiture',
  'dissolution',
  'withdrawal',
  'cancellation',
  'registered_agent_change',
  'address_change',
  'annual_report',
  'assumed_name',
  'other'
);

CREATE TYPE "EntityDiligenceIssueKind" AS ENUM (
  'known_entity_not_verified',
  'official_name_mismatch',
  'inactive_entity',
  'dissolved_entity',
  'forfeited_entity',
  'withdrawn_entity',
  'borrower_or_guarantor_inactive',
  'entity_in_credit_docs_not_in_exhibit_21',
  'entity_in_sos_not_in_exhibit_21',
  'possible_unlisted_affiliate',
  'shared_address_candidate',
  'shared_officer_candidate',
  'unexplained_finance_sub',
  'unexplained_receivables_sub',
  'unexplained_securitization_vehicle',
  'unexplained_ip_holding_entity',
  'unexplained_real_estate_holding_entity',
  'recent_merger_or_conversion',
  'recent_name_change',
  'foreign_registration_gap',
  'multiple_similar_names',
  'inconsistent_jurisdiction',
  'missing_registered_agent',
  'other'
);

CREATE TYPE "EntityDiligenceSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "EntityDiligenceWorkflowStatus" AS ENUM ('open', 'resolved', 'dismissed', 'needs_follow_up');

CREATE TYPE "EntitySearchTaskReason" AS ENUM (
  'state_of_incorporation',
  'hq_state',
  'exhibit_21_entity',
  'credit_party',
  'borrower',
  'issuer',
  'guarantor',
  'dba',
  'former_name',
  'address_cluster',
  'candidate_affiliate',
  'user_added',
  'other'
);

CREATE TYPE "EntitySearchTaskWorkflowStatus" AS ENUM (
  'not_started',
  'searched_no_result',
  'potential_match',
  'confirmed_match',
  'blocked_login_required',
  'blocked_fee_required',
  'needs_follow_up',
  'not_applicable'
);

CREATE TABLE "entity_intelligence_profiles" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "company_name" TEXT,
  "public_registrant_name" TEXT,
  "state_of_incorporation" TEXT,
  "hq_address" TEXT,
  "hq_city" TEXT,
  "hq_state" TEXT,
  "hq_zip" TEXT,
  "principal_executive_office_address" TEXT,
  "major_operating_states" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "major_facility_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "source_10k_url" TEXT,
  "source_10k_date" TIMESTAMP(3),
  "custom_source_registry_entries" JSONB,
  "generic_registered_agent_overrides" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entity_intelligence_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entity_intelligence_profiles_user_id_ticker_key" ON "entity_intelligence_profiles"("user_id", "ticker");
CREATE INDEX "entity_intelligence_profiles_user_id_ticker_idx" ON "entity_intelligence_profiles"("user_id", "ticker");
ALTER TABLE "entity_intelligence_profiles" ADD CONSTRAINT "entity_intelligence_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "known_entity_inputs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "entity_name" TEXT NOT NULL,
  "normalized_entity_name" TEXT NOT NULL,
  "source_type" "KnownEntitySourceType" NOT NULL,
  "source_document_title" TEXT,
  "source_document_url" TEXT,
  "source_date" DATE,
  "entity_role" "KnownEntityRole" NOT NULL,
  "jurisdiction_hint" TEXT,
  "address_hint" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "known_entity_inputs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "known_entity_inputs_user_id_ticker_idx" ON "known_entity_inputs"("user_id", "ticker");
CREATE INDEX "known_entity_inputs_user_id_ticker_normalized_entity_name_idx" ON "known_entity_inputs"("user_id", "ticker", "normalized_entity_name");
ALTER TABLE "known_entity_inputs" ADD CONSTRAINT "known_entity_inputs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "verified_entity_records" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "known_entity_input_id" TEXT,
  "searched_name" TEXT NOT NULL,
  "official_entity_name" TEXT NOT NULL,
  "normalized_official_entity_name" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL DEFAULT '',
  "entity_id" TEXT,
  "entity_type" TEXT,
  "domestic_or_foreign" "VerifiedDomesticOrForeign" NOT NULL DEFAULT 'unknown',
  "status" "VerifiedBusinessEntityStatus" NOT NULL DEFAULT 'unknown',
  "formation_date" DATE,
  "registration_date" DATE,
  "dissolution_date" DATE,
  "withdrawal_date" DATE,
  "forfeiture_date" DATE,
  "reinstatement_date" DATE,
  "registered_agent_name" TEXT,
  "registered_agent_address" TEXT,
  "principal_office_address" TEXT,
  "mailing_address" TEXT,
  "officers_directors_managers_json" JSONB,
  "source_name" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "document_url" TEXT,
  "documents_available" BOOLEAN NOT NULL DEFAULT false,
  "last_verified_at" TIMESTAMP(3),
  "verification_status" "EntityVerificationOutcome" NOT NULL DEFAULT 'unresolved',
  "confidence" "EntityConfidenceLevel" NOT NULL DEFAULT 'medium',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "verified_entity_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verified_entity_records_user_id_ticker_idx" ON "verified_entity_records"("user_id", "ticker");
CREATE INDEX "verified_entity_records_user_id_ticker_normalized_official_entity_name_idx" ON "verified_entity_records"("user_id", "ticker", "normalized_official_entity_name");
ALTER TABLE "verified_entity_records" ADD CONSTRAINT "verified_entity_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verified_entity_records" ADD CONSTRAINT "verified_entity_records_known_entity_input_id_fkey" FOREIGN KEY ("known_entity_input_id") REFERENCES "known_entity_inputs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "candidate_affiliate_entities" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "candidate_entity_name" TEXT NOT NULL,
  "normalized_candidate_entity_name" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT '',
  "jurisdiction" TEXT NOT NULL DEFAULT '',
  "entity_id" TEXT,
  "entity_type" TEXT,
  "status" "VerifiedBusinessEntityStatus" NOT NULL DEFAULT 'unknown',
  "formation_date" DATE,
  "registered_agent_name" TEXT,
  "registered_agent_address" TEXT,
  "principal_office_address" TEXT,
  "mailing_address" TEXT,
  "officers_directors_managers_json" JSONB,
  "discovery_method" "CandidateDiscoveryMethod" NOT NULL,
  "evidence_json" JSONB,
  "affiliation_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidence" "EntityConfidenceLevel" NOT NULL DEFAULT 'low',
  "review_status" "CandidateAffiliateReviewStatus" NOT NULL DEFAULT 'unreviewed',
  "reason_for_flag" TEXT,
  "source_name" TEXT,
  "source_url" TEXT,
  "document_url" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "candidate_affiliate_entities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "candidate_affiliate_entities_user_id_ticker_idx" ON "candidate_affiliate_entities"("user_id", "ticker");
CREATE INDEX "candidate_affiliate_entities_user_id_ticker_normalized_candidate_entity_name_idx" ON "candidate_affiliate_entities"("user_id", "ticker", "normalized_candidate_entity_name");
ALTER TABLE "candidate_affiliate_entities" ADD CONSTRAINT "candidate_affiliate_entities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "entity_relationships" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "parent_verified_id" TEXT,
  "child_verified_id" TEXT,
  "parent_entity_name" TEXT NOT NULL,
  "child_entity_name" TEXT NOT NULL,
  "relationship_type" "EntityRelationshipType" NOT NULL,
  "evidence_source" TEXT,
  "evidence_url" TEXT,
  "confidence" "EntityConfidenceLevel" NOT NULL DEFAULT 'medium',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entity_relationships_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "entity_relationships_user_id_ticker_idx" ON "entity_relationships"("user_id", "ticker");
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "entity_filing_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "entity_record_id" TEXT,
  "candidate_affiliate_entity_id" TEXT,
  "entity_name" TEXT NOT NULL,
  "event_type" "EntityFilingEventType" NOT NULL,
  "event_date" DATE,
  "filing_number" TEXT,
  "document_title" TEXT,
  "document_url" TEXT,
  "summary" TEXT,
  "risk_flag" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entity_filing_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "entity_filing_events_user_id_ticker_idx" ON "entity_filing_events"("user_id", "ticker");
CREATE INDEX "entity_filing_events_entity_record_id_idx" ON "entity_filing_events"("entity_record_id");
ALTER TABLE "entity_filing_events" ADD CONSTRAINT "entity_filing_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_filing_events" ADD CONSTRAINT "entity_filing_events_entity_record_id_fkey" FOREIGN KEY ("entity_record_id") REFERENCES "verified_entity_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "entity_filing_events" ADD CONSTRAINT "entity_filing_events_candidate_affiliate_entity_id_fkey" FOREIGN KEY ("candidate_affiliate_entity_id") REFERENCES "candidate_affiliate_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "entity_diligence_issues" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "issue_type" "EntityDiligenceIssueKind" NOT NULL,
  "issue_title" TEXT NOT NULL,
  "issue_description" TEXT NOT NULL,
  "related_entity_name" TEXT,
  "related_entity_id" TEXT,
  "related_candidate_id" TEXT,
  "severity" "EntityDiligenceSeverity" NOT NULL,
  "status" "EntityDiligenceWorkflowStatus" NOT NULL DEFAULT 'open',
  "evidence_json" JSONB,
  "source_url" TEXT,
  "notes" TEXT,
  "is_system_generated" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entity_diligence_issues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "entity_diligence_issues_user_id_ticker_idx" ON "entity_diligence_issues"("user_id", "ticker");
CREATE INDEX "entity_diligence_issues_user_id_ticker_severity_idx" ON "entity_diligence_issues"("user_id", "ticker", "severity");
ALTER TABLE "entity_diligence_issues" ADD CONSTRAINT "entity_diligence_issues_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "entity_search_tasks" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "entity_name" TEXT NOT NULL,
  "normalized_entity_name" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "search_reason" "EntitySearchTaskReason" NOT NULL,
  "search_status" "EntitySearchTaskWorkflowStatus" NOT NULL DEFAULT 'not_started',
  "result_entity_record_id" TEXT,
  "notes" TEXT,
  "checked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entity_search_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "entity_search_tasks_user_id_ticker_idx" ON "entity_search_tasks"("user_id", "ticker");
CREATE INDEX "entity_search_tasks_user_id_ticker_state_normalized_entity_name_idx" ON "entity_search_tasks"("user_id", "ticker", "state", "normalized_entity_name");
ALTER TABLE "entity_search_tasks" ADD CONSTRAINT "entity_search_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_search_tasks" ADD CONSTRAINT "entity_search_tasks_result_entity_record_id_fkey" FOREIGN KEY ("result_entity_record_id") REFERENCES "verified_entity_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
