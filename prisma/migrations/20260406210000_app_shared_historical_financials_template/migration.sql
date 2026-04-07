-- CreateTable
CREATE TABLE "app_shared_historical_financials_template" (
    "id" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "body" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_user_id" TEXT,

    CONSTRAINT "app_shared_historical_financials_template_pkey" PRIMARY KEY ("id")
);
