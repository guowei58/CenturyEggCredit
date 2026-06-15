import { NextResponse } from "next/server";
import {
  fetchRoicV2EarningsCallTranscript,
  getRoicTranscriptIdentifierCandidates,
  parseRoicQuarterPeriod,
  getRoicApiKey,
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

  const parsed = parseRoicQuarterPeriod(period);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid period format." }, { status: 400 });
  }

  const symbolParam = url.searchParams.get("symbol")?.trim() || null;
  const identifiers = getRoicTranscriptIdentifierCandidates(sym, symbolParam);
  const errors: string[] = [];

  for (const id of identifiers) {
    const r = await fetchRoicV2EarningsCallTranscript(id, parsed.year, parsed.quarter);
    if (r.ok) {
      return NextResponse.json({
        ticker: sym,
        roicSymbol: r.symbol,
        symbolResolution: { tried: identifiers, resolved: r.symbol },
        period,
        year: r.year,
        quarter: r.quarter,
        date: r.date,
        content: r.content,
        data: r.content,
        source: "roic-v2-earnings-calls",
      });
    }
    errors.push(`${id}: ${r.error}`);
  }

  return NextResponse.json(
    {
      error: errors[errors.length - 1] ?? "Transcript not found.",
      ticker: sym,
      tried: identifiers,
      period,
    },
    { status: 404 }
  );
}
