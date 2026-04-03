import type { NormalizedXPost, XSourceProviderId } from "../types";
import { parseIsoOrNull, postUrlFromId } from "../utils";

type XTweet = {
  id: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  conversation_id?: string;
  public_metrics?: {
    like_count?: number;
    repost_count?: number;
    retweet_count?: number; // older naming; treat as repost_count
    reply_count?: number;
    quote_count?: number;
    bookmark_count?: number;
    impression_count?: number;
  };
  entities?: {
    cashtags?: Array<{ tag?: string }>;
    hashtags?: Array<{ tag?: string }>;
    mentions?: Array<{ username?: string }>;
  };
  referenced_tweets?: Array<{ type?: string; id?: string }>;
};

type XUser = { id: string; username?: string; name?: string };

export function normalizeTweet(params: {
  tweet: XTweet;
  usersById: Map<string, XUser>;
  sourceProvider: XSourceProviderId;
  matchedTicker: string;
  companyName?: string;
  aliases: string[];
  matchSignals: string[];
  confidenceScore: number;
  relevanceScore: number;
}): NormalizedXPost {
  const t = params.tweet;
  const author = t.author_id ? params.usersById.get(t.author_id) : undefined;
  const ref = t.referenced_tweets ?? [];
  const isRetweet = ref.some((r) => r.type === "retweeted");
  const isReply = ref.some((r) => r.type === "replied_to");
  const isQuote = ref.some((r) => r.type === "quoted");

  const cashtags = (t.entities?.cashtags ?? [])
    .map((c) => (c.tag ?? "").trim().toUpperCase())
    .filter(Boolean);
  const hashtags = (t.entities?.hashtags ?? [])
    .map((h) => (h.tag ?? "").trim())
    .filter(Boolean);
  const mentions = (t.entities?.mentions ?? [])
    .map((m) => (m.username ?? "").trim())
    .filter(Boolean);

  const pm = t.public_metrics;
  const repostCount = pm?.repost_count ?? pm?.retweet_count ?? null;

  return {
    id: t.id,
    text: (t.text ?? "").trim(),
    authorId: t.author_id ?? null,
    authorUsername: author?.username ?? null,
    authorName: author?.name ?? null,
    createdAt: parseIsoOrNull(t.created_at ?? null),
    url: postUrlFromId(t.id),
    language: t.lang ?? null,
    metrics: {
      likeCount: pm?.like_count ?? null,
      repostCount,
      replyCount: pm?.reply_count ?? null,
      quoteCount: pm?.quote_count ?? null,
      bookmarkCount: pm?.bookmark_count ?? null,
      impressionCount: pm?.impression_count ?? null,
    },
    cashtags,
    hashtags,
    mentions,
    matchedTicker: params.matchedTicker,
    matchedCompanyNames: params.companyName ? [params.companyName] : [],
    matchedAliases: params.aliases,
    matchSignals: params.matchSignals,
    confidenceScore: params.confidenceScore,
    relevanceScore: params.relevanceScore,
    sourceProvider: params.sourceProvider,
    isRetweet,
    isReply,
    isQuote,
    conversationId: t.conversation_id ?? null,
  };
}

