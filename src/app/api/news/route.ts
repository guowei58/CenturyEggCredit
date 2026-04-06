import { NextResponse } from "next/server";

import { runNewsAggregation } from "@/lib/news/service";
import type { NewsQueryParams } from "@/lib/news/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  ticker?: string;
  companyName?: string;
  aliases?: unknown;
  from?: string;
  to?: string;
  limit?: number;
  enabledProviders?: string[];
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

  const sortMode = body.sortMode === "recent" ? "recent" : "relevance";
  const enabledProviders = Array.isArray(body.enabledProviders)
    ? body.enabledProviders.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : undefined;

  const aliases =
    Array.isArray(body.aliases) && body.aliases.length > 0
      ? body.aliases.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
      : undefined;

  const params: NewsQueryParams = {
    ticker,
    companyName: typeof body.companyName === "string" ? body.companyName.trim() : undefined,
    aliases,
    from: typeof body.from === "string" ? body.from : undefined,
    to: typeof body.to === "string" ? body.to : undefined,
    limit: typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : undefined,
    enabledProviders,
  };

  try {
    const data = await runNewsAggregation(params, { sortMode });
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Aggregation failed";
    return NextResponse.json({ error: msg, articles: [] }, { status: 500 });
  }
}
