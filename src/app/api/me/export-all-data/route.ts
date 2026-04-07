import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { buildUserExportPartZip, getUserExportManifest } from "@/lib/user-data-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const HDR_PART = "X-Export-Part";
const HDR_PARTS_TOTAL = "X-Export-Parts-Total";

/**
 * GET ?part=1 (default) — one ZIP part of the user’s full export. If data exceeds the per-part
 * uncompressed budget, use part=2, part=3, … until all parts are downloaded (see response headers).
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

  if (url.searchParams.get("meta") === "1") {
    try {
      const manifest = await getUserExportManifest(userId);
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
  console.info(`[export-all-data] start part=${part1Based}`);

  try {
    const { buffer, part, totalParts, filename } = await buildUserExportPartZip(userId, part1Based);
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
