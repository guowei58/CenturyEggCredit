import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getConversationMessages, sendMessage } from "@/lib/egg-hoc-chat/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const url = new URL(req.url);
  const before = url.searchParams.get("before")?.trim() || undefined;
  const takeRaw = url.searchParams.get("take");
  const take = takeRaw ? parseInt(takeRaw, 10) : undefined;

  const r = await getConversationMessages(id, userId, { beforeMessageId: before, take });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 403 });
  return NextResponse.json({ ok: true, messages: r.messages, hasMore: r.hasMore, nextCursor: r.nextCursor });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: { body?: string; replyToMessageId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.body === "string" ? body.body : "";
  const replyTo =
    typeof body.replyToMessageId === "string" && body.replyToMessageId.trim() ? body.replyToMessageId.trim() : null;
  const r = await sendMessage(id, userId, text, replyTo);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, message: r.message });
}
