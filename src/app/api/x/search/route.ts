import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { runXSearch } from "@/lib/xSearch/service";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  ticker?: string;
  companyName?: string;
  aliases?: string[];
  from?: string;
  to?: string;
  limit?: number;
  includeRetweets?: boolean;
  language?: string;
  sortMode?: "relevance" | "recent" | "engagement";
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

  const out = await runXSearch({
    ticker,
    companyName: typeof body.companyName === "string" ? body.companyName.trim() : undefined,
    aliases,
    from: typeof body.from === "string" ? body.from : undefined,
    to: typeof body.to === "string" ? body.to : undefined,
    limit: typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : undefined,
    includeRetweets: typeof body.includeRetweets === "boolean" ? body.includeRetweets : undefined,
    language: typeof body.language === "string" ? body.language : undefined,
    sortMode: body.sortMode === "recent" || body.sortMode === "engagement" ? body.sortMode : "relevance",
    userId,
  });

  return NextResponse.json(out);
}

