-- CreateEnum
CREATE TYPE "RiskChecklistType" AS ENUM ('issuer', 'security', 'dagger');
CREATE TYPE "RiskAssessmentStatus" AS ENUM ('draft', 'completed', 'reopened', 'archived');
CREATE TYPE "RiskAnswerLabel" AS ENUM ('no', 'mixed', 'yes', 'unknown', 'not_applicable');

-- CreateTable
CREATE TABLE "risk_checklist_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "checklist_type" "RiskChecklistType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "risk_checklist_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "risk_checklist_questions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "question_code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "max_points" DECIMAL(8,2) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_dagger" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "guidance_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "risk_checklist_questions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "risk_security_instruments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cusip" TEXT,
    "isin" TEXT,
    "priority" TEXT,
    "lien_level" TEXT,
    "maturity_date" TIMESTAMP(3),
    "debt_instrument_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "risk_security_instruments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "risk_assessments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "security_instrument_id" TEXT,
    "template_id" TEXT NOT NULL,
    "assessment_type" "RiskChecklistType" NOT NULL,
    "status" "RiskAssessmentStatus" NOT NULL DEFAULT 'draft',
    "raw_score" DECIMAL(8,4),
    "effective_score" DECIMAL(8,4),
    "manual_override_score" DECIMAL(8,4),
    "final_score" DECIMAL(8,4),
    "classification" TEXT,
    "dagger_override_reason" TEXT,
    "data_confidence" DECIMAL(8,4),
    "assessment_date" TIMESTAMP(3),
    "next_review_date" TIMESTAMP(3),
    "manual_override_classification" TEXT,
    "manual_override_reason" TEXT,
    "manual_override_review_date" TIMESTAMP(3),
    "manual_override_by" TEXT,
    "created_by" TEXT,
    "completed_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "risk_assessment_answers" (
    "id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "answer_label" "RiskAnswerLabel" NOT NULL,
    "answer_value" DECIMAL(4,2) NOT NULL,
    "calculated_points" DECIMAL(8,4) NOT NULL,
    "metric_value" DECIMAL(18,6),
    "metric_unit" TEXT,
    "metric_period" TEXT,
    "analyst_comment" TEXT,
    "source_url" TEXT,
    "source_description" TEXT,
    "source_as_of_date" TIMESTAMP(3),
    "internal_document_id" TEXT,
    "confidence" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "risk_assessment_answers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "risk_dagger_flags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "dagger_code" TEXT NOT NULL,
    "assessment_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "severity" TEXT,
    "analyst_comment" TEXT,
    "source_url" TEXT,
    "internal_document_id" TEXT,
    "identified_date" TIMESTAMP(3),
    "last_reviewed_date" TIMESTAMP(3),
    "resolved_date" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "risk_dagger_flags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "risk_issuer_summaries" (
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "raw_score" DECIMAL(8,4),
    "effective_score" DECIMAL(8,4),
    "final_score" DECIMAL(8,4),
    "classification" TEXT,
    "risk_velocity" DECIMAL(8,4),
    "risk_velocity_status" TEXT,
    "active_dagger_count" INTEGER NOT NULL DEFAULT 0,
    "data_confidence" DECIMAL(8,4),
    "last_assessment_id" TEXT,
    "last_updated_at" TIMESTAMP(3),
    "next_review_date" TIMESTAMP(3),
    "assessment_overdue" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "risk_issuer_summaries_pkey" PRIMARY KEY ("user_id","ticker")
);

CREATE TABLE "risk_audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "security_instrument_id" TEXT,
    "assessment_id" TEXT,
    "action" TEXT NOT NULL,
    "previous_value" TEXT,
    "new_value" TEXT,
    "explanation" TEXT,
    "performed_by" TEXT,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "risk_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "risk_scoring_configs" (
    "user_id" TEXT NOT NULL,
    "issuer_weight_percent" INTEGER NOT NULL DEFAULT 75,
    "security_weight_percent" INTEGER NOT NULL DEFAULT 25,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "risk_scoring_configs_pkey" PRIMARY KEY ("user_id")
);

-- Indexes
CREATE UNIQUE INDEX "risk_checklist_templates_name_version_checklist_type_key" ON "risk_checklist_templates"("name", "version", "checklist_type");
CREATE UNIQUE INDEX "risk_checklist_questions_template_id_question_code_key" ON "risk_checklist_questions"("template_id", "question_code");
CREATE INDEX "risk_checklist_questions_template_id_category_display_order_idx" ON "risk_checklist_questions"("template_id", "category", "display_order");
CREATE INDEX "risk_security_instruments_user_id_ticker_idx" ON "risk_security_instruments"("user_id", "ticker");
CREATE INDEX "risk_assessments_user_id_ticker_status_idx" ON "risk_assessments"("user_id", "ticker", "status");
CREATE INDEX "risk_assessments_user_id_ticker_assessment_type_idx" ON "risk_assessments"("user_id", "ticker", "assessment_type");
CREATE INDEX "risk_assessments_completed_at_idx" ON "risk_assessments"("completed_at");
CREATE UNIQUE INDEX "risk_assessment_answers_assessment_id_question_id_key" ON "risk_assessment_answers"("assessment_id", "question_id");
CREATE INDEX "risk_dagger_flags_user_id_ticker_is_active_idx" ON "risk_dagger_flags"("user_id", "ticker", "is_active");
CREATE INDEX "risk_dagger_flags_user_id_ticker_dagger_code_idx" ON "risk_dagger_flags"("user_id", "ticker", "dagger_code");
CREATE INDEX "risk_issuer_summaries_user_id_effective_score_idx" ON "risk_issuer_summaries"("user_id", "effective_score");
CREATE INDEX "risk_issuer_summaries_user_id_classification_idx" ON "risk_issuer_summaries"("user_id", "classification");
CREATE INDEX "risk_audit_logs_user_id_ticker_idx" ON "risk_audit_logs"("user_id", "ticker");
CREATE INDEX "risk_audit_logs_assessment_id_idx" ON "risk_audit_logs"("assessment_id");

-- ForeignKeys
ALTER TABLE "risk_checklist_questions" ADD CONSTRAINT "risk_checklist_questions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "risk_checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risk_security_instruments" ADD CONSTRAINT "risk_security_instruments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_security_instrument_id_fkey" FOREIGN KEY ("security_instrument_id") REFERENCES "risk_security_instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "risk_checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "risk_assessment_answers" ADD CONSTRAINT "risk_assessment_answers_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risk_assessment_answers" ADD CONSTRAINT "risk_assessment_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "risk_checklist_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "risk_dagger_flags" ADD CONSTRAINT "risk_dagger_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risk_issuer_summaries" ADD CONSTRAINT "risk_issuer_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risk_audit_logs" ADD CONSTRAINT "risk_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risk_scoring_configs" ADD CONSTRAINT "risk_scoring_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
