import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { loadSubstackConfigFromEnv } from "@/lib/substack/config";
import { ingestPublicationRss } from "@/lib/substack/rss/rssIngestService";
import { loadSubstackDb, upsertPosts, updatePublicationIngested } from "@/lib/substack/registry/fileDb";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  maxPublications?: number;
  maxPostsPerFeed?: number;
};

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cfg = loadSubstackConfigFromEnv();
  if (!cfg.rssIngestEnabled) return NextResponse.json({ error: "Substack RSS ingest disabled" }, { status: 400 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const maxPublications = Math.min(cfg.maxPublicationsPerRun, Math.max(1, Math.floor(body.maxPublications ?? cfg.maxPublicationsPerRun)));
  const maxPostsPerFeed = Math.min(cfg.maxPostsPerFeed, Math.max(10, Math.floor(body.maxPostsPerFeed ?? cfg.maxPostsPerFeed)));

  const db = await loadSubstackDb(userId);
  const pubs = [...db.publications]
    .filter((p) => p.isLikelySubstack)
    .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
    .slice(0, maxPublications);

  const settled = await Promise.allSettled(
    pubs.map((p) =>
      ingestPublicationRss({
        publication: p,
        timeoutMs: cfg.requestTimeoutMs,
        maxPosts: maxPostsPerFeed,
      }).then((r) => ({ pub: p, r }))
    )
  );

  let ingested = 0;
  let posts = 0;
  for (const s of settled) {
    if (s.status === "rejected") continue;
    if (!s.value.r.ok) continue;
    ingested += 1;
    posts += s.value.r.posts.length;
    await upsertPosts(userId, s.value.r.posts);
    await updatePublicationIngested(userId, s.value.pub.id);
  }

  return NextResponse.json({ ok: true, publicationsAttempted: pubs.length, publicationsIngested: ingested, postsIngested: posts });
}

