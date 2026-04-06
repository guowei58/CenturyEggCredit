import { NextResponse } from "next/server";
import { fetchCompanyFactsByTicker, normalizeCompanyFactsToStatements } from "@/lib/sec-xbrl";

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
  const years = 20;
  const normalized = normalizeCompanyFactsToStatements({
    ticker: sym,
    cik: factsRes.cik,
    entityName,
    facts: factsRes.facts,
    years,
  });

  return NextResponse.json(normalized);
}

