import { SEC_REQUEST_GAP_MS } from "@/lib/debt-map/constants";
import { loadPriorDebtNotePatternsForCik } from "@/lib/secDebtFootnote/priorPatterns";
import { extractDebtCapitalTables, type DebtSectionExtractResult } from "@/lib/secDebtSectionExtract";
import {
  debtFootnoteHasDisplayHtml,
  shouldRollForwardDebtFrom10K,
  type DebtFootnoteRollForward,
} from "@/lib/debt-footnote-display";
import {
  fetchEdgarPrimaryDocumentHtml,
  getSecEdgarUserAgent,
  type SecFiling,
} from "@/lib/sec-edgar";

export type DebtFootnoteFilingExtract = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  docUrl: string;
  extract: DebtSectionExtractResult;
};

async function fetchPrimaryHtml(docUrl: string): Promise<string | null> {
  try {
    const res = await fetch(docUrl.trim(), {
      headers: { "User-Agent": getSecEdgarUserAgent() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function emptyExtract(note: string): DebtSectionExtractResult {
  return {
    anchorLabel: null,
    anchorIndexInFullDoc: 0,
    tablesHtml: "",
    plainTextFallback: "",
    note,
    debtNoteTitle: null,
    noteNumber: null,
    confidence: "Not Found",
    extractionMethod: "direct_heading_match",
    extractedFootnoteText: "",
    extractedFootnoteHtml: "",
    debtTablesMarkdown: [],
    startHeading: null,
    endHeading: null,
    warnings: [note],
    candidates: [],
    htmlStartOffset: 0,
    htmlEndOffset: 0,
    financialStatementNotes: [],
  };
}

function pickLatest10KOnOrBefore(filings: SecFiling[], beforeFilingDate: string): SecFiling | null {
  const cutoff = (beforeFilingDate ?? "").trim().slice(0, 10);
  if (!cutoff) return null;
  for (const f of filings) {
    if (f.form !== "10-K") continue;
    if ((f.filingDate ?? "").slice(0, 10) <= cutoff) return f;
  }
  return null;
}

export async function extractDebtFootnoteForFiling(opts: {
  cik: string;
  ticker: string;
  filing: SecFiling;
  allFilings?: SecFiling[];
  allow10KRollForward?: boolean;
}): Promise<{ filing: DebtFootnoteFilingExtract; rollForward?: DebtFootnoteRollForward }> {
  const { cik, ticker, filing } = opts;
  const primaryDocument = (filing.primaryDocument ?? "").trim();
  const periodicForm = filing.form === "10-K" ? "10-K" : "10-Q";

  let priorDebtPatterns: Awaited<ReturnType<typeof loadPriorDebtNotePatternsForCik>> = [];
  try {
    priorDebtPatterns = await loadPriorDebtNotePatternsForCik(cik);
  } catch {
    priorDebtPatterns = [];
  }

  const html =
    (await fetchEdgarPrimaryDocumentHtml(cik, filing)) ?? (await fetchPrimaryHtml(filing.docUrl));

  let extract = html
    ? await extractDebtCapitalTables(html, periodicForm, {
        filingDate: filing.filingDate,
        accessionNumber: filing.accessionNumber,
        cik,
        ticker,
        fetchSecArchiveText: fetchPrimaryHtml,
        priorDebtPatterns,
      })
    : emptyExtract("Primary document download failed.");

  let rollForward: DebtFootnoteRollForward | undefined;

  if (
    opts.allow10KRollForward !== false &&
    opts.allFilings?.length &&
    shouldRollForwardDebtFrom10K(filing.form, extract)
  ) {
    const tenK = pickLatest10KOnOrBefore(opts.allFilings, filing.filingDate);
    if (tenK && tenK.accessionNumber !== filing.accessionNumber) {
      await new Promise((r) => setTimeout(r, SEC_REQUEST_GAP_MS));
      const tenKHtml =
        (await fetchEdgarPrimaryDocumentHtml(cik, tenK)) ?? (await fetchPrimaryHtml(tenK.docUrl));
      if (tenKHtml) {
        const tenKExtract = await extractDebtCapitalTables(tenKHtml, "10-K", {
          filingDate: tenK.filingDate,
          accessionNumber: tenK.accessionNumber,
          cik,
          ticker,
          fetchSecArchiveText: fetchPrimaryHtml,
          priorDebtPatterns,
        });
        if (debtFootnoteHasDisplayHtml(tenKExtract)) {
          extract = {
            ...tenKExtract,
            warnings: [
              ...tenKExtract.warnings,
              `Debt footnote rolled forward from annual 10-K filed ${tenK.filingDate.slice(0, 10)} — selected 10-Q has no standalone debt note.`,
            ],
            note: `${tenKExtract.note} Rolled forward from 10-K (${tenK.filingDate.slice(0, 10)}).`,
          };
          rollForward = {
            sourceForm: "10-K",
            sourceFilingDate: tenK.filingDate,
            sourceAccessionNumber: tenK.accessionNumber,
            sourceDocUrl: tenK.docUrl,
          };
        }
      }
    }
  }

  return {
    filing: {
      form: filing.form,
      filingDate: filing.filingDate,
      accessionNumber: filing.accessionNumber,
      primaryDocument,
      docUrl: filing.docUrl,
      extract,
    },
    rollForward,
  };
}
