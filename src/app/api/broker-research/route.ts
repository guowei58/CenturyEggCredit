import { NextResponse } from "next/server";

import { runBrokerResearch } from "@/lib/brokerResearch/service";
import type { BrokerResearchRequest } from "@/lib/brokerResearch/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  ticker?: string;
  companyName?: string;
  aliases?: string[];
  from?: string;
  to?: string;
  enabledBrokers?: string[];
  maxResults?: number;
  sortMode?: "relevance" | "recent";
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

  const enabledBrokers = Array.isArray(body.enabledBrokers)
    ? body.enabledBrokers.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : undefined;

  const aliases = Array.isArray(body.aliases)
    ? body.aliases.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : undefined;

  const payload: BrokerResearchRequest = {
    ticker,
    companyName: typeof body.companyName === "string" ? body.companyName.trim() : undefined,
    aliases,
    from: typeof body.from === "string" ? body.from : undefined,
    to: typeof body.to === "string" ? body.to : undefined,
    enabledBrokers,
    maxResults: typeof body.maxResults === "number" && Number.isFinite(body.maxResults) ? body.maxResults : undefined,
  };

  const sortMode = body.sortMode === "recent" ? "recent" : "relevance";

  try {
    const data = await runBrokerResearch(payload, { sortMode });
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Broker research failed";
    return NextResponse.json(
      {
        ticker: ticker.toUpperCase(),
        aliases: [],
        activeBrokers: [],
        skippedBrokers: [],
        queryCount: 0,
        resultsBeforeDedupe: 0,
        resultsAfterDedupe: 0,
        brokerStats: {},
        reports: [],
        error: msg,
      },
      { status: 500 }
    );
  }
}
