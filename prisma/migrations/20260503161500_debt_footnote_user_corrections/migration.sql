-- User-confirmed debt footnote / segmentation labels for regression gold data
CREATE TABLE "debt_footnote_user_corrections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT,
    "cik" TEXT NOT NULL,
    "accession_number" TEXT NOT NULL,
    "filing_type" TEXT NOT NULL,
    "filing_date" TEXT NOT NULL,
    "debt_footnote_correct" BOOLEAN,
    "note_boundary_correct" BOOLEAN,
    "correct_note_number" TEXT,
    "correct_note_heading" TEXT,
    "correct_start_snippet" TEXT,
    "correct_end_snippet" TEXT,
    "failed_extraction_method" TEXT,
    "corrected_extraction_method" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_footnote_user_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "debt_footnote_user_corrections_user_id_cik_accession_number_idx" ON "debt_footnote_user_corrections"("user_id", "cik", "accession_number");

ALTER TABLE "debt_footnote_user_corrections" ADD CONSTRAINT "debt_footnote_user_corrections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
