import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getUnreadDailyNewsCount,
  listDailyNewsBatches,
  markDailyNewsBatchRead,
  refreshDailyNewsForUser,
} from "@/lib/daily-news/service";
import type { DailyNewsBatchPayload } from "@/lib/daily-news/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function safeParsePayload(raw: string, batchDateKey: string): DailyNewsBatchPayload {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return {
      v: 1,
      generatedAt: new Date().toISOString(),
      latestRefreshAt: new Date().toISOString(),
      tickers: [],
      watchlistSignature: "",
      topLevelSummary: "This digest had no saved payload. Use Refresh now to regenerate.",
      summaryByTicker: {},
      sourcesUsed: [],
      fetchErrors: [{ source: "storage", message: `Empty payload for ${batchDateKey}` }],
    };
  }
  try {
    return JSON.parse(trimmed) as DailyNewsBatchPayload;
  } catch {
    return {
      v: 1,
      generatedAt: new Date().toISOString(),
      latestRefreshAt: new Date().toISOString(),
      tickers: [],
      watchlistSignature: "",
      topLevelSummary: "Stored digest could not be read. Use Refresh now to regenerate.",
      summaryByTicker: {},
      sourcesUsed: [],
      fetchErrors: [{ source: "storage", message: "Invalid JSON in saved digest" }],
    };
  }
}

/**
 * GET — list recent batches + unread count (signed-in).
 * POST — trigger refresh for current user (signed-in).
 */
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const lite = url.searchParams.get("lite") === "1";
  if (lite) {
    const unreadCount = await getUnreadDailyNewsCount(userId);
    return NextResponse.json({ unreadCount });
  }
  const rows = await listDailyNewsBatches(userId);
  const unreadCount = await getUnreadDailyNewsCount(userId);
  const batches = rows.map((r) => ({
    id: r.id,
    batchDateKey: r.batchDateKey,
    generatedAt: r.generatedAt.toISOString(),
    isRead: r.isRead,
    readAt: r.readAt?.toISOString() ?? null,
    watchlistSignature: r.watchlistSignature,
    payload: safeParsePayload(r.payloadJson, r.batchDateKey),
  }));
  return NextResponse.json({ unreadCount, batches });
}

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const res = await refreshDailyNewsForUser(userId);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  const unreadCount = await getUnreadDailyNewsCount(userId);
  const rows = await listDailyNewsBatches(userId);
  return NextResponse.json({ ok: true, unreadCount, batchCount: rows.length });
}

export async function PATCH(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as { batchId?: unknown };
  const batchId = typeof b.batchId === "string" ? b.batchId.trim() : "";
  if (!batchId) {
    return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
  }
  const out = await markDailyNewsBatchRead(userId, batchId);
  if (!out.ok) {
    return NextResponse.json({ error: out.error }, { status: 404 });
  }
  const unreadCount = await getUnreadDailyNewsCount(userId);
  return NextResponse.json({ ok: true, unreadCount });
}
