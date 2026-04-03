import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAiChatPayload, setAiChatPayload } from "@/lib/user-workspace-store";

export const dynamic = "force-dynamic";

/** GET — raw JSON string: `{ sessions, activeId }` as stored in Postgres. */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = await getAiChatPayload(userId);
  return NextResponse.json({ payload: payload ?? "" });
}

export async function PUT(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { payload?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = typeof body.payload === "string" ? body.payload : "";
  const result = await setAiChatPayload(userId, payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
