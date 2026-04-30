-- Exhibit 21: store full scraped grid alongside legacy name/dom columns.
ALTER TABLE "public"."public_records_profiles"
ADD COLUMN IF NOT EXISTS "subsidiary_exhibit21_snapshot" JSONB;
