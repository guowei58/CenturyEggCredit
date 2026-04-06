import { NextResponse } from "next/server";
import {
  buildAnnualRangeQuery,
  getDefaultAnnualFieldIds,
  getRoicApiKey,
  resolveRoicSymbolForTicker,
  roicRqlRequest,
} from "@/lib/roic-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const apiKey = getRoicApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "ROIC_AI_API_KEY is not configured. Add it to .env.local (see .env.example)." },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const endY = Math.min(
    new Date().getUTCFullYear(),
    Math.max(1990, parseInt(url.searchParams.get("endYear") ?? "", 10) || new Date().getUTCFullYear())
  );
  const startY = Math.min(
    endY,
    Math.max(1990, parseInt(url.searchParams.get("startYear") ?? "", 10) || endY - 9)
  );

  const symbolParam = url.searchParams.get("symbol")?.trim() || null;
  const resolved = await resolveRoicSymbolForTicker(sym, apiKey, symbolParam);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, ticker: sym, tried: resolved.tried }, { status: 404 });
  }
  const roicSymbol = resolved.symbol;
  const fields = getDefaultAnnualFieldIds();

  const results: Array<{ field: string; ok: boolean; data?: unknown; error?: string }> = [];

  for (const field of fields) {
    const query = buildAnnualRangeQuery(field, roicSymbol, startY, endY);
    const r = await roicRqlRequest(query, apiKey);
    if (r.ok) results.push({ field, ok: true, data: r.data });
    else results.push({ field, ok: false, error: r.error });
  }

  return NextResponse.json({
    ticker: sym,
    roicSymbol,
    symbolResolution: { tried: resolved.tried, resolved: roicSymbol },
    period: { type: "annual" as const, startYear: startY, endYear: endY },
    results,
  });
}
