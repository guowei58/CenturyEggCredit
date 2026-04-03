-- CreateTable
CREATE TABLE "user_watchlist_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_watchlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_ticker_documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "data_key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ticker_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_ai_chat_state" (
    "user_id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ai_chat_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "user_watchlist_entries_user_id_sort_order_idx" ON "user_watchlist_entries"("user_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "user_watchlist_entries_user_id_ticker_key" ON "user_watchlist_entries"("user_id", "ticker");

-- CreateIndex
CREATE INDEX "user_ticker_documents_user_id_ticker_idx" ON "user_ticker_documents"("user_id", "ticker");

-- CreateIndex
CREATE UNIQUE INDEX "user_ticker_documents_user_id_ticker_data_key_key" ON "user_ticker_documents"("user_id", "ticker", "data_key");

-- AddForeignKey
ALTER TABLE "user_watchlist_entries" ADD CONSTRAINT "user_watchlist_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ticker_documents" ADD CONSTRAINT "user_ticker_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ai_chat_state" ADD CONSTRAINT "user_ai_chat_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
