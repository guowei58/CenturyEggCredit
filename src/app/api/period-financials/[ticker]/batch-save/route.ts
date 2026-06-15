import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  clearPeriodFinancialsBatchJob,
  getPeriodFinancialsBatchJob,
  setPeriodFinancialsBatchJobComplete,
  setPeriodFinancialsBatchJobProgress,
  setPeriodFinancialsBatchJobRunning,
} from "@/lib/period-financials-batch-save-jobs";
import { runPeriodFinancialsBatchSaveOnServer } from "@/lib/period-financials-batch-save-server";
import type { PeriodFinancialsFilingLabelRow } from "@/lib/period-financials-roic";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function internalBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function parseFilings(raw: unknown): PeriodFinancialsFilingLabelRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PeriodFinancialsFilingLabelRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const accessionNumber = typeof r.accessionNumber === "string" ? r.accessionNumber.trim() : "";
    const form = typeof r.form === "string" ? r.form.trim() : "";
    const filingDate = typeof r.filingDate === "string" ? r.filingDate.trim() : "";
    if (!accessionNumber || !form || !filingDate) continue;
    out.push({
      accessionNumber,
      form,
      filingDate,
      ...(typeof r.primaryDocument === "string" && r.primaryDocument.trim()
        ? { primaryDocument: r.primaryDocument.trim() }
        : {}),
      ...(typeof r.reportDate === "string" && r.reportDate.trim()
        ? { reportDate: r.reportDate.trim() }
        : {}),
    });
  }
  return out;
}

/** GET — poll in-flight or recently finished server batch job. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: rawTicker } = await params;
  const ticker = sanitizeTicker(rawTicker);
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Invalid ticker" }, { status: 400 });
  }

  const fingerprint = new URL(request.url).searchParams.get("fingerprint")?.trim() ?? "";
  if (!fingerprint) {
    return NextResponse.json({ ok: false, error: "fingerprint required" }, { status: 400 });
  }

  const job = getPeriodFinancialsBatchJob(userId, ticker, fingerprint);
  return NextResponse.json({
    ok: true,
    job: job ?? { status: "idle", progress: null, summary: null },
  });
}

/** POST — start server-side batch save; continues after the client navigates away. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: rawTicker } = await params;
  const ticker = sanitizeTicker(rawTicker);
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Invalid ticker" }, { status: 400 });
  }

  let body: {
    filings?: unknown;
    companyName?: unknown;
    cik?: unknown;
    fingerprint?: unknown;
    force?: unknown;
    quarterCount?: unknown;
    roicSymbol?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const filings = parseFilings(body.filings);
  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint.trim() : "";
  if (!filings.length || !fingerprint) {
    return NextResponse.json({ ok: false, error: "filings and fingerprint required" }, { status: 400 });
  }

  const force = body.force === true;
  const existing = getPeriodFinancialsBatchJob(userId, ticker, fingerprint);
  if (!force && existing?.status === "running") {
    return NextResponse.json({ ok: true, started: false, alreadyRunning: true }, { status: 202 });
  }
  if (!force && existing?.status === "complete") {
    return NextResponse.json({
      ok: true,
      started: false,
      alreadyComplete: true,
      summary: existing.summary,
    });
  }

  if (force) {
    clearPeriodFinancialsBatchJob(userId, ticker, fingerprint);
  }

  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;
  const cik = typeof body.cik === "string" ? body.cik.trim() : undefined;
  const quarterCount =
    typeof body.quarterCount === "number" && Number.isFinite(body.quarterCount)
      ? body.quarterCount
      : undefined;
  const baseUrl = internalBaseUrl(request);
  const roicSymbol =
    (typeof body.roicSymbol === "string" ? body.roicSymbol.trim() : "") ||
    process.env.ROIC_AI_SYMBOL_OVERRIDE?.trim() ||
    undefined;

  setPeriodFinancialsBatchJobRunning(userId, ticker, fingerprint);

  void (async () => {
    try {
      const result = await runPeriodFinancialsBatchSaveOnServer(userId, {
        ticker,
        filings,
        companyName,
        cik,
        quarterCount,
        internalBaseUrl: baseUrl,
        roicSymbol,
        onProgress: (progress) => {
          setPeriodFinancialsBatchJobProgress(userId, ticker, fingerprint, progress);
        },
      });

      const parts = [
        `${result.saved} saved`,
        result.skipped ? `${result.skipped} skipped` : null,
        result.failed ? `${result.failed} failed` : null,
      ].filter(Boolean);
      const detail =
        result.errors.length > 0
          ? ` ${result.errors.slice(0, 3).join(" ")}${result.errors.length > 3 ? " …" : ""}`
          : "";
      const summary = `Recent quarters batch: ${parts.join(", ")}.${detail}`;
      const status: "complete" | "error" =
        result.failed > 0 && result.saved === 0 ? "error" : "complete";
      setPeriodFinancialsBatchJobComplete(userId, ticker, fingerprint, summary, status);
    } catch (e) {
      setPeriodFinancialsBatchJobComplete(
        userId,
        ticker,
        fingerprint,
        e instanceof Error ? e.message : "Batch save failed.",
        "error"
      );
    }
  })();

  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}
