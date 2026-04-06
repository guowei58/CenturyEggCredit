import { NextResponse } from "next/server";
import {
  buildTranscriptQuery,
  getEarningsTranscriptFieldId,
  getRoicApiKey,
  resolveRoicSymbolForTicker,
  roicRqlRequest,
} from "@/lib/roic-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function normalizePeriod(s: string): string | null {
  const t = s.replace(/\s/g, "").toUpperCase();
  if (/^\d{4}Q[1-4]$/.test(t)) return t;
  return null;
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
  const period = normalizePeriod(url.searchParams.get("period") ?? "");
  if (!period) {
    return NextResponse.json(
      { error: "Missing or invalid period. Use period=2024Q4 (fiscal quarter)." },
      { status: 400 }
    );
  }

  const fieldOverride = url.searchParams.get("field")?.trim();
  const fieldId = fieldOverride || getEarningsTranscriptFieldId();
  const symbolParam = url.searchParams.get("symbol")?.trim() || null;
  const resolved = await resolveRoicSymbolForTicker(sym, apiKey, symbolParam);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, ticker: sym, tried: resolved.tried }, { status: 404 });
  }
  const roicSymbol = resolved.symbol;
  const query = buildTranscriptQuery(fieldId, roicSymbol, period);

  const r = await roicRqlRequest(query, apiKey);
  if (!r.ok) {
    const status = r.status >= 400 && r.status < 600 ? r.status : 502;
    return NextResponse.json(
      {
        error: r.error,
        ticker: sym,
        roicSymbol,
        period,
        fieldId,
        query,
        hint:
          "If the field is wrong, set ROIC_AI_EARNINGS_TRANSCRIPT_FIELD in .env.local to the ID from https://roic.ai/knowledge-base/financial-definitions/ or pass ?field=your_field_id",
      },
      { status }
    );
  }

  return NextResponse.json({
    ticker: sym,
    roicSymbol,
    symbolResolution: { tried: resolved.tried, resolved: roicSymbol },
    period,
    fieldId,
    query,
    data: r.data,
  });
}
