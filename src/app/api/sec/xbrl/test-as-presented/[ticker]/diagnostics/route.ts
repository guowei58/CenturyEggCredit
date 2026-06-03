import { NextResponse } from "next/server";
import { runTestFaceDiagnostics } from "@/lib/sec-ixbrl-face-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** HTML-face extraction per filing is slower than XBRL index loads — allow a long sweep. */
export const maxDuration = 300;

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const url = new URL(req.url);
  const max = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get("max") ?? "30", 10) || 30));
  const sinceYearRaw = url.searchParams.get("sinceYear") ?? url.searchParams.get("minYear");
  let minFilingYear: number | undefined;
  if (sinceYearRaw) {
    const y = Number.parseInt(sinceYearRaw, 10);
    if (Number.isFinite(y) && y >= 1900) minFilingYear = y;
  }

  try {
    const result = await runTestFaceDiagnostics(sym, { maxFilings: max, minFilingYear });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to run diagnostics";
    return NextResponse.json({ ok: false, error: msg, ticker: sym }, { status: 500 });
  }
}
