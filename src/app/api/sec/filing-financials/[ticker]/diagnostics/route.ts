import { NextResponse } from "next/server";
import { runSecFilingFinancialsDiagnostics } from "@/lib/sec-filing-financials-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const url = new URL(req.url);
  const max = Math.max(1, Math.min(80, Number.parseInt(url.searchParams.get("max") ?? "30", 10) || 30));

  try {
    const result = await runSecFilingFinancialsDiagnostics(sym, max);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to run diagnostics";
    return NextResponse.json({ ok: false, error: msg, ticker: sym }, { status: 500 });
  }
}
