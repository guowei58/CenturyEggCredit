import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchUsers } from "@/lib/egg-hoc-chat/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    const takeRaw = url.searchParams.get("take");
    const take = takeRaw ? parseInt(takeRaw, 10) : 20;

    const users = await searchUsers(q, userId, Number.isFinite(take) ? take : 20);
    return NextResponse.json({ ok: true, users });
  } catch (e) {
    console.error("[egg-hoc/users GET]", e);
    const message = e instanceof Error ? e.message : "User search failed";
    return NextResponse.json({ ok: false, error: message, users: [] }, { status: 500 });
  }
}
