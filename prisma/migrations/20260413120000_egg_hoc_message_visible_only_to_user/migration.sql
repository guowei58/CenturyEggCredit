-- Per-recipient lobby welcome (and similar) without inflating everyone else's unread.
ALTER TABLE "egg_hoc_messages" ADD COLUMN "visible_only_to_user_id" TEXT;

CREATE INDEX "egg_hoc_messages_conversation_id_visible_only_to_user_id_idx"
  ON "egg_hoc_messages" ("conversation_id", "visible_only_to_user_id");
