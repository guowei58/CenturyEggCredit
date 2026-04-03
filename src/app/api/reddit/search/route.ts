import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { runRedditSearch } from "@/lib/reddit/searchService";
import type { RedditSearchRequest, RedditTimeRange, RedditSortMode } from "@/lib/reddit/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function isTimeRange(x: string): x is RedditTimeRange {
  return x === "hour" || x === "day" || x === "week" || x === "month" || x === "year" || x === "all";
}

function isSortMode(x: string): x is RedditSortMode {
  return x === "relevance" || x === "hot" || x === "new" || x === "top" || x === "comments";
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = typeof body.ticker === "string" ? body.ticker.trim() : "";
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;
  if (!ticker && !companyName) {
    return NextResponse.json({ error: "ticker and/or companyName is required" }, { status: 400 });
  }

  const aliases = Array.isArray(body.aliases)
    ? body.aliases.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const selectedSubreddits = Array.isArray(body.selectedSubreddits)
    ? body.selectedSubreddits.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const tr = typeof body.timeRange === "string" ? body.timeRange : "year";
  const sm = typeof body.sortMode === "string" ? body.sortMode : "relevance";

  const payload: RedditSearchRequest = {
    ticker: ticker || undefined,
    companyName: companyName || undefined,
    aliases,
    selectedSubreddits,
    sitewideOnly: typeof body.sitewideOnly === "boolean" ? body.sitewideOnly : undefined,
    subredditOnly: typeof body.subredditOnly === "boolean" ? body.subredditOnly : undefined,
    timeRange: isTimeRange(tr) ? tr : "year",
    sortMode: isSortMode(sm) ? sm : "relevance",
    forceRefresh: typeof body.forceRefresh === "boolean" ? body.forceRefresh : undefined,
  };

  const out = await runRedditSearch(payload, userId);
  return NextResponse.json(out);
}
