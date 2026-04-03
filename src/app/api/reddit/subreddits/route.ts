import { NextResponse } from "next/server";

import { getDefaultSubredditList } from "@/lib/reddit/subredditConfig";

export const runtime = "nodejs";

export async function GET() {
  const subreddits = getDefaultSubredditList();
  return NextResponse.json({ subreddits });
}
