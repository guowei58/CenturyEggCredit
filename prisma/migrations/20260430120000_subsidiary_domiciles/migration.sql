-- Parallel arrays: subsidiary legal name + state/country of incorporation (Exhibit 21)
ALTER TABLE "public_records_profiles" ADD COLUMN "subsidiary_domiciles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
