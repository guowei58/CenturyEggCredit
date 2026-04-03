import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { listPublications } from "@/lib/substack/registry/fileDb";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") ?? "").trim();
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "50");

  const out = await listPublications(userId, {
    status: status || undefined,
    offset: Number.isFinite(offset) ? offset : 0,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return NextResponse.json(out);
}

