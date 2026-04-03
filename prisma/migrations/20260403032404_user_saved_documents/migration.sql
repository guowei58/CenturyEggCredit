-- CreateTable
CREATE TABLE "user_saved_documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "original_url" TEXT NOT NULL,
    "content_type" TEXT,
    "body" BYTEA NOT NULL,
    "saved_at_iso" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "converted_to_pdf" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_saved_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_saved_documents_user_id_ticker_idx" ON "user_saved_documents"("user_id", "ticker");

-- CreateIndex
CREATE UNIQUE INDEX "user_saved_documents_user_id_ticker_filename_key" ON "user_saved_documents"("user_id", "ticker", "filename");

-- AddForeignKey
ALTER TABLE "user_saved_documents" ADD CONSTRAINT "user_saved_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
