import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { submitIrIndexJob } from "@/lib/irIndexer/service";
import { getSource } from "@/lib/irIndexer/store/fileDb";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  ticker?: string;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const src = await getSource(userId, ticker, id);
  if (!src) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const r = await submitIrIndexJob({ userId, ticker, url: src.root_url, forceReindex: true });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}

