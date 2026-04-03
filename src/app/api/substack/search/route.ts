import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { runSubstackSearch } from "@/lib/substack/search/searchService";
import type { SubstackSearchRequest } from "@/lib/substack/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  ticker?: string;
  companyName?: string;
  aliases?: string[];
  liveDiscovery?: boolean;
  maxResults?: number;
  sortMode?: "relevance" | "recent" | "publication";
  filterMode?: "all" | "indexed_only" | "live_only" | "high_confidence";
};

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = typeof body.ticker === "string" ? body.ticker.trim() : "";
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  const aliases = Array.isArray(body.aliases)
    ? body.aliases.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const payload: SubstackSearchRequest = {
    ticker,
    companyName: typeof body.companyName === "string" ? body.companyName.trim() : undefined,
    aliases,
    liveDiscovery: typeof body.liveDiscovery === "boolean" ? body.liveDiscovery : undefined,
    maxResults: typeof body.maxResults === "number" && Number.isFinite(body.maxResults) ? body.maxResults : undefined,
    sortMode: body.sortMode === "recent" || body.sortMode === "publication" ? body.sortMode : "relevance",
    filterMode:
      body.filterMode === "indexed_only" || body.filterMode === "live_only" || body.filterMode === "high_confidence"
        ? body.filterMode
        : "all",
  };

  const out = await runSubstackSearch(payload, userId);
  return NextResponse.json(out);
}

