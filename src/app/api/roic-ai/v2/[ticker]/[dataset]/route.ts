import { NextResponse } from "next/server";
import { resolveRoicSymbolForTicker } from "@/lib/roic-ai";
import { getRoicApiKey } from "@/lib/roic-ai";
import { isRoicV2Dataset, type RoicV2FundamentalDataset } from "@/lib/roic-ai-v2-datasets";
import { fetchRoicV2FundamentalJson, type RoicV2StatementPeriod } from "@/lib/roic-ai-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string; dataset: string }> }) {
  const { ticker, dataset: datasetParam } = await params;
  const sym = (ticker ?? "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!sym || sym.length > 20) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  if (!isRoicV2Dataset(datasetParam)) {
    return NextResponse.json({ error: "Unknown dataset" }, { status: 400 });
  }
  const dataset = datasetParam as RoicV2FundamentalDataset;

  const apiKey = getRoicApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "ROIC_AI_API_KEY is not configured. Add it to .env.local (see .env.example)." },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const symbolOverride = url.searchParams.get("symbol")?.trim() || null;
  const periodRaw = url.searchParams.get("period")?.trim().toLowerCase() ?? "";
  const statementPeriod: RoicV2StatementPeriod =
    periodRaw === "quarterly" || periodRaw === "q" ? "quarterly" : "annual";

  const resolved = await resolveRoicSymbolForTicker(sym, apiKey, symbolOverride);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, ticker: sym, tried: resolved.tried }, { status: 404 });
  }

  const roicSymbol = resolved.symbol;
  const r = await fetchRoicV2FundamentalJson(dataset, roicSymbol, statementPeriod);
  if (!r.ok) {
    return NextResponse.json(
      { error: r.error, ticker: sym, roicSymbol, dataset },
      { status: r.status >= 400 && r.status < 600 ? r.status : 502 }
    );
  }

  if (!Array.isArray(r.data)) {
    return NextResponse.json(
      { error: "Unexpected response shape (expected JSON array)", ticker: sym, roicSymbol, dataset },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ticker: sym,
    roicSymbol,
    dataset,
    period: statementPeriod,
    symbolResolution: { tried: resolved.tried, resolved: roicSymbol },
    series: r.data,
  });
}
