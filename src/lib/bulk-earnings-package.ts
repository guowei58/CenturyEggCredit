/**
 * Bulk "Update all via API" — ensure Period Financials quarterly earnings package (2 yrs)
 * is saved to Saved Documents before work-product / memo steps that ingest those files.
 */

import {
  PERIOD_FINANCIALS_BATCH_QUARTER_COUNT,
  type PeriodFinancialsBatchSaveProgress,
} from "@/lib/period-financials-batch-save-shared";
import { periodFinancialsBatchFingerprint } from "@/lib/period-financials-batch-save-runner";
import {
  periodicSecFilingFilenameBase,
  periodLabelToFilenameSlug,
  selectLastNPeriodFinancialsFilings,
  type PeriodFinancialsFilingLabelRow,
} from "@/lib/period-financials-roic";

const BATCH_POLL_MS = 2_500;
const BATCH_MAX_WAIT_MS = 45 * 60 * 1_000;

type FilingsFetchResult = {
  filings: PeriodFinancialsFilingLabelRow[];
  cik?: string;
  companyName?: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchPeriodFinancialsFilingsForBulk(ticker: string): Promise<FilingsFetchResult> {
  const sym = ticker.trim().toUpperCase();
  const res = await fetch(
    `/api/sec/xbrl/test-as-presented/${encodeURIComponent(sym)}?filingsOnly=1`,
    { cache: "no-store", credentials: "include" }
  );
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    filings?: PeriodFinancialsFilingLabelRow[];
    cik?: string;
    companyName?: string;
  };
  if (!res.ok || !Array.isArray(j.filings) || j.filings.length === 0) {
    throw new Error(j.error ?? "Could not load SEC filings for quarterly earnings package");
  }
  return { filings: j.filings, cik: j.cik, companyName: j.companyName };
}

function expectedStemsForPeriod(ticker: string, form: string, periodLabel: string): string[] {
  const sym = ticker.trim().toUpperCase();
  const slug = periodLabelToFilenameSlug(periodLabel);
  return [
    `${sym}_press-release-8K_${slug}`,
    `${sym}_mgmt-presentation_${slug}`,
    `${sym}_earnings-transcript_${slug}`,
    periodicSecFilingFilenameBase(sym, form, periodLabel),
  ];
}

function filenameMatchesStem(filename: string, stem: string): boolean {
  const fn = filename.trim().toLowerCase();
  const s = stem.trim().toLowerCase();
  if (!fn || !s) return false;
  return fn === s || fn.startsWith(`${s}.`) || fn.startsWith(s);
}

/** True when every period in the 2-year window has at least one batch-saved document on disk. */
export function quarterlyEarningsPackageCoverage(
  ticker: string,
  filings: PeriodFinancialsFilingLabelRow[],
  savedFilenames: string[],
  quarterCount = PERIOD_FINANCIALS_BATCH_QUARTER_COUNT
): { complete: boolean; periodsFound: number; periodsExpected: number } {
  const periods = selectLastNPeriodFinancialsFilings(filings, quarterCount);
  if (periods.length === 0) {
    return { complete: false, periodsFound: 0, periodsExpected: 0 };
  }

  let periodsFound = 0;
  for (const period of periods) {
    const stems = expectedStemsForPeriod(ticker, period.form, period.periodLabel);
    const hasAny = stems.some((stem) => savedFilenames.some((fn) => filenameMatchesStem(fn, stem)));
    if (hasAny) periodsFound++;
  }

  return {
    complete: periodsFound >= periods.length,
    periodsFound,
    periodsExpected: periods.length,
  };
}

async function listSavedDocumentFilenames(ticker: string): Promise<string[]> {
  const res = await fetch(`/api/saved-documents/${encodeURIComponent(ticker.trim().toUpperCase())}`, {
    cache: "no-store",
    credentials: "include",
  });
  const j = (await res.json().catch(() => ({}))) as { items?: Array<{ filename?: string }>; error?: string };
  if (!res.ok) {
    throw new Error(j.error ?? "Could not list saved documents");
  }
  return (j.items ?? []).map((item) => item.filename ?? "").filter(Boolean);
}

async function pollBatchSaveJob(
  ticker: string,
  fingerprint: string
): Promise<{ status: "running" | "complete" | "error" | "idle"; progress?: PeriodFinancialsBatchSaveProgress | null; summary?: string | null }> {
  const res = await fetch(
    `/api/period-financials/${encodeURIComponent(ticker.trim().toUpperCase())}/batch-save?fingerprint=${encodeURIComponent(fingerprint)}`,
    { cache: "no-store", credentials: "include" }
  );
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    job?: {
      status?: string;
      progress?: PeriodFinancialsBatchSaveProgress | null;
      summary?: string | null;
    };
  };
  if (!res.ok || !j.ok) return { status: "idle" };
  const status = j.job?.status;
  if (status === "running" || status === "complete" || status === "error") {
    return { status, progress: j.job?.progress ?? null, summary: j.job?.summary ?? null };
  }
  return { status: "idle", progress: j.job?.progress ?? null, summary: j.job?.summary ?? null };
}

/**
 * Runs (or skips) the same server job as "Save Quarterly Earnings Package (2yrs)" on Period Financials.
 * Returns `"skipped"` when files are already present or the server job already finished for this fingerprint.
 */
export async function ensureQuarterlyEarningsPackageForBulk(
  ticker: string,
  companyName: string | null | undefined,
  onProgress?: (detail: string) => void
): Promise<"skipped" | "complete"> {
  const sym = ticker.trim().toUpperCase();
  const { filings, cik, companyName: secName } = await fetchPeriodFinancialsFilingsForBulk(sym);
  const fingerprint = periodFinancialsBatchFingerprint(filings);
  if (!fingerprint) {
    throw new Error("No periodic filings found for quarterly earnings package");
  }

  const existingJob = await pollBatchSaveJob(sym, fingerprint);
  if (existingJob.status === "complete") {
    return "skipped";
  }

  const savedFilenames = await listSavedDocumentFilenames(sym);
  const coverage = quarterlyEarningsPackageCoverage(sym, filings, savedFilenames);
  if (coverage.complete) {
    return "skipped";
  }

  if (existingJob.status !== "running") {
    onProgress?.(
      coverage.periodsFound > 0
        ? `Starting save (${coverage.periodsFound}/${coverage.periodsExpected} periods already saved)…`
        : "Starting save…"
    );

    const postRes = await fetch(`/api/period-financials/${encodeURIComponent(sym)}/batch-save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        filings,
        companyName: companyName?.trim() || secName,
        cik,
        fingerprint,
        force: false,
      }),
    });
    const postJson = (await postRes.json().catch(() => ({}))) as {
      ok?: boolean;
      alreadyComplete?: boolean;
      alreadyRunning?: boolean;
      error?: string;
    };
    if (!postRes.ok || postJson.ok === false) {
      throw new Error(postJson.error ?? "Could not start quarterly earnings package save");
    }
    if (postJson.alreadyComplete) {
      return "skipped";
    }
  } else {
    onProgress?.("Resuming in-flight quarterly earnings package save…");
  }

  const deadline = Date.now() + BATCH_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await delay(BATCH_POLL_MS);
    const job = await pollBatchSaveJob(sym, fingerprint);
    if (job.status === "complete") {
      return "complete";
    }
    if (job.status === "error") {
      throw new Error(job.summary ?? "Quarterly earnings package save failed");
    }
    if (job.progress) {
      const p = job.progress;
      onProgress?.(
        `${p.label}${p.detail ? ` — ${p.detail}` : ""} (${p.done}/${p.total})`
      );
    }
  }

  throw new Error("Quarterly earnings package save timed out after 45 minutes");
}
