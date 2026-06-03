import { getAllFilingsByTicker, rankEarningsAdjacent8KFilings } from "@/lib/sec-edgar";
import { fetchIxbrlMdnaTablesFromFiling } from "@/lib/sec-ixbrl-mdna-tables";
import {
  runIxbrlNarrativeSelfDiagnostics,
  type NarrativeDiagFinding,
} from "@/lib/sec-ixbrl-narrative-self-diagnostics";

export type RunSecXbrlNarrativeBatchDiagnosticsOptions = {
  maxFilings?: number;
  /** Inclusive lower bound on `filingDate` calendar year. */
  minFilingYear?: number;
};

export type NarrativeBatchDiagnosticFailure = {
  accessionNumber: string;
  filingDate: string;
  form: string;
  issues: string[];
  loadError?: string;
  mdnaOk: boolean;
  earningsOk: boolean;
  mdnaFindings: NarrativeDiagFinding[];
  earningsFindings: NarrativeDiagFinding[];
};

export type SecXbrlNarrativeBatchDiagnosticsResult = {
  ticker: string;
  checked: number;
  suspicious: number;
  failures: NarrativeBatchDiagnosticFailure[];
  minFilingYear?: number;
  maxFilingsRequested?: number;
};

function normalizeArgs(
  maxFilingsOrOpts: number | RunSecXbrlNarrativeBatchDiagnosticsOptions,
): { maxFilings: number; minFilingYear?: number } {
  if (typeof maxFilingsOrOpts === "number") {
    return { maxFilings: maxFilingsOrOpts };
  }
  return {
    maxFilings: maxFilingsOrOpts.maxFilings ?? 30,
    minFilingYear: maxFilingsOrOpts.minFilingYear,
  };
}

function buildIssuesFromRow(row: Omit<NarrativeBatchDiagnosticFailure, "issues">): string[] {
  const issues: string[] = [];
  if (row.loadError) issues.push(row.loadError);
  for (const f of row.mdnaFindings) {
    if (f.severity === "warn") issues.push(`MD&A: ${f.message}`);
  }
  for (const f of row.earningsFindings) {
    if (f.severity === "warn") issues.push(`Earnings: ${f.message}`);
  }
  return issues;
}

/**
 * For each 10-K/10-Q (same filing sweep as financials self-diagnostic), loads primary inline XBRL HTML via
 * {@link fetchIxbrlMdnaTablesFromFiling} and runs {@link runIxbrlNarrativeSelfDiagnostics} with batch earnings linkage
 * (adjacent 8-K count only — no Exhibit 99 fetches).
 */
export async function runSecXbrlNarrativeBatchDiagnostics(
  ticker: string,
  maxFilingsOrOpts: number | RunSecXbrlNarrativeBatchDiagnosticsOptions = 30,
): Promise<SecXbrlNarrativeBatchDiagnosticsResult> {
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) throw new Error("Ticker required");
  const { maxFilings, minFilingYear } = normalizeArgs(maxFilingsOrOpts);

  /**
   * Same scope as `/api/sec/xbrl/ixbrl-mdna-tables/`: submissions must include Form 8-K rows so
   * {@link rankEarningsAdjacent8KFilings} can see earnings candidates. (Filtering to 10-K/10-Q only makes every
   * `adjacent8kCandidates` count zero while the single-filing API still resolves press releases.)
   */
  const res = await getAllFilingsByTicker(sym, {
    mergePredecessorIssuers: true,
  });
  if (!res) throw new Error(`Ticker not found: ${sym}`);

  const filingsForRanking = res.filings;

  let periodicFilings = res.filings.filter((f) => {
    const form = (f.form ?? "").trim().toUpperCase();
    return form === "10-K" || form === "10-Q";
  });
  if (minFilingYear != null) {
    periodicFilings = periodicFilings.filter((f) => {
      const y = parseInt((f.filingDate ?? "").slice(0, 4), 10);
      return Number.isFinite(y) && y >= minFilingYear;
    });
  }
  periodicFilings = periodicFilings.slice(0, maxFilings);

  const failures: NarrativeBatchDiagnosticFailure[] = [];

  for (const filing of periodicFilings) {
    const primaryDocument = (filing.primaryDocument ?? "").trim();
    if (!primaryDocument) {
      failures.push({
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        form: filing.form,
        issues: ["Filing has no primary document path"],
        loadError: "Filing has no primary document path",
        mdnaOk: false,
        earningsOk: false,
        mdnaFindings: [],
        earningsFindings: [],
      });
      continue;
    }

    let extracted;
    try {
      extracted = await fetchIxbrlMdnaTablesFromFiling({
        cik: res.cik,
        accessionNumber: filing.accessionNumber,
        primaryDocument,
        form: filing.form,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown MD&A fetch error";
      failures.push({
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        form: filing.form,
        issues: [msg],
        loadError: msg,
        mdnaOk: false,
        earningsOk: false,
        mdnaFindings: [],
        earningsFindings: [],
      });
      continue;
    }

    if (!extracted.ok) {
      failures.push({
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        form: filing.form,
        issues: [extracted.error],
        loadError: extracted.error,
        mdnaOk: false,
        earningsOk: false,
        mdnaFindings: [],
        earningsFindings: [],
      });
      continue;
    }

    const periodicForm = (filing.form ?? "").trim().toUpperCase();
    const reportDate = (filing.reportDate ?? "").trim();
    const usePeriodEnd =
      (periodicForm === "10-Q" || periodicForm === "10-K") && /^\d{4}-\d{2}-\d{2}$/.test(reportDate.slice(0, 10));
    const anchorDate = usePeriodEnd ? reportDate : filing.filingDate;
    const ranked = rankEarningsAdjacent8KFilings(filingsForRanking, anchorDate, { anchorIsPeriodEnd: usePeriodEnd });

    const narrative = runIxbrlNarrativeSelfDiagnostics({
      ok: true,
      mdnaHeadingFound: extracted.mdnaHeadingFound,
      mdnaSectionHtml: extracted.mdnaSectionHtml,
      mdnaSectionHtmlTruncated: extracted.mdnaSectionHtmlTruncated,
      diagnostics: extracted.diagnostics,
      ebitdaReconciliation: extracted.ebitdaReconciliation,
      selected: { form: filing.form },
      batchEarnings: { adjacent8kCandidates: ranked.length },
    });

    if (!narrative.mdnaOk || !narrative.earningsOk) {
      const base: Omit<NarrativeBatchDiagnosticFailure, "issues"> = {
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        form: filing.form,
        mdnaOk: narrative.mdnaOk,
        earningsOk: narrative.earningsOk,
        mdnaFindings: narrative.mdna.findings,
        earningsFindings: narrative.earningsPressRelease.findings,
      };
      failures.push({ ...base, issues: buildIssuesFromRow(base) });
    }
  }

  return {
    ticker: sym,
    checked: periodicFilings.length,
    suspicious: failures.length,
    failures,
    ...(minFilingYear != null ? { minFilingYear } : {}),
    maxFilingsRequested: maxFilings,
  };
}
