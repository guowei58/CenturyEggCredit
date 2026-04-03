import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWatchlistTickers, setWatchlistTickers } from "@/lib/user-workspace-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tickers = await getWatchlistTickers(userId);
  return NextResponse.json({ tickers });
}

export async function PUT(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { tickers?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const raw = body.tickers;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "tickers must be an array of strings" }, { status: 400 });
  }
  const tickers = raw.filter((t): t is string => typeof t === "string");
  await setWatchlistTickers(userId, tickers);
  return NextResponse.json({ ok: true });
}
