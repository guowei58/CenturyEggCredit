/**
 * Period Financials batch save — starts a server job and polls status so saves continue
 * after the user navigates away from the page.
 */

import {
  PERIOD_FINANCIALS_BATCH_QUARTER_COUNT,
  type PeriodFinancialsBatchSaveProgress,
} from "@/lib/period-financials-batch-save-shared";
import {
  selectLastNPeriodFinancialsFilings,
  type PeriodFinancialsFilingLabelRow,
} from "@/lib/period-financials-roic";

const STORAGE_PREFIX = "cec-period-fin-batch:v1:";
const POLL_MS = 2000;

export type PeriodFinancialsBatchJobStatus = "idle" | "running" | "complete" | "error";

export type PeriodFinancialsBatchJobSnapshot = {
  ticker: string;
  fingerprint: string;
  status: PeriodFinancialsBatchJobStatus;
  progress: PeriodFinancialsBatchSaveProgress | null;
  summary: string | null;
};

type Listener = (snapshot: PeriodFinancialsBatchJobSnapshot) => void;

const listeners = new Set<Listener>();
const snapshots = new Map<string, PeriodFinancialsBatchJobSnapshot>();
const pollTimers = new Map<string, ReturnType<typeof setInterval>>();

function storageKey(ticker: string, fingerprint: string): string {
  return `${STORAGE_PREFIX}${ticker.trim().toUpperCase()}:${fingerprint}`;
}

function readStoredStatus(ticker: string, fingerprint: string): "complete" | "error" | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey(ticker, fingerprint));
    if (raw === "complete" || raw === "error") return raw;
  } catch {
    /* private browsing */
  }
  return null;
}

function writeStoredStatus(ticker: string, fingerprint: string, status: "complete" | "error"): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(storageKey(ticker, fingerprint), status);
  } catch {
    /* noop */
  }
}

export function periodFinancialsBatchFingerprint(
  filings: PeriodFinancialsFilingLabelRow[],
  quarterCount = PERIOD_FINANCIALS_BATCH_QUARTER_COUNT
): string {
  const picked = selectLastNPeriodFinancialsFilings(filings, quarterCount);
  if (picked.length === 0) return "";
  return picked.map((f) => f.accessionNumber).join("|");
}

function snapshotKey(ticker: string, fingerprint: string): string {
  return `${ticker.trim().toUpperCase()}:${fingerprint}`;
}

function emit(snapshot: PeriodFinancialsBatchJobSnapshot): void {
  snapshots.set(snapshotKey(snapshot.ticker, snapshot.fingerprint), snapshot);
  for (const fn of listeners) fn(snapshot);
}

function stopPolling(ticker: string, fingerprint: string): void {
  const key = snapshotKey(ticker, fingerprint);
  const timer = pollTimers.get(key);
  if (timer) {
    clearInterval(timer);
    pollTimers.delete(key);
  }
}

function applyServerJob(
  ticker: string,
  fingerprint: string,
  job: {
    status?: string;
    progress?: PeriodFinancialsBatchSaveProgress | null;
    summary?: string | null;
  }
): void {
  const sym = ticker.trim().toUpperCase();
  const key = snapshotKey(sym, fingerprint);
  const prev = snapshots.get(key) ?? null;
  if (job.status === "running") {
    emit({
      ticker: sym,
      fingerprint,
      status: "running",
      progress: job.progress ?? null,
      summary: null,
    });
    return;
  }
  if (job.status === "complete") {
    writeStoredStatus(sym, fingerprint, "complete");
    stopPolling(sym, fingerprint);
    emit({
      ticker: sym,
      fingerprint,
      status: "complete",
      progress: null,
      summary: job.summary ?? "Recent quarters batch complete.",
    });
    return;
  }
  if (job.status === "error") {
    writeStoredStatus(sym, fingerprint, "error");
    stopPolling(sym, fingerprint);
    emit({
      ticker: sym,
      fingerprint,
      status: "error",
      progress: null,
      summary: job.summary ?? "Batch save failed.",
    });
    return;
  }

  if ((job.status === "idle" || !job.status) && prev?.status === "running") {
    stopPolling(sym, fingerprint);
    emit({
      ticker: sym,
      fingerprint,
      status: "complete",
      progress: null,
      summary:
        "Background save no longer reports live progress. It likely finished after you navigated away. Check Saved Documents; you can rerun safely if anything is missing.",
    });
  }
}

async function pollServerJob(ticker: string, fingerprint: string): Promise<void> {
  const sym = ticker.trim().toUpperCase();
  try {
    const res = await fetch(
      `/api/period-financials/${encodeURIComponent(sym)}/batch-save?fingerprint=${encodeURIComponent(fingerprint)}`,
      { credentials: "include", cache: "no-store" }
    );
    const j = (await res.json()) as {
      ok?: boolean;
      job?: { status?: string; progress?: PeriodFinancialsBatchSaveProgress | null; summary?: string | null };
    };
    if (res.ok && j.ok && j.job) {
      applyServerJob(sym, fingerprint, j.job);
    }
  } catch {
    /* keep polling — server may still be running */
  }
}

function startPolling(ticker: string, fingerprint: string): void {
  const sym = ticker.trim().toUpperCase();
  const key = snapshotKey(sym, fingerprint);
  if (pollTimers.has(key)) return;

  void pollServerJob(sym, fingerprint);
  pollTimers.set(
    key,
    setInterval(() => {
      void pollServerJob(sym, fingerprint);
    }, POLL_MS)
  );
}

export function subscribePeriodFinancialsBatchSave(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPeriodFinancialsBatchSnapshot(
  ticker: string,
  fingerprint: string
): PeriodFinancialsBatchJobSnapshot {
  const sym = ticker.trim().toUpperCase();
  if (!sym || !fingerprint) {
    return { ticker: sym, fingerprint, status: "idle", progress: null, summary: null };
  }

  const stored = readStoredStatus(sym, fingerprint);
  if (stored === "complete") {
    return {
      ticker: sym,
      fingerprint,
      status: "complete",
      progress: null,
      summary: "Recent quarters already saved this session.",
    };
  }
  if (stored === "error") {
    return {
      ticker: sym,
      fingerprint,
      status: "error",
      progress: null,
      summary: null,
    };
  }

  const cached = snapshots.get(snapshotKey(sym, fingerprint));
  if (cached) return cached;

  return { ticker: sym, fingerprint, status: "idle", progress: null, summary: null };
}

export type EnsurePeriodFinancialsBatchSaveOpts = {
  ticker: string;
  filings: PeriodFinancialsFilingLabelRow[];
  companyName?: string;
  cik?: string;
  quarterCount?: number;
  force?: boolean;
};

/**
 * Start a server-side batch save. The server continues saving after navigation.
 */
export function ensurePeriodFinancialsBatchSave(opts: EnsurePeriodFinancialsBatchSaveOpts): void {
  const sym = opts.ticker.trim().toUpperCase();
  const fingerprint = periodFinancialsBatchFingerprint(opts.filings, opts.quarterCount);
  if (!sym || !fingerprint || opts.filings.length === 0) return;

  if (opts.force) {
    clearPeriodFinancialsBatchSession(sym, fingerprint);
  } else {
    const stored = readStoredStatus(sym, fingerprint);
    if (stored === "complete" || stored === "error") {
      emit(getPeriodFinancialsBatchSnapshot(sym, fingerprint));
      return;
    }
  }

  emit({
    ticker: sym,
    fingerprint,
    status: "running",
    progress: { done: 0, total: 1, label: "Starting…", detail: "" },
    summary: null,
  });

  startPolling(sym, fingerprint);

  void fetch(`/api/period-financials/${encodeURIComponent(sym)}/batch-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body: JSON.stringify({
      filings: opts.filings,
      companyName: opts.companyName,
      cik: opts.cik,
      fingerprint,
      force: opts.force === true,
      quarterCount: opts.quarterCount,
    }),
  })
    .then(async (res) => {
      const j = (await res.json().catch(() => null)) as {
        ok?: boolean;
        alreadyComplete?: boolean;
        alreadyRunning?: boolean;
        summary?: string;
        error?: string;
      } | null;

      if (!res.ok || j?.ok === false) {
        writeStoredStatus(sym, fingerprint, "error");
        stopPolling(sym, fingerprint);
        emit({
          ticker: sym,
          fingerprint,
          status: "error",
          progress: null,
          summary: j?.error ?? "Could not start batch save.",
        });
        return;
      }

      if (j?.alreadyComplete) {
        writeStoredStatus(sym, fingerprint, "complete");
        stopPolling(sym, fingerprint);
        emit({
          ticker: sym,
          fingerprint,
          status: "complete",
          progress: null,
          summary: j.summary ?? "Recent quarters already saved this session.",
        });
      }
    })
    .catch(() => {
      /* POST may fail if tab closes; server job + polling handle completion when possible */
    });
}

export function clearPeriodFinancialsBatchSession(ticker: string, fingerprint: string): void {
  const sym = ticker.trim().toUpperCase();
  if (typeof window === "undefined" || !sym || !fingerprint) return;
  stopPolling(sym, fingerprint);
  try {
    sessionStorage.removeItem(storageKey(sym, fingerprint));
  } catch {
    /* noop */
  }
  snapshots.delete(snapshotKey(sym, fingerprint));
}

/** Resume polling when Period Financials remounts while a server job may still be running. */
export function resumePeriodFinancialsBatchPolling(ticker: string, fingerprint: string): void {
  const sym = ticker.trim().toUpperCase();
  if (!sym || !fingerprint) return;
  const stored = readStoredStatus(sym, fingerprint);
  if (stored === "complete" || stored === "error") return;
  startPolling(sym, fingerprint);
}

export { PERIOD_FINANCIALS_BATCH_QUARTER_COUNT };
