import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addGroupMembers } from "@/lib/egg-hoc-chat/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: { userIds?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userIds = Array.isArray(body.userIds) ? body.userIds : [];
  const r = await addGroupMembers(id, userId, userIds);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, added: r.added });
}
