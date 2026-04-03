import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { submitIrIndexJob } from "@/lib/irIndexer/service";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  ticker?: string;
  url?: string;
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
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

  const r = await submitIrIndexJob({ userId, ticker, url });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}

