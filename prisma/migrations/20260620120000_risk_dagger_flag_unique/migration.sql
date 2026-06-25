-- Remove duplicate dagger flags, keeping the most recently updated row per user/ticker/code.
DELETE FROM "risk_dagger_flags" a
USING "risk_dagger_flags" b
WHERE a."user_id" = b."user_id"
  AND a."ticker" = b."ticker"
  AND a."dagger_code" = b."dagger_code"
  AND (
    a."updated_at" < b."updated_at"
    OR (a."updated_at" = b."updated_at" AND a."id" > b."id")
  );

CREATE UNIQUE INDEX "risk_dagger_flags_user_id_ticker_dagger_code_key"
  ON "risk_dagger_flags"("user_id", "ticker", "dagger_code");
