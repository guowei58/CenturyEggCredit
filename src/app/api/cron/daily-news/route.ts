import { NextResponse } from "next/server";
import { getNyHour, getNyMinute } from "@/lib/daily-news/dates";
import { runDailyNewsForAllUsersWithWatchlists } from "@/lib/daily-news/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel / external cron: run daily ~5:00 AM America/New_York.
 * Call hourly and no-op outside the 5:00–5:15 NY window, or invoke with CRON_SECRET for manual trigger.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization");
  const vercelCron = request.headers.get("x-vercel-cron");
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  const authorized =
    process.env.NODE_ENV !== "production" ||
    (secret && authHeader === `Bearer ${secret}`) ||
    (secret && key === secret) ||
    vercelCron === "1";

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const h = getNyHour(now);
  const m = getNyMinute(now);
  const inMorningWindow = h === 5 && m < 20;
  const force = url.searchParams.get("force") === "1";

  if (!force && !inMorningWindow && process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: true, skipped: true, nyHour: h, nyMinute: m, reason: "outside 5:00 AM NY window" });
  }

  try {
    const result = await runDailyNewsForAllUsersWithWatchlists();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/daily-news]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
