import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveRoicEarningsTranscriptForPeriod } from "@/lib/period-financials-transcript-save";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ ok: false, error: "Invalid ticker" }, { status: 400 });
  }

  let body: {
    periodLabel?: unknown;
    roicPeriod?: unknown;
    reportDate?: unknown;
    filingDate?: unknown;
    ixbrlReportDate?: unknown;
    roicSymbol?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const periodLabel = typeof body.periodLabel === "string" ? body.periodLabel.trim() : "";
  if (!periodLabel) {
    return NextResponse.json({ ok: false, error: "periodLabel is required." }, { status: 400 });
  }

  const result = await saveRoicEarningsTranscriptForPeriod(userId, sym, {
    periodLabel,
    roicPeriod: typeof body.roicPeriod === "string" ? body.roicPeriod.trim() : null,
    reportDate: typeof body.reportDate === "string" ? body.reportDate.trim() : null,
    filingDate: typeof body.filingDate === "string" ? body.filingDate.trim() : null,
    ixbrlReportDate: typeof body.ixbrlReportDate === "string" ? body.ixbrlReportDate.trim() : null,
    roicSymbol:
      (typeof body.roicSymbol === "string" ? body.roicSymbol.trim() : "") ||
      process.env.ROIC_AI_SYMBOL_OVERRIDE?.trim() ||
      null,
  });

  if (!result.ok) {
    const status = result.error.includes("ROIC_AI_API_KEY")
      ? 503
      : result.error.includes("Invalid ticker") || result.error.includes("period label")
        ? 400
        : 502;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, filename: result.filename });
}
