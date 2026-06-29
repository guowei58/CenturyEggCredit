-- AlterTable
ALTER TABLE "capital_structure_securities" ADD COLUMN "user_edited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "capital_structure_securities" ADD COLUMN "is_confirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "capital_structure_securities" ADD COLUMN "confirmed_at" TIMESTAMP(3);

-- Backfill: rows that already have a CUSIP count as confirmed securities
UPDATE "capital_structure_securities"
SET "is_confirmed" = true, "confirmed_at" = "updated_at"
WHERE "cusip" IS NOT NULL AND TRIM("cusip") <> '';

-- Index for querying confirmed securities per ticker
CREATE INDEX "capital_structure_securities_user_id_ticker_is_confirmed_idx" ON "capital_structure_securities"("user_id", "ticker", "is_confirmed");
