import { NextResponse } from "next/server";
import { buildTwentyYearLookbackFromFacts, fetchCompanyFactsByTicker } from "@/lib/sec-xbrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const factsRes = await fetchCompanyFactsByTicker(sym);
  if (!factsRes.ok) return NextResponse.json({ error: factsRes.error }, { status: 502 });

  const entityName = (factsRes.facts.entityName ?? "").trim() || null;
  const payload = buildTwentyYearLookbackFromFacts(sym, factsRes.cik, entityName, factsRes.facts, 20);

  return NextResponse.json(payload);
}
