import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getConversationDetail, renameGroupConversation } from "@/lib/egg-hoc-chat/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const r = await getConversationDetail(id, userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 403 });
  return NextResponse.json({ ok: true, conversation: r.conversation });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: { name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const r = await renameGroupConversation(id, userId, body.name);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
