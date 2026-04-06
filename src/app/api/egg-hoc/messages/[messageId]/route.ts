import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { editMessage, softDeleteMessage } from "@/lib/egg-hoc-chat/service";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { messageId: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const messageId = params.messageId?.trim();
  if (!messageId) return NextResponse.json({ error: "Missing message id" }, { status: 400 });

  let body: { body?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.body === "string" ? body.body : "";
  const r = await editMessage(messageId, userId, text);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { messageId: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const messageId = params.messageId?.trim();
  if (!messageId) return NextResponse.json({ error: "Missing message id" }, { status: 400 });

  const r = await softDeleteMessage(messageId, userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
