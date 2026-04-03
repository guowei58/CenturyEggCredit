import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { runResearchFinderSearch } from "@/lib/researchFinder/service";
import type { ResearchFinderSearchRequest } from "@/lib/researchFinder/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  ticker?: string;
  companyName?: string;
  aliases?: string[];
  providers?: string[];
  maxResults?: number;
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

  const providers = Array.isArray(body.providers)
    ? (body.providers.filter((x): x is string => typeof x === "string").map((s) => s.trim()) as any)
    : undefined;

  const payload: ResearchFinderSearchRequest = {
    ticker,
    companyName: typeof body.companyName === "string" ? body.companyName.trim() : undefined,
    aliases,
    providers,
    maxResults: typeof body.maxResults === "number" && Number.isFinite(body.maxResults) ? body.maxResults : undefined,
  };

  const out = await runResearchFinderSearch(payload, userId);
  return NextResponse.json(out, { status: out.error ? 400 : 200 });
}

