-- UCC automation registry fields on candidates, manual tasks, and results source method.

ALTER TABLE "ucc_debtor_candidates" ADD COLUMN IF NOT EXISTS "automation_bucket" TEXT NOT NULL DEFAULT 'unknown_needs_configuration';
ALTER TABLE "ucc_debtor_candidates" ADD COLUMN IF NOT EXISTS "jurisdiction_confidence_kind" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "ucc_debtor_candidates" ADD COLUMN IF NOT EXISTS "recommended_search_method" TEXT NOT NULL DEFAULT '';

ALTER TABLE "ucc_manual_search_tasks" ADD COLUMN IF NOT EXISTS "automation_bucket" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ucc_manual_search_tasks" ADD COLUMN IF NOT EXISTS "workflow_status_label" TEXT NOT NULL DEFAULT 'manual_required';
ALTER TABLE "ucc_manual_search_tasks" ADD COLUMN IF NOT EXISTS "is_delaware_authorized_searcher_task" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ucc_search_results" ADD COLUMN IF NOT EXISTS "source_method" TEXT NOT NULL DEFAULT 'manual';
