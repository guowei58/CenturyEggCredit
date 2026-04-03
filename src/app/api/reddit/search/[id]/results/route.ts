import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { cachedRedditResponse } from "@/lib/reddit/searchService";
import { getSearchById, listResultsBySearchId } from "@/lib/reddit/store/fileDb";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const search = await getSearchById(userId, id);
  if (!search) return NextResponse.json({ error: "Search not found" }, { status: 404 });

  const results = await listResultsBySearchId(userId, id);
  const full = cachedRedditResponse(search, results, []);
  return NextResponse.json({
    searchId: id,
    summary: full.summary,
    results: full.results,
    disclaimer: full.disclaimer,
  });
}
