import { NextResponse } from "next/server";
import { fetchAnnualNetIncomeHistory } from "@/lib/fmp-financials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FMP_INCOME_DOCS = "https://site.financialmodelingprep.com/developer/docs/stable/income-statements";
const FMP_HOME = "https://site.financialmodelingprep.com/";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ ok: false, error: "Invalid ticker" }, { status: 400 });
  }

  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "FMP_API_KEY is not configured. Add it to .env.local (see .env.example).",
      },
      { status: 503 }
    );
  }

  try {
    const { points, cik } = await fetchAnnualNetIncomeHistory(sym, apiKey, 20);

    const filingUrls = Array.from(
      new Set(points.map((p) => p.filingUrl).filter((u): u is string => Boolean(u)))
    ).slice(0, 25);

    const cikPadded = cik ? cik.replace(/\D/g, "").padStart(10, "0") : null;
    const secCompanyUrl =
      cikPadded && cikPadded !== "0000000000"
        ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikPadded}&type=10-K&count=40`
        : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=exclude&count=40&company=${encodeURIComponent(sym)}`;

    const sources = [
      {
        label: "Financial Modeling Prep — Income statement (stable API)",
        url: FMP_INCOME_DOCS,
      },
      { label: "Financial Modeling Prep", url: FMP_HOME },
      {
        label: "SEC EDGAR — company filings (10-K annual reports)",
        url: secCompanyUrl,
      },
    ];

    return NextResponse.json({
      ok: true,
      symbol: sym,
      cik: cik ?? null,
      currency: points.find((p) => p.reportedCurrency)?.reportedCurrency ?? "USD",
      points: points.map(({ fiscalYear, netIncome, reportedCurrency, filingUrl }) => ({
        fiscalYear,
        netIncome,
        reportedCurrency,
        filingUrl,
      })),
      filingUrls,
      sources,
      disclaimer:
        "Net income is the annual GAAP line item as reported in each fiscal year’s income statement (FMP field netIncome), sourced from company filings aggregated by Financial Modeling Prep. Verify against the issuer’s 10-K.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load net income history";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
