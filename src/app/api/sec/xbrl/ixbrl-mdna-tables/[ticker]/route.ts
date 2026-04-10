import { NextResponse } from "next/server";
import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import { fetchIxbrlMdnaTablesFromFiling } from "@/lib/sec-ixbrl-mdna-tables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const url = new URL(req.url);
  const acc = (url.searchParams.get("acc") ?? "").trim();

  const filingsRes = await getAllFilingsByTicker(sym);
  if (!filingsRes) return NextResponse.json({ error: "SEC submissions not found for ticker" }, { status: 404 });

  const cutoffYear = new Date().getFullYear() - 20;
  const filings = filingsRes.filings
    .filter((f) => f.form === "10-K" || f.form === "10-Q")
    .filter((f) => {
      const y = parseInt((f.filingDate ?? "").slice(0, 4), 10);
      return Number.isFinite(y) ? y >= cutoffYear : true;
    })
    .slice(0, 600);

  const chosen =
    (acc
      ? filings.find((f) => f.accessionNumber === acc)
      : filings.find((f) => f.form === "10-K") ?? filings[0]) ?? null;

  if (!chosen) {
    return NextResponse.json({ error: "No 10-K/10-Q filings found" }, { status: 404 });
  }

  const primaryDocument = (chosen.primaryDocument ?? "").trim();
  if (!primaryDocument) {
    return NextResponse.json({ ok: false, error: "Filing has no primary document path" }, { status: 400 });
  }

  const extracted = await fetchIxbrlMdnaTablesFromFiling({
    cik: filingsRes.cik,
    accessionNumber: chosen.accessionNumber,
    primaryDocument,
    form: chosen.form,
  });

  if (!extracted.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: extracted.error,
        ticker: sym,
        cik: filingsRes.cik,
        companyName: filingsRes.companyName,
        selected: {
          form: chosen.form,
          filingDate: chosen.filingDate,
          accessionNumber: chosen.accessionNumber,
          primaryDocument,
        },
        mdnaHeadingFound: false,
        segmentHeadingFound: false,
        mdnaTableHit: false,
        tables: [],
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    ticker: sym,
    cik: filingsRes.cik,
    companyName: filingsRes.companyName,
    selected: {
      form: chosen.form,
      filingDate: chosen.filingDate,
      accessionNumber: chosen.accessionNumber,
      primaryDocument,
    },
    primaryDocument: extracted.primaryDocument,
    mdnaHeadingFound: extracted.mdnaHeadingFound,
    segmentHeadingFound: extracted.segmentHeadingFound,
    mdnaTableHit: extracted.mdnaTableHit,
    tables: extracted.tables,
  });
}
