import { NextResponse } from "next/server";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import {
  findPresentedFilingByAccession,
  prepareBulkPresentedFilings,
} from "@/lib/sec-xbrl-as-presented-save-client";
import { getAllFilingsByTickerCached, peekCachedFilingsByTicker } from "@/lib/sec-submissions-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Large 10-K HTML (e.g. GEN Part IV exhibits) can exceed 60s on cold starts. */
export const maxDuration = 180;

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const url = new URL(req.url);
  const acc = (url.searchParams.get("acc") ?? "").trim();
  const formHint = (url.searchParams.get("form") ?? "").trim();
  const primaryDocumentHint = (url.searchParams.get("primaryDocument") ?? "").trim();
  const skipSubmissions = url.searchParams.get("skipSubmissions") === "1";

  let filingsRes = skipSubmissions ? peekCachedFilingsByTicker(sym) : null;
  if (!filingsRes) {
    filingsRes = await getAllFilingsByTickerCached(sym);
  }
  if (!filingsRes) return NextResponse.json({ error: "SEC submissions not found for ticker" }, { status: 404 });

  const filings = prepareBulkPresentedFilings(filingsRes.filings);

  /** Newest-first list; default selection is the latest 10-K or 10-Q. */
  let chosen = acc ? findPresentedFilingByAccession(filings, acc) : filings[0];
  if (!chosen && formHint && primaryDocumentHint) {
    chosen = filings.find((f) => f.form === formHint && f.primaryDocument === primaryDocumentHint);
  }

  if (!chosen) {
    return NextResponse.json({ error: "No 10-K/10-Q filings found" }, { status: 404 });
  }

  try {
    const result = await fetchFacePresentedStatements({
      cik: filingsRes.cik,
      accessionNumber: chosen.accessionNumber,
      form: chosen.form,
      filingDate: chosen.filingDate,
      primaryDocument: chosen.primaryDocument,
      docUrl: chosen.docUrl,
    });

    return NextResponse.json({
      ok: true,
      ticker: sym,
      cik: filingsRes.cik,
      companyName: filingsRes.companyName,
      extractionMethod: "html_table_ixbrl",
      ...(skipSubmissions
        ? {}
        : {
            filings: filings.map((f) => ({
              form: f.form,
              filingDate: f.filingDate,
              accessionNumber: f.accessionNumber,
              primaryDocument: f.primaryDocument,
            })),
          }),
      selected: {
        form: chosen.form,
        filingDate: chosen.filingDate,
        accessionNumber: chosen.accessionNumber,
      },
      statements: result.statements,
      validation: result.validation,
      extractionQa: result.extractionQa,
      calculationLinkbaseLoaded: result.calculationLinkbaseLoaded,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load HTML-face statements";
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        ticker: sym,
        cik: filingsRes.cik,
        companyName: filingsRes.companyName,
        extractionMethod: "html_table_ixbrl",
        filings: filings.map((f) => ({
          form: f.form,
          filingDate: f.filingDate,
          accessionNumber: f.accessionNumber,
          primaryDocument: f.primaryDocument,
        })),
        selected: chosen,
        statements: [],
      },
      { status: 502 }
    );
  }
}
