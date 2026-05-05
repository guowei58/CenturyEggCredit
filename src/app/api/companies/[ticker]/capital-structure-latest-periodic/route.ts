import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { SEC_REQUEST_GAP_MS } from "@/lib/debt-map/constants";
import { loadPriorDebtNotePatternsForCik } from "@/lib/secDebtFootnote/priorPatterns";
import { extractDebtCapitalTables, type DebtSectionExtractResult } from "@/lib/secDebtSectionExtract";
import { getAllFilingsByCik, getCikFromTicker, getSecEdgarUserAgent, type SecFiling } from "@/lib/sec-edgar";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickLatestExactForm(filings: SecFiling[], exactForm: string): SecFiling | null {
  for (const f of filings) {
    if (f.form.trim() === exactForm) return f;
  }
  return null;
}

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

type FilingPayload = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  docUrl: string;
  extract: DebtSectionExtractResult;
};

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = (await params).ticker?.trim().toUpperCase() ?? "";
  if (!raw) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const cik = await getCikFromTicker(raw);
  if (!cik) return NextResponse.json({ error: "Could not resolve ticker to CIK" }, { status: 404 });

  let priorDebtPatterns: Awaited<ReturnType<typeof loadPriorDebtNotePatternsForCik>> = [];
  try {
    priorDebtPatterns = await loadPriorDebtNotePatternsForCik(cik);
  } catch {
    priorDebtPatterns = [];
  }

  const bundle = await getAllFilingsByCik(cik, { paceChunkMs: SEC_REQUEST_GAP_MS });
  if (!bundle?.filings.length) {
    return NextResponse.json({ error: "No SEC filings found for CIK" }, { status: 404 });
  }

  const tenK = pickLatestExactForm(bundle.filings, "10-K");
  const tenQ = pickLatestExactForm(bundle.filings, "10-Q");

  let tenKPayload: FilingPayload | null = null;
  let tenQPayload: FilingPayload | null = null;

  if (tenK) {
    const html = await fetchPrimaryHtml(tenK.docUrl);
    const extract = html
      ? await extractDebtCapitalTables(html, "10-K", {
          filingDate: tenK.filingDate,
          accessionNumber: tenK.accessionNumber,
          cik,
          ticker: raw,
          fetchSecArchiveText: fetchPrimaryHtml,
          priorDebtPatterns,
        })
      : emptyExtract("Primary document download failed.");
    tenKPayload = {
      form: tenK.form,
      filingDate: tenK.filingDate,
      accessionNumber: tenK.accessionNumber,
      primaryDocument: tenK.primaryDocument,
      docUrl: tenK.docUrl,
      extract,
    };
  }

  await sleep(SEC_REQUEST_GAP_MS);

  if (tenQ) {
    const html = await fetchPrimaryHtml(tenQ.docUrl);
    const extract = html
      ? await extractDebtCapitalTables(html, "10-Q", {
          filingDate: tenQ.filingDate,
          accessionNumber: tenQ.accessionNumber,
          cik,
          ticker: raw,
          fetchSecArchiveText: fetchPrimaryHtml,
          priorDebtPatterns,
        })
      : emptyExtract("Primary document download failed.");
    tenQPayload = {
      form: tenQ.form,
      filingDate: tenQ.filingDate,
      accessionNumber: tenQ.accessionNumber,
      primaryDocument: tenQ.primaryDocument,
      docUrl: tenQ.docUrl,
      extract,
    };
  }

  return NextResponse.json({
    ticker: raw,
    cik,
    companyName: bundle.companyName,
    tenK: tenKPayload,
    tenQ: tenQPayload,
    message:
      !tenK && !tenQ
        ? "No exact 10-K or 10-Q filing found (amended-only history search may be needed)."
        : undefined,
  });
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
