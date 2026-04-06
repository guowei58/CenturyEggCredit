import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { removeGroupMember } from "@/lib/egg-hoc-chat/service";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string; userId: string } }) {
  const session = await auth();
  const actorUserId = session?.user?.id;
  if (!actorUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = params.id?.trim();
  const targetUserId = params.userId?.trim();
  if (!conversationId || !targetUserId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const r = await removeGroupMember(conversationId, actorUserId, targetUserId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
