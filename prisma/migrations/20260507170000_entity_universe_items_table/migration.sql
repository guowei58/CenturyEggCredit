-- Master entity-universe rows (Exhibit 21, credit docs, UCC, SOS, etc.).
-- Historically this table existed only via schema drift / db push; migrations never created it.

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

DO $$ BEGIN
  CREATE TYPE "EntityUniverseReviewStatus" AS ENUM (
    'unreviewed',
    'confirmed_relevant',
    'likely_relevant',
    'possible_relevant',
    'rejected',
    'needs_follow_up',
    'resolved'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EntityUniverseSourceCategory" AS ENUM (
    'exhibit_21',
    'credit_document',
    'ucc_debtor_search',
    'sos_name_family_search',
    'address_cluster_search',
    'user_added',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
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
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "entity_universe_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "entity_name" TEXT NOT NULL,
    "normalized_entity_name" TEXT NOT NULL,
    "entity_role" "EntityUniverseItemRole" NOT NULL DEFAULT 'unknown',
    "primary_source_category" "EntityUniverseSourceCategory" NOT NULL DEFAULT 'other',
    "merged_source_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "source_document_title" TEXT,
    "source_document_url" TEXT,
    "source_date" DATE,
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
    "matched_address" TEXT,
    "matched_officer_or_manager" TEXT,
    "listed_in_exhibit_21" BOOLEAN NOT NULL DEFAULT false,
    "appears_in_credit_docs" BOOLEAN NOT NULL DEFAULT false,
    "appears_in_ucc_search" BOOLEAN NOT NULL DEFAULT false,
    "appears_in_sos_search" BOOLEAN NOT NULL DEFAULT false,
    "appears_in_address_cluster" BOOLEAN NOT NULL DEFAULT false,
    "evidence_json" JSONB,
    "role_flags_json" JSONB,
    "confidence" "EntityUniverseConfidenceKind" NOT NULL DEFAULT 'unknown',
    "relevance_score" INTEGER NOT NULL DEFAULT 0,
    "review_status" "EntityUniverseReviewStatus" NOT NULL DEFAULT 'unreviewed',
    "duplicate_group_key" TEXT,
    "notes" TEXT,
    "tax_lien_summary_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_universe_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "entity_universe_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "entity_universe_items_user_id_ticker_idx" ON "entity_universe_items"("user_id", "ticker");
CREATE INDEX IF NOT EXISTS "entity_universe_items_user_id_ticker_normalized_entity_name_state_idx" ON "entity_universe_items"("user_id", "ticker", "normalized_entity_name", "state");
CREATE INDEX IF NOT EXISTS "entity_universe_items_user_id_ticker_duplicate_group_key_idx" ON "entity_universe_items"("user_id", "ticker", "duplicate_group_key");
