import { NextResponse } from "next/server";

import { getRecentCountEstimate } from "@/lib/xSearch/providers/counts";
import type { XSearchParams } from "@/lib/xSearch/types";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  ticker?: string;
  companyName?: string;
  aliases?: string[];
  includeRetweets?: boolean;
  language?: string;
};

export async function POST(req: Request) {
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

  const params: XSearchParams = {
    ticker,
    companyName: typeof body.companyName === "string" ? body.companyName.trim() : undefined,
    aliases,
    includeRetweets: typeof body.includeRetweets === "boolean" ? body.includeRetweets : undefined,
    language: typeof body.language === "string" ? body.language : undefined,
  };

  const c = await getRecentCountEstimate(params);
  if (!c.ok) return NextResponse.json({ error: c.error, query: c.query, explanation: c.explanation }, { status: 400 });
  return NextResponse.json({ ok: true, count: c.count, query: c.query, explanation: c.explanation });
}

