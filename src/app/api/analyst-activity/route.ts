import { NextResponse } from "next/server";

import { ingestAnalystActivity } from "@/lib/analystActivity/ingest";
import type { AnalystActivityRequest } from "@/lib/analystActivity/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  ticker?: string;
  companyName?: string;
  aliases?: string[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = typeof body.ticker === "string" ? body.ticker.trim() : "";
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const aliases = Array.isArray(body.aliases)
    ? body.aliases.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : undefined;

  const payload: AnalystActivityRequest = {
    ticker,
    companyName: typeof body.companyName === "string" ? body.companyName.trim() : undefined,
    aliases,
  };

  try {
    const data = await ingestAnalystActivity(payload);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Analyst activity ingest failed";
    return NextResponse.json(
      {
        ticker: ticker.toUpperCase(),
        events: [],
        coverage: [],
        summary: {
          activeCoveringBrokers: 0,
          eventsLast30Days: 0,
          eventsLast90Days: 0,
          eventsLast180Days: 0,
          eventsLast365Days: 0,
          upgradeCount: 0,
          downgradeCount: 0,
          initiationCount: 0,
          priceTargetRaiseCount: 0,
          priceTargetCutCount: 0,
          latestActivityDate: null,
          avgPriceTarget: null,
          highPriceTarget: null,
          lowPriceTarget: null,
          staleCoverageWarning: false,
        },
        sourceLogs: [],
        retrievedAt: new Date().toISOString(),
        error: msg,
      },
      { status: 500 }
    );
  }
}
