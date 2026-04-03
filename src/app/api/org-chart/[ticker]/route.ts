import { NextResponse } from "next/server";
import { getFilingsByTicker } from "@/lib/sec-edgar";
import { extractOrgChartFromFilingText } from "@/lib/org-chart-extract";
import type { OrgChartApiResponse } from "@/lib/org-chart-types";

const USER_AGENT = "CenturyEggCredit research app (mailto:support@example.com)";

function is10K(form: string): boolean {
  const u = form.trim().toUpperCase();
  return u === "10-K" || u === "10-K/A";
}

function is10Q(form: string): boolean {
  const u = form.trim().toUpperCase();
  return u === "10-Q" || u === "10-Q/A";
}

/**
 * Fetch SEC document content server-side (sec.gov only).
 */
async function fetchSecDocument(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * GET /api/org-chart/[ticker]
 * 1. Resolve ticker → company name and filings (SEC).
 * 2. Find latest 10-K or 10-Q.
 * 3. Fetch that filing's primary document content.
 * 4. Extract org structure from text (ticker-agnostic).
 * 5. Return OrgChartData or insufficient/error.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
): Promise<NextResponse<OrgChartApiResponse | { error: string }>> {
  const { ticker } = await params;
  const safeTicker = ticker?.trim();
  if (!safeTicker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  try {
    const filingsResult = await getFilingsByTicker(safeTicker);
    if (!filingsResult || !filingsResult.filings?.length) {
      return NextResponse.json({
        ok: false,
        insufficient: true,
        message: "Company not found or no filings available for this ticker.",
      } satisfies OrgChartApiResponse);
    }

    const companyName = filingsResult.companyName;
    const filings = filingsResult.filings;

    const tenK = filings.find((f) => is10K(f.form));
    const tenQ = filings.find((f) => is10Q(f.form));
    const primaryFiling = tenK ?? tenQ;
    if (!primaryFiling?.docUrl) {
      return NextResponse.json({
        ok: false,
        insufficient: true,
        message: "No 10-K or 10-Q found in recent filings. Org chart requires annual or quarterly report.",
      } satisfies OrgChartApiResponse);
    }

    const rawText = await fetchSecDocument(primaryFiling.docUrl);
    if (!rawText || rawText.length < 500) {
      return NextResponse.json({
        ok: false,
        insufficient: true,
        message: "Could not retrieve or parse filing content. Document may be unavailable or in an unsupported format.",
      } satisfies OrgChartApiResponse);
    }

    const data = extractOrgChartFromFilingText(companyName, safeTicker.toUpperCase(), rawText);
    if (!data) {
      return NextResponse.json({
        ok: false,
        insufficient: true,
        message: "Insufficient source data to build org chart from the current filing text.",
      } satisfies OrgChartApiResponse);
    }

    return NextResponse.json({ ok: true, data } satisfies OrgChartApiResponse);
  } catch (e) {
    console.error("Org chart pipeline error:", e);
    return NextResponse.json({
      ok: false,
      error: "Failed to build org chart for this ticker.",
    } satisfies OrgChartApiResponse);
  }
}
