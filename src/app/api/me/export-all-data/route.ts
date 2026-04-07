import { NextResponse } from "next/server";

import { auth } from "@/auth";
import type { ExportTickerFilter } from "@/lib/user-data-export";
import {
  buildUserExportPartZip,
  getUserExportManifest,
  listExportableTickersForUser,
} from "@/lib/user-data-export";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const HDR_PART = "X-Export-Part";
const HDR_PARTS_TOTAL = "X-Export-Parts-Total";

function parseTickerFilter(searchParams: URLSearchParams): { ok: true; filter: ExportTickerFilter } | { ok: false; error: string } {
  const raw = searchParams.get("tickers")?.trim() ?? "";
  if (!raw || raw.toLowerCase() === "all") {
    return { ok: true, filter: null };
  }
  const set = new Set<string>();
  for (const piece of raw.split(",")) {
    const s = sanitizeTicker(piece);
    if (s) set.add(s);
  }
  if (set.size === 0) {
    return { ok: false, error: "No valid tickers in tickers= parameter. Use tickers=all for a full export." };
  }
  return { ok: true, filter: set };
}

/**
 * GET ?meta=1 — manifest JSON.
 * GET ?listTickers=1 — sorted tickers with any exportable data (+ watchlist).
 * GET ?part=1 — ZIP part. Query `tickers` same as meta: absent or `all` = everything; else comma-separated normalized symbols.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const t0 = Date.now();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    console.info(`[export-all-data] unauthorized after ${Date.now() - t0}ms`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (url.searchParams.get("listTickers") === "1") {
    try {
      const tickers = await listExportableTickersForUser(userId);
      return NextResponse.json({ ok: true as const, tickers });
    } catch (e) {
      console.error("[export-all-data] listTickers error", e);
      const message = e instanceof Error ? e.message : "Failed to list tickers";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const parsed = parseTickerFilter(url.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const tickerFilter = parsed.filter;

  if (url.searchParams.get("meta") === "1") {
    try {
      const manifest = await getUserExportManifest(userId, tickerFilter);
      console.info(`[export-all-data] meta totalParts=${manifest.totalParts} ${Date.now() - t0}ms`);
      return NextResponse.json(manifest);
    } catch (e) {
      console.error("[export-all-data] meta error", e);
      const message = e instanceof Error ? e.message : "Export manifest failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const partRaw = url.searchParams.get("part") ?? "1";
  const part1Based = Math.max(1, parseInt(partRaw, 10) || 1);
  console.info(`[export-all-data] start part=${part1Based} partial=${Boolean(tickerFilter?.size)}`);

  try {
    const { buffer, part, totalParts, filename } = await buildUserExportPartZip(userId, part1Based, tickerFilter);
    const ms = Date.now() - t0;
    console.info(
      `[export-all-data] ok part=${part}/${totalParts} zipBytes=${buffer.length} user=${userId.slice(0, 8)}… ${ms}ms`
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        [HDR_PART]: String(part),
        [HDR_PARTS_TOTAL]: String(totalParts),
      },
    });
  } catch (e) {
    const ms = Date.now() - t0;
    console.error(`[export-all-data] error after ${ms}ms`, e);
    const message = e instanceof Error ? e.message : "Export failed";
    if (message.startsWith("Invalid part")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
