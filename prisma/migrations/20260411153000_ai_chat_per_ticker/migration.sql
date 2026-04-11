-- Per-ticker AI chat: composite primary key (user_id, ticker). Existing rows become __GLOBAL__.

ALTER TABLE "user_ai_chat_state" ADD COLUMN "ticker" TEXT NOT NULL DEFAULT '__GLOBAL__';

ALTER TABLE "user_ai_chat_state" DROP CONSTRAINT "user_ai_chat_state_pkey";

ALTER TABLE "user_ai_chat_state" ADD CONSTRAINT "user_ai_chat_state_pkey" PRIMARY KEY ("user_id", "ticker");
