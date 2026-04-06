import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { readFacilityOverrides, writeFacilityOverrides } from "@/lib/env-risk/cache";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export const dynamic = "force-dynamic";

/**
 * POST { registry_id: string, status: "confirmed" | "rejected" }
 * Updates per-ticker facility match overrides (disk). Re-run env-risk pipeline to apply.
 */
export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: raw } = await params;
  const ticker = sanitizeTicker(raw || "");
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Invalid ticker" }, { status: 400 });
  }

  let body: { registry_id?: string; status?: string };
  try {
    body = (await request.json()) as { registry_id?: string; status?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const rid = String(body.registry_id || "")
    .trim()
    .replace(/\s+/g, "");
  const status = body.status;
  if (!rid || rid.length < 4) {
    return NextResponse.json({ ok: false, error: "registry_id required" }, { status: 400 });
  }
  if (status !== "confirmed" && status !== "rejected") {
    return NextResponse.json({ ok: false, error: 'status must be "confirmed" or "rejected"' }, { status: 400 });
  }

  const cur = await readFacilityOverrides(ticker);
  const confirmed = new Set(cur.confirmed_registry_ids);
  const rejected = new Set(cur.rejected_registry_ids);
  confirmed.delete(rid);
  rejected.delete(rid);
  if (status === "confirmed") confirmed.add(rid);
  else rejected.add(rid);

  await writeFacilityOverrides(ticker, {
    confirmed_registry_ids: Array.from(confirmed),
    rejected_registry_ids: Array.from(rejected),
  });

  return NextResponse.json({
    ok: true,
    ticker,
    overrides: await readFacilityOverrides(ticker),
    note: "POST /api/env-risk/[ticker] with { force: true } to rebuild the snapshot with these overrides.",
  });
}
