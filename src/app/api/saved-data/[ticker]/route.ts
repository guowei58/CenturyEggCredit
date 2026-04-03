import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import { readUserTickerDocument, writeUserTickerDocument } from "@/lib/user-workspace-store";

export const dynamic = "force-dynamic";

/**
 * Per-user saved tab text (Postgres). Requires session.
 * GET ?key=… — load (empty string if missing).
 * POST { init: true } — no-op ok (legacy client compatibility).
 * POST { key, content } — save.
 */
export async function GET(request: Request, { params }: { params: { ticker: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker } = params;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  if (!key || !(key in SAVED_DATA_FILES)) {
    return NextResponse.json({ error: "Missing or invalid key" }, { status: 400 });
  }
  const content = (await readUserTickerDocument(userId, ticker, key)) ?? "";
  return NextResponse.json({ content });
}

export async function POST(request: Request, { params }: { params: { ticker: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker } = params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as { init?: boolean; key?: string; content?: string };

  if (b.init === true) {
    return NextResponse.json({ ok: true, path: null });
  }

  const key = typeof b.key === "string" ? b.key : "";
  const content = typeof b.content === "string" ? b.content : "";
  if (!key || !(key in SAVED_DATA_FILES)) {
    return NextResponse.json({ error: "Missing or invalid key" }, { status: 400 });
  }

  const result = await writeUserTickerDocument(userId, ticker, key, content);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
