import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runOpenCorporatesAddressFinder } from "@/lib/opencorporates/runOpenCorporatesAddressFinder";
import { requireUserTicker, serEntityUniverseRow } from "../entity-universe/_helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const rows = await prisma.openCorporatesSubsidiaryAddressResult.findMany({
    where: { userId, ticker },
    orderBy: { subsidiaryRowIndex: "asc" },
  });

  return NextResponse.json({
    results: rows.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let forceRefresh = false;
  let maxCacheAgeDays = 7;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body === "object") {
      if ((body as { forceRefresh?: boolean }).forceRefresh === true) forceRefresh = true;
      const d = Number((body as { maxCacheAgeDays?: number }).maxCacheAgeDays);
      if (Number.isFinite(d) && d >= 0 && d <= 365) maxCacheAgeDays = d;
    }
  } catch {
    /** default */
  }

  try {
    const out = await runOpenCorporatesAddressFinder({
      prisma,
      userId,
      ticker,
      forceRefresh,
      maxCacheAgeDays,
    });

    if (!out.ok) {
      return NextResponse.json(
        { ok: false, error: out.error ?? out.skippedReason ?? "Run failed" },
        { status: out.error ? 400 : 422 }
      );
    }

    const rows = await prisma.openCorporatesSubsidiaryAddressResult.findMany({
      where: { userId, ticker },
      orderBy: { subsidiaryRowIndex: "asc" },
    });

    return NextResponse.json({
      ok: true,
      stats: out.stats,
      results: rows.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)),
    });
  } catch (e) {
    let msg = e instanceof Error ? e.message : "GLEIF address finder run failed";
    if (/P2021|does not exist.*relation/i.test(msg)) {
      msg =
        "Subsidiary address tables are not in this database yet. Run `npx prisma migrate deploy` (or `migrate dev` locally), then restart the server.";
    }
    console.error("[opencorporates-address-finder]", msg, e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
