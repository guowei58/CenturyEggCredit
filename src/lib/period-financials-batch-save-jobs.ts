import type { PeriodFinancialsBatchSaveProgress } from "@/lib/period-financials-batch-save-shared";

export type PeriodFinancialsBatchJobStatus = "running" | "complete" | "error";

export type PeriodFinancialsBatchJobRecord = {
  userId: string;
  ticker: string;
  fingerprint: string;
  status: PeriodFinancialsBatchJobStatus;
  progress: PeriodFinancialsBatchSaveProgress | null;
  summary: string | null;
  updatedAt: number;
};

const jobs = new Map<string, PeriodFinancialsBatchJobRecord>();

function jobKey(userId: string, ticker: string, fingerprint: string): string {
  return `${userId}:${ticker.trim().toUpperCase()}:${fingerprint}`;
}

export function getPeriodFinancialsBatchJob(
  userId: string,
  ticker: string,
  fingerprint: string
): PeriodFinancialsBatchJobRecord | null {
  if (!userId || !ticker.trim() || !fingerprint) return null;
  return jobs.get(jobKey(userId, ticker, fingerprint)) ?? null;
}

export function setPeriodFinancialsBatchJobRunning(
  userId: string,
  ticker: string,
  fingerprint: string
): void {
  const sym = ticker.trim().toUpperCase();
  jobs.set(jobKey(userId, sym, fingerprint), {
    userId,
    ticker: sym,
    fingerprint,
    status: "running",
    progress: { done: 0, total: 1, label: "Starting…", detail: "" },
    summary: null,
    updatedAt: Date.now(),
  });
}

export function setPeriodFinancialsBatchJobProgress(
  userId: string,
  ticker: string,
  fingerprint: string,
  progress: PeriodFinancialsBatchSaveProgress
): void {
  const key = jobKey(userId, ticker, fingerprint);
  const prev = jobs.get(key);
  if (!prev) return;
  jobs.set(key, { ...prev, progress, updatedAt: Date.now() });
}

export function setPeriodFinancialsBatchJobComplete(
  userId: string,
  ticker: string,
  fingerprint: string,
  summary: string,
  status: "complete" | "error"
): void {
  const sym = ticker.trim().toUpperCase();
  jobs.set(jobKey(userId, sym, fingerprint), {
    userId,
    ticker: sym,
    fingerprint,
    status,
    progress: null,
    summary,
    updatedAt: Date.now(),
  });
}

export function clearPeriodFinancialsBatchJob(
  userId: string,
  ticker: string,
  fingerprint: string
): void {
  jobs.delete(jobKey(userId, ticker, fingerprint));
}
