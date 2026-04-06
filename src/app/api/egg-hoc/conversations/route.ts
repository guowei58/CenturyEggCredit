import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createDirectConversation,
  createGroupConversation,
  listUserConversations,
} from "@/lib/egg-hoc-chat/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const conversations = await listUserConversations(userId);
    return NextResponse.json({ ok: true, conversations });
  } catch (e) {
    console.error("[egg-hoc/conversations GET]", e);
    const message =
      e instanceof Error ? e.message : "Failed to load conversations";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: { type?: string; targetUserId?: string; name?: string; memberUserIds?: string[] };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (body.type === "direct") {
      const target = typeof body.targetUserId === "string" ? body.targetUserId : "";
      const r = await createDirectConversation(userId, target);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, conversationId: r.conversationId, created: r.created });
    }

    if (body.type === "group") {
      const name = typeof body.name === "string" ? body.name : "";
      const memberUserIds = Array.isArray(body.memberUserIds) ? body.memberUserIds : [];
      const r = await createGroupConversation(userId, name, memberUserIds);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, conversationId: r.conversationId });
    }

    return NextResponse.json({ error: "type must be 'direct' or 'group'" }, { status: 400 });
  } catch (e) {
    console.error("[egg-hoc/conversations POST]", e);
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
