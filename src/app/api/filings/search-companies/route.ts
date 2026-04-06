import { NextResponse } from "next/server";
import { searchSecCompaniesByName } from "@/lib/sec-edgar";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const u = new URL(request.url);
  const q = u.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters", matches: [] }, { status: 400 });
  }
  if (q.length > 120) {
    return NextResponse.json({ error: "Query too long", matches: [] }, { status: 400 });
  }
  try {
    const matches = await searchSecCompaniesByName(q, 50);
    return NextResponse.json({ matches });
  } catch (e) {
    console.error("SEC company search error:", e);
    return NextResponse.json({ error: "Search failed", matches: [] }, { status: 500 });
  }
}
