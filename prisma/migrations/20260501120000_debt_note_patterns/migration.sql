-- Prior-period debt note extraction hints per CIK
CREATE TABLE "debt_note_patterns" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "cik" TEXT NOT NULL,
    "filing_type" TEXT NOT NULL,
    "filing_date" TEXT NOT NULL,
    "accession_number" TEXT NOT NULL,
    "debt_note_number" TEXT,
    "debt_note_heading" TEXT NOT NULL,
    "previous_note_heading" TEXT,
    "next_note_heading" TEXT,
    "extraction_method" TEXT NOT NULL,
    "xbrl_concepts_used" JSONB,
    "debt_table_labels" JSONB,
    "confidence" TEXT NOT NULL,
    "user_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_note_patterns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "debt_note_patterns_cik_idx" ON "debt_note_patterns"("cik");
