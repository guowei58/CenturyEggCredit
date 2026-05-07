-- UCC debtor search candidates (affiliate discovery)
-- Some deployments may have schema drift; create idempotently.

DO $$ BEGIN
  CREATE TYPE "EntityUniverseConfidenceKind" AS ENUM ('high', 'medium', 'low', 'unknown');
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
  CREATE TYPE "UccDebtorFilingKind" AS ENUM (
    'ucc_1',
    'ucc_3',
    'continuation',
    'amendment',
    'assignment',
    'termination',
    'fixture_filing',
    'unknown'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ucc_debtor_candidates" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "debtor_name" TEXT NOT NULL,
  "normalized_debtor_name" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "filing_number" TEXT,
  "filing_date" DATE,
  "secured_party_name" TEXT,
  "collateral_description" TEXT,
  "filing_type" "UccDebtorFilingKind" NOT NULL DEFAULT 'unknown',
  "matched_search_term" TEXT,
  "listed_in_exhibit_21" BOOLEAN NOT NULL DEFAULT false,
  "appears_in_credit_docs" BOOLEAN NOT NULL DEFAULT false,
  "confidence" "EntityUniverseConfidenceKind" NOT NULL DEFAULT 'unknown',
  "relevance_score" INTEGER NOT NULL DEFAULT 0,
  "review_status" "EntityUniverseReviewStatus" NOT NULL DEFAULT 'unreviewed',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ucc_debtor_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ucc_debtor_candidates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ucc_debtor_candidates_user_id_ticker_idx" ON "ucc_debtor_candidates"("user_id", "ticker");
CREATE INDEX IF NOT EXISTS "ucc_debtor_candidates_user_id_ticker_normalized_debtor_name_idx" ON "ucc_debtor_candidates"("user_id", "ticker", "normalized_debtor_name");

