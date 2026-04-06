-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "lobby_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "conversations_lobby_key_key" ON "conversations"("lobby_key");
