-- CreateTable
CREATE TABLE "user_ticker_workspace_files" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "body" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ticker_workspace_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_ticker_workspace_files_user_id_ticker_idx" ON "user_ticker_workspace_files"("user_id", "ticker");

-- CreateIndex
CREATE UNIQUE INDEX "user_ticker_workspace_files_user_id_ticker_path_key" ON "user_ticker_workspace_files"("user_id", "ticker", "path");

-- AddForeignKey
ALTER TABLE "user_ticker_workspace_files" ADD CONSTRAINT "user_ticker_workspace_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
