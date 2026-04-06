import { NextResponse } from "next/server";
import {
  buildQuarterlyRangeQuery,
  getDefaultQuarterlyFieldIds,
  getRoicApiKey,
  resolveRoicSymbolForTicker,
  roicRqlRequest,
} from "@/lib/roic-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function normalizeQuarterToken(s: string): string | null {
  const t = s.replace(/\s/g, "").toUpperCase();
  const m = /^(\d{4})Q([1-4])$/.exec(t);
  if (!m) return null;
  return `${m[1]}Q${m[2]}`;
}

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
  const fromRaw = url.searchParams.get("from") ?? "2020Q1";
  const toRaw = url.searchParams.get("to") ?? "2024Q4";
  let from = normalizeQuarterToken(fromRaw);
  let to = normalizeQuarterToken(toRaw);
  if (!from || !to) {
    return NextResponse.json(
      { error: "Invalid quarter range. Use from/to like 2020Q1 and 2024Q4." },
      { status: 400 }
    );
  }
  if (from > to) [from, to] = [to, from];

  const symbolParam = url.searchParams.get("symbol")?.trim() || null;
  const resolved = await resolveRoicSymbolForTicker(sym, apiKey, symbolParam);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, ticker: sym, tried: resolved.tried }, { status: 404 });
  }
  const roicSymbol = resolved.symbol;
  const fields = getDefaultQuarterlyFieldIds();

  const results: Array<{ field: string; ok: boolean; data?: unknown; error?: string }> = [];

  for (const field of fields) {
    const query = buildQuarterlyRangeQuery(field, roicSymbol, from, to);
    const r = await roicRqlRequest(query, apiKey);
    if (r.ok) results.push({ field, ok: true, data: r.data });
    else results.push({ field, ok: false, error: r.error });
  }

  return NextResponse.json({
    ticker: sym,
    roicSymbol,
    symbolResolution: { tried: resolved.tried, resolved: roicSymbol },
    period: { type: "quarterly" as const, from, to },
    results,
  });
}
