import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getProject } from "@/lib/creditMemo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const p = await getProject(userId, id);
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ project: p });
}
