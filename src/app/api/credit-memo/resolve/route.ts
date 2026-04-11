import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveTickerFolder } from "@/lib/creditMemo/tickerFolderResolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { ticker?: string };
  try {
    body = (await req.json()) as { ticker?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ticker = typeof body.ticker === "string" ? body.ticker.trim() : "";
  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  try {
    const session = await auth();
    const result = await resolveTickerFolder(ticker, session?.user?.id ?? null);
    return NextResponse.json(result);
  } catch (e) {
    console.error("credit-memo resolve error:", e);
    const msg = e instanceof Error ? e.message : "Internal server error during folder resolve";
    return NextResponse.json({ ok: false, error: msg, rootSearched: "", candidates: [] }, { status: 500 });
  }
}
