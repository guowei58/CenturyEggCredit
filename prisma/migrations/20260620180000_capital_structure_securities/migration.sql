-- CreateTable
CREATE TABLE "capital_structure_securities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cusip" TEXT,
    "cusip_manually_set" BOOLEAN NOT NULL DEFAULT false,
    "isin" TEXT,
    "instrument_type" TEXT,
    "lien_level" TEXT,
    "structural_ranking" TEXT,
    "issuer" TEXT,
    "coupon" TEXT,
    "price" TEXT,
    "yield_to_maturity" TEXT,
    "face_amount" TEXT,
    "currency" TEXT DEFAULT 'USD',
    "maturity_date" TIMESTAMP(3),
    "maturity_label" TEXT,
    "source_excel_file" TEXT,
    "source_row_index" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capital_structure_securities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capital_structure_securities_user_id_ticker_idx" ON "capital_structure_securities"("user_id", "ticker");

-- AddForeignKey
ALTER TABLE "capital_structure_securities" ADD CONSTRAINT "capital_structure_securities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
