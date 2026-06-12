import { NextResponse } from "next/server";
import { extractDebtFootnoteForFiling } from "@/lib/debt-footnote-extract-filing";
import { getAllFilingsByTicker, type SecFiling } from "@/lib/sec-edgar";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const url = new URL(req.url);
  const acc = (url.searchParams.get("acc") ?? "").trim();

  const filingsRes = await getAllFilingsByTicker(sym);
  if (!filingsRes) {
    return NextResponse.json({ error: "SEC submissions not found for ticker" }, { status: 404 });
  }

  const cutoffYear = new Date().getFullYear() - 20;
  const filings = filingsRes.filings
    .filter((f) => f.form === "10-K" || f.form === "10-Q")
    .filter((f) => {
      const y = parseInt((f.filingDate ?? "").slice(0, 4), 10);
      return Number.isFinite(y) ? y >= cutoffYear : true;
    })
    .slice(0, 600);

  const chosen: SecFiling | null =
    (acc ? filings.find((f) => f.accessionNumber === acc) : filings[0]) ?? null;

  if (!chosen) {
    return NextResponse.json({ error: "No 10-K/10-Q filings found" }, { status: 404 });
  }

  const primaryDocument = (chosen.primaryDocument ?? "").trim();
  if (!primaryDocument) {
    return NextResponse.json({ error: "Filing has no primary document path" }, { status: 400 });
  }

  const { filing, rollForward } = await extractDebtFootnoteForFiling({
    cik: filingsRes.cik,
    ticker: sym,
    filing: chosen,
    allFilings: filings,
    allow10KRollForward: true,
  });

  return NextResponse.json({
    ok: true,
    ticker: sym,
    cik: filingsRes.cik,
    companyName: filingsRes.companyName,
    selected: {
      form: chosen.form,
      filingDate: chosen.filingDate,
      ...(chosen.reportDate?.trim() ? { reportDate: chosen.reportDate.trim() } : {}),
      accessionNumber: chosen.accessionNumber,
      primaryDocument,
    },
    filing,
    ...(rollForward ? { rollForward } : {}),
  });
}
