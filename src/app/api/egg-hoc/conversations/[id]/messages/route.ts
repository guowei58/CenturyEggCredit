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

  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
    }
    const caption = typeof form.get("body") === "string" ? form.get("body") : "";
    const replyRaw = form.get("replyToMessageId");
    const replyTo =
      typeof replyRaw === "string" && replyRaw.trim() ? replyRaw.trim() : null;
    const imageEntry = form.get("image");
    if (imageEntry instanceof File && imageEntry.size > 0) {
      const buf = Buffer.from(await imageEntry.arrayBuffer());
      const mime = (imageEntry.type || "").toLowerCase().trim() || "application/octet-stream";
      const r = await sendMessage(id, userId, caption as string, replyTo, { mime, buffer: buf });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, message: r.message });
    }
    const r = await sendMessage(id, userId, caption as string, replyTo);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, message: r.message });
  }

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
