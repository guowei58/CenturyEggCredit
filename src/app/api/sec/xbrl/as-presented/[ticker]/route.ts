import { NextResponse } from "next/server";
import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import { fetchAsPresentedStatements } from "@/lib/sec-xbrl-as-presented";
import {
  findPresentedFilingByAccession,
  prepareBulkPresentedFilings,
} from "@/lib/sec-xbrl-as-presented-save-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const url = new URL(req.url);
  const acc = (url.searchParams.get("acc") ?? "").trim();
  const formHint = (url.searchParams.get("form") ?? "").trim();
  const primaryDocumentHint = (url.searchParams.get("primaryDocument") ?? "").trim();

  const filingsRes = await getAllFilingsByTicker(sym);
  if (!filingsRes) return NextResponse.json({ error: "SEC submissions not found for ticker" }, { status: 404 });

  const filings = prepareBulkPresentedFilings(filingsRes.filings);

  /** Newest-first; default to latest 10-K or 10-Q. */
  let chosen = acc ? findPresentedFilingByAccession(filings, acc) : (filings[0] ?? null);
  if (!chosen && formHint && primaryDocumentHint) {
    chosen = filings.find((f) => f.form === formHint && f.primaryDocument === primaryDocumentHint) ?? null;
  }

  if (!chosen) {
    return NextResponse.json({ error: "No 10-K/10-Q filings found" }, { status: 404 });
  }

  try {
    const stmt = await fetchAsPresentedStatements({
      cik: filingsRes.cik,
      accessionNumber: chosen.accessionNumber,
      form: chosen.form,
      filingDate: chosen.filingDate,
    });

    return NextResponse.json({
      ok: true,
      ticker: sym,
      cik: filingsRes.cik,
      companyName: filingsRes.companyName,
      filings: filings.map((f) => ({
        form: f.form,
        filingDate: f.filingDate,
        accessionNumber: f.accessionNumber,
        primaryDocument: f.primaryDocument,
      })),
      selected: {
        form: chosen.form,
        filingDate: chosen.filingDate,
        accessionNumber: chosen.accessionNumber,
      },
      statements: stmt.statements,
      validation: stmt.validation,
      selfDiagnosticChecklist: stmt.selfDiagnosticChecklist,
      calculationLinkbaseLoaded: stmt.calculationLinkbaseLoaded,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load XBRL statements";
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        ticker: sym,
        cik: filingsRes.cik,
        companyName: filingsRes.companyName,
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

