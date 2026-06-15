import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  discoverManagementPresentation,
  parseFiscalPeriodToken,
  resolveDiscoveryInputFromTicker,
  roicPeriodToPresentationPeriod,
} from "@/lib/presentations/discovery";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * GET /api/presentations/discover/[ticker]?period=Q3%202025&earningsDate=2025-11-05&reportDate=2025-09-30&cik=...&companyName=...&save=1
 *
 * Fallback discovery when the earnings 8-K has no embedded HTML slide deck.
 * Does not modify ixbrl-mdna-tables / earningsSlideDeck extraction.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: rawTicker } = await params;
  const ticker = (rawTicker ?? "").trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Ticker required" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const periodRaw =
    searchParams.get("period")?.trim() ||
    roicPeriodToPresentationPeriod(searchParams.get("roicPeriod")) ||
    "";
  if (!periodRaw || !parseFiscalPeriodToken(periodRaw)) {
    return NextResponse.json(
      { ok: false, error: "Valid fiscal period required (e.g. Q3 2025 or 2025Q3)" },
      { status: 400 }
    );
  }

  const input =
    (await resolveDiscoveryInputFromTicker(ticker, periodRaw, {
      earningsDate: searchParams.get("earningsDate"),
      reportDate: searchParams.get("reportDate"),
      companyName: searchParams.get("companyName") ?? undefined,
      cik: searchParams.get("cik") ?? undefined,
    })) ?? null;

  if (!input?.cik) {
    return NextResponse.json({ ok: false, error: "Could not resolve company CIK" }, { status: 404 });
  }

  const save = searchParams.get("save") !== "0";

  try {
    const result = await discoverManagementPresentation(input, { userId, save });
    return NextResponse.json({
      ok: result.ok,
      best: result.best,
      savedDocument: result.savedDocument ?? null,
      metadata: {
        discoveredAt: result.metadata.discoveredAt,
        input: result.metadata.input,
        candidatesConsidered: result.metadata.candidatesConsidered,
        candidatesValidated: result.metadata.candidatesValidated,
        irDomains: result.metadata.irDomains,
        adapterCounts: result.metadata.adapterCounts,
        allCandidates: result.metadata.allCandidates.map((c) => ({
          title: c.title,
          url: c.url,
          source_type: c.source_type,
          confidence: c.confidence,
          review_status: c.review_status,
        })),
      },
      error: result.error ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Discovery failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
