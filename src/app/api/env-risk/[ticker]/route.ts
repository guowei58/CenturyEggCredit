import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getEnvRiskConfig } from "@/lib/env-risk/config";
import { readEnvRiskSnapshot } from "@/lib/env-risk/cache";
import { runEnvRiskPipeline } from "@/lib/env-risk/pipeline";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET — return last cached snapshot + freshness metadata.
 * POST — run server pipeline (SEC + EPA); refreshes cache.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = sanitizeTicker(raw || "");
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Invalid ticker" }, { status: 400 });
  }
  const snap = await readEnvRiskSnapshot(ticker);
  if (!snap) {
    return NextResponse.json({
      ok: false,
      ticker,
      error: "No cached environmental risk run yet. POST this endpoint to execute the pipeline.",
    });
  }
  const cfg = getEnvRiskConfig();
  const ageMs = Date.now() - Date.parse(snap.last_refreshed_iso);
  return NextResponse.json({
    ok: true,
    ticker,
    snapshot: snap,
    cache_ttl_ms: cfg.cacheTtlMs,
    age_ms: Number.isFinite(ageMs) ? Math.max(0, ageMs) : null,
    stale: Number.isFinite(ageMs) ? ageMs >= cfg.cacheTtlMs : true,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = sanitizeTicker(raw || "");
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Invalid ticker" }, { status: 400 });
  }

  let force = false;
  try {
    const body = (await request.json().catch(() => ({}))) as { force?: boolean };
    force = Boolean(body?.force);
  } catch {
    // ignore
  }

  const session = await auth();
  const result = await runEnvRiskPipeline({
    ticker,
    userId: session?.user?.id ?? null,
    forceRefresh: force,
    respectCache: !force,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    ticker,
    from_cache: result.from_cache,
    snapshot: result.snapshot,
  });
}
