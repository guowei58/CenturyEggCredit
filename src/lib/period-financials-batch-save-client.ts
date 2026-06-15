/**
 * Client-side batch save is deprecated — the runner delegates to the server API so saves
 * continue after navigation. Re-exports shared types/constants for compatibility.
 */

export {
  PERIOD_FINANCIALS_BATCH_QUARTER_COUNT,
  type PeriodFinancialsBatchSaveProgress,
  type PeriodFinancialsBatchSaveResult,
} from "@/lib/period-financials-batch-save-shared";
