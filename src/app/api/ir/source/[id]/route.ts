import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getIrSummary } from "@/lib/irIndexer/service";
import { getLatestJobForSource, getSource } from "@/lib/irIndexer/store/fileDb";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const source = await getSource(userId, ticker, id);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const summary = await getIrSummary({ userId, ticker, sourceId: id });
  const job = await getLatestJobForSource(userId, ticker, id);

  return NextResponse.json({ source, summary, latestJob: job });
}

