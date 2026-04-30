import { NextResponse } from "next/server";
import { fetchTsdrBySerial } from "@/lib/uspto-ip";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

const TSDR_URL = "https://developer.uspto.gov";

/** POST JSON { "serial": "97123456" } — USPTO TSDR (trademark status by serial). */
export async function POST(request: Request) {
  const key = process.env.USPTO_TSDR_API_KEY?.trim();
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        error: "USPTO_TSDR_API_KEY is not set.",
        tsdrSignup: TSDR_URL,
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const serial =
    typeof body === "object" && body !== null && "serial" in body
      ? String((body as { serial?: unknown }).serial ?? "").trim()
      : "";

  if (!serial) {
    return NextResponse.json({ ok: false, error: 'Body must include { "serial": "…" }.' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const tm = await fetchTsdrBySerial(key, serial);
    return NextResponse.json({ ok: true, trademark: tm }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    const message = e instanceof Error ? e.message : "TSDR lookup failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
