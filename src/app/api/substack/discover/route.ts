import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { loadSubstackConfigFromEnv } from "@/lib/substack/config";
import { createSerperDiscoveryProvider } from "@/lib/substack/discovery/serperDiscovery";
import { detectPublicationFromHit } from "@/lib/substack/discovery/publicationDetector";
import { inferFeedUrl } from "@/lib/substack/rss/feedInference";
import { upsertPublications } from "@/lib/substack/registry/fileDb";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  ticker?: string;
  companyName?: string;
  aliases?: string[];
  maxResults?: number;
};

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cfg = loadSubstackConfigFromEnv();
  if (!cfg.discoveryEnabled) return NextResponse.json({ error: "Substack discovery disabled" }, { status: 400 });
  if (!cfg.serperApiKey) return NextResponse.json({ error: "SERPER_API_KEY is not set" }, { status: 400 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  const aliases = Array.isArray(body.aliases)
    ? body.aliases.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
    : [];

  const provider = createSerperDiscoveryProvider(cfg.serperApiKey, cfg.requestTimeoutMs);
  const discovered = await provider.discover({
    ticker,
    companyName: typeof body.companyName === "string" ? body.companyName.trim() : undefined,
    aliases,
    maxResults: Math.min(cfg.maxDiscoveryResults, Math.max(5, Math.floor(body.maxResults ?? cfg.maxDiscoveryResults))),
  });

  const pubs = discovered
    .map((d) => detectPublicationFromHit({ url: d.hit.url, title: d.hit.title, snippet: d.hit.snippet })?.publication ?? null)
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .map((p) => ({ ...p, feedUrl: p.feedUrl ?? inferFeedUrl(p.baseUrl) }));

  await upsertPublications(userId, pubs);

  return NextResponse.json({
    ok: true,
    discovered: discovered.length,
    publicationsDetected: pubs.length,
    publications: pubs,
  });
}

