-- Egg-Hoc: paste/screenshot images in committee chat (stored as BYTEA; captions remain in body).

ALTER TYPE "EggHocMessageType" ADD VALUE 'IMAGE';

ALTER TABLE "egg_hoc_messages" ADD COLUMN IF NOT EXISTS "image_mime_type" VARCHAR(120);
ALTER TABLE "egg_hoc_messages" ADD COLUMN IF NOT EXISTS "image_bytes" BYTEA;
