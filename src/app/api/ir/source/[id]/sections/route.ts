import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getSectionsForSource } from "@/lib/irIndexer/store/fileDb";

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

  const sections = await getSectionsForSource(userId, ticker, id);
  return NextResponse.json({ sections });
}

