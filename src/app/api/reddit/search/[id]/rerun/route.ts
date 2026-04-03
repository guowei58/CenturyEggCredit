import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { runRedditSearch } from "@/lib/reddit/searchService";
import { getSearchById } from "@/lib/reddit/store/fileDb";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const s = await getSearchById(userId, id);
  if (!s) return NextResponse.json({ error: "Search not found" }, { status: 404 });

  if (!s.ticker && !s.company_name) {
    return NextResponse.json({ error: "Stored search has no ticker or company name" }, { status: 400 });
  }

  const out = await runRedditSearch(
    {
      ticker: s.ticker ?? undefined,
      companyName: s.company_name ?? undefined,
      aliases: Array.isArray(s.aliases_json) ? s.aliases_json : undefined,
      selectedSubreddits: Array.isArray(s.selected_subreddits_json) ? s.selected_subreddits_json : undefined,
      sitewideOnly: Boolean(s.sitewide_only),
      subredditOnly: Boolean(s.subreddit_only),
      timeRange: s.time_range,
      sortMode: s.sort_mode,
      forceRefresh: true,
    },
    userId
  );

  return NextResponse.json(out);
}
