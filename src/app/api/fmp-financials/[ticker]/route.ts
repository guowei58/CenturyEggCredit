import { NextResponse } from "next/server";
import {
  collectLineItemKeys,
  fetchStatementsForSymbol,
  formatCell,
  formatLineItemLabel,
  periodLabelAnnual,
  periodLabelQuarter,
  type FmpStatementRecord,
} from "@/lib/fmp-financials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function buildTablePayload(title: string, rows: FmpStatementRecord[], periodLabel: (r: FmpStatementRecord) => string) {
  const labels = rows.map(periodLabel);
  const keys = collectLineItemKeys(rows);
  const lineItems = keys.map((key) => ({
    key,
    label: formatLineItemLabel(key),
    values: rows.map((r) => formatCell(r[key])),
  }));
  return { title, periodLabels: labels, lineItems };
}

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "FMP_API_KEY is not configured. Add it to .env.local (see .env.example)." },
      { status: 503 }
    );
  }

  try {
    const data = await fetchStatementsForSymbol(sym, apiKey);

    const payload = {
      symbol: sym,
      incomeStatement: {
        annual: buildTablePayload("Income statement — annual (FY 2017–2019)", data.incomeAnnual, periodLabelAnnual),
        quarterly: buildTablePayload("Income statement — quarterly (2020–2025)", data.incomeQuarter, periodLabelQuarter),
      },
      balanceSheet: {
        annual: buildTablePayload("Balance sheet — annual (FY 2017–2019)", data.balanceAnnual, periodLabelAnnual),
        quarterly: buildTablePayload("Balance sheet — quarterly (2020–2025)", data.balanceQuarter, periodLabelQuarter),
      },
      cashFlow: {
        annual: buildTablePayload("Cash flow statement — annual (FY 2017–2019)", data.cashAnnual, periodLabelAnnual),
        quarterly: buildTablePayload("Cash flow statement — quarterly (2020–2025)", data.cashQuarter, periodLabelQuarter),
      },
      meta: {
        annualYears: "2017-2019",
        quarterlyYears: "2020-2025",
        source: "Financial Modeling Prep",
      },
    };

    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load financials from FMP";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
