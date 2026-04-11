import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { getAiChatPayload, setAiChatPayload } from "@/lib/user-workspace-store";

export const dynamic = "force-dynamic";

/** GET — raw JSON string: `{ sessions, activeId }` as stored in Postgres for `?ticker=`. */
export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const sym = sanitizeTicker(url.searchParams.get("ticker") ?? "");
  if (!sym) {
    return NextResponse.json({ error: "ticker query parameter required" }, { status: 400 });
  }
  const payload = await getAiChatPayload(userId, sym);
  return NextResponse.json({ payload: payload ?? "" });
}

export async function PUT(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { ticker?: unknown; payload?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sym = sanitizeTicker(typeof body.ticker === "string" ? body.ticker : "");
  if (!sym) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  const payload = typeof body.payload === "string" ? body.payload : "";
  const result = await setAiChatPayload(userId, sym, payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
