/**
 * Server-side Period Financials batch save — runs independently of the browser tab.
 */

import {
  discoverManagementPresentation,
  resolveDiscoveryInputFromTicker,
  roicPeriodToPresentationPeriod,
} from "@/lib/presentations/discovery";
import {
  earningsReleaseUrl,
  managementPresentationUrl,
  PERIOD_FINANCIALS_BATCH_QUARTER_COUNT,
  PERIOD_FINANCIALS_BATCH_SEC_PACE_MS,
  PERIOD_FINANCIALS_BATCH_STEPS_PER_PERIOD,
  secPrimaryDocUrl,
  sleep,
  type IxbrlBatchJson,
  type PeriodFinancialsBatchSaveProgress,
  type PeriodFinancialsBatchSaveResult,
  type PresentedFiling,
} from "@/lib/period-financials-batch-save-shared";
import { saveRoicEarningsTranscriptForPeriod } from "@/lib/period-financials-transcript-save";
import {
  filingPeriodLabelToRoicPeriod,
  periodLabelToFilenameSlug,
  periodicSecFilingFilenameBase,
  selectLastNPeriodFinancialsFilings,
  type PeriodFinancialsFilingLabelRow,
} from "@/lib/period-financials-roic";
import { upsertDocumentFromUrl } from "@/lib/saved-documents";
import { buildIxbrlMdnaTablesBundle } from "@/lib/sec-ixbrl-mdna-tables-bundle";

async function fetchIxbrlNarrativeBundle(
  ticker: string,
  accessionNumber: string
): Promise<IxbrlBatchJson | null> {
  try {
    const bundle = await buildIxbrlMdnaTablesBundle(ticker, { accessionNumber });
    return bundle as IxbrlBatchJson;
  } catch {
    return null;
  }
}

async function saveUrlWithPeriod(
  userId: string,
  ticker: string,
  url: string,
  docKind: string,
  periodLabel: string
): Promise<"saved" | "skipped" | "failed"> {
  const slug = periodLabelToFilenameSlug(periodLabel);
  const r = await upsertDocumentFromUrl(userId, ticker, url, `${ticker}_${docKind}_${slug}`);
  return r.ok ? "saved" : "failed";
}

async function savePeriodicSecFiling(
  userId: string,
  ticker: string,
  form: string,
  periodLabel: string,
  url: string
): Promise<"saved" | "skipped" | "failed"> {
  const r = await upsertDocumentFromUrl(
    userId,
    ticker,
    url,
    periodicSecFilingFilenameBase(ticker, form, periodLabel)
  );
  return r.ok ? "saved" : "failed";
}

async function saveTranscriptForPeriod(
  userId: string,
  ticker: string,
  filing: PresentedFiling,
  ix: IxbrlBatchJson | null,
  roicSymbol?: string | null
): Promise<{ outcome: "saved" | "skipped" | "failed"; error?: string }> {
  const ixbrlReportDate = ix?.selected?.reportDate ?? null;
  const reportDate = ixbrlReportDate ?? filing.reportDate ?? null;
  const roicPeriod = filingPeriodLabelToRoicPeriod(
    filing.periodLabel,
    reportDate,
    filing.filingDate
  );
  if (!roicPeriod) return { outcome: "skipped" };

  const r = await saveRoicEarningsTranscriptForPeriod(userId, ticker, {
    periodLabel: filing.periodLabel,
    roicPeriod,
    reportDate,
    filingDate: filing.filingDate ?? null,
    ixbrlReportDate,
    roicSymbol,
  });
  if (r.ok) return { outcome: "saved" };
  return { outcome: "failed", error: r.error };
}

async function discoverAndSavePresentation(
  userId: string,
  ticker: string,
  filing: PresentedFiling,
  cik: string | undefined,
  companyName: string | undefined
): Promise<"saved" | "skipped" | "failed"> {
  const period =
    roicPeriodToPresentationPeriod(
      filingPeriodLabelToRoicPeriod(filing.periodLabel, filing.reportDate, filing.filingDate)
    ) ?? filing.periodLabel.replace(/^(\d)Q/i, "Q$1 ");

  const input =
    (await resolveDiscoveryInputFromTicker(ticker, period, {
      reportDate: filing.reportDate ?? undefined,
      companyName: companyName ?? undefined,
      cik: cik ?? undefined,
    })) ?? null;

  if (!input?.cik) return "skipped";

  try {
    const result = await discoverManagementPresentation(input, { userId, save: true });
    if (result.ok && (result.savedDocument != null || result.best?.url)) return "saved";
    return "skipped";
  } catch {
    return "failed";
  }
}

export async function runPeriodFinancialsBatchSaveOnServer(
  userId: string,
  opts: {
    ticker: string;
    filings: PeriodFinancialsFilingLabelRow[];
    companyName?: string;
    cik?: string;
    quarterCount?: number;
    internalBaseUrl: string;
    /** Roic quote symbol override for transcript RQL (e.g. GEL US for GEN). */
    roicSymbol?: string | null;
    onProgress?: (p: PeriodFinancialsBatchSaveProgress) => void;
  }
): Promise<PeriodFinancialsBatchSaveResult> {
  const tk = opts.ticker.trim().toUpperCase();
  const periods = selectLastNPeriodFinancialsFilings(
    opts.filings,
    opts.quarterCount ?? PERIOD_FINANCIALS_BATCH_QUARTER_COUNT
  ) as PresentedFiling[];

  const total = periods.length * PERIOD_FINANCIALS_BATCH_STEPS_PER_PERIOD;
  let done = 0;
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  const tick = (label: string, detail: string) => {
    opts.onProgress?.({ done, total, label, detail });
  };

  for (const filing of periods) {
    const periodLabel = filing.periodLabel;

    let ix: IxbrlBatchJson | null = null;
    try {
      ix = await fetchIxbrlNarrativeBundle(tk, filing.accessionNumber);
    } catch (e) {
      errors.push(`${periodLabel} narrative fetch: ${e instanceof Error ? e.message : "failed"}`);
    }

    tick(periodLabel, "Press release (8-K)");
    const pressUrl = ix?.ok !== false ? earningsReleaseUrl(ix ?? {}) : null;
    if (pressUrl) {
      const o = await saveUrlWithPeriod(userId, tk, pressUrl, "press-release-8K", periodLabel);
      if (o === "saved") saved++;
      else if (o === "failed") {
        failed++;
        errors.push(`${periodLabel} press release: save failed`);
      } else skipped++;
    } else skipped++;
    done++;
    await sleep(PERIOD_FINANCIALS_BATCH_SEC_PACE_MS);

    tick(periodLabel, "Management presentation");
    const mgmtUrl = ix?.ok !== false ? managementPresentationUrl(ix ?? {}) : null;
    if (mgmtUrl) {
      const o = await saveUrlWithPeriod(userId, tk, mgmtUrl, "mgmt-presentation", periodLabel);
      if (o === "saved") saved++;
      else if (o === "failed") {
        failed++;
        errors.push(`${periodLabel} mgmt presentation: save failed`);
      } else skipped++;
    } else {
      const o = await discoverAndSavePresentation(userId, tk, filing, opts.cik, opts.companyName);
      if (o === "saved") saved++;
      else if (o === "failed") {
        failed++;
        errors.push(`${periodLabel} mgmt presentation: discovery failed`);
      } else skipped++;
    }
    done++;
    await sleep(PERIOD_FINANCIALS_BATCH_SEC_PACE_MS);

    tick(periodLabel, "Earnings transcript");
    {
      const tr = await saveTranscriptForPeriod(userId, tk, filing, ix, opts.roicSymbol);
      if (tr.outcome === "saved") saved++;
      else if (tr.outcome === "failed") {
        failed++;
        errors.push(`${periodLabel} transcript: ${tr.error ?? "Roic fetch/save failed"}`);
      } else skipped++;
    }
    done++;
    await sleep(PERIOD_FINANCIALS_BATCH_SEC_PACE_MS);

    tick(periodLabel, `${filing.form} (MD&A & debt footnotes)`);
    const periodicUrl = secPrimaryDocUrl(
      opts.cik ?? ix?.cik,
      filing.accessionNumber,
      filing.primaryDocument ?? ix?.selected?.primaryDocument
    );
    if (periodicUrl) {
      const o = await savePeriodicSecFiling(userId, tk, filing.form, periodLabel, periodicUrl);
      if (o === "saved") saved++;
      else if (o === "failed") {
        failed++;
        errors.push(`${periodLabel} SEC filing: save failed`);
      } else skipped++;
    } else skipped++;
    done++;
    await sleep(PERIOD_FINANCIALS_BATCH_SEC_PACE_MS);
  }

  opts.onProgress?.({ done: total, total, label: "Complete", detail: "" });
  return { saved, skipped, failed, errors };
}
