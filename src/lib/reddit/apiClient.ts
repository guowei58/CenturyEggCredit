import type { RedditEnvConfig } from "./config";
import type { RedditSortMode, RedditTimeRange } from "./types";
import { clearRedditTokenCache, getRedditAccessToken } from "./oauthClient";

export type RedditListingChild = {
  kind: string;
  data?: RedditPostData;
};

export type RedditPostData = {
  id?: string;
  name?: string;
  title?: string;
  selftext?: string;
  subreddit?: string;
  author?: string;
  created_utc?: number;
  score?: number;
  upvote_ratio?: number;
  num_comments?: number;
  permalink?: string;
  url?: string;
  is_self?: boolean;
  domain?: string;
  link_flair_text?: string;
  over_18?: boolean;
  stickied?: boolean;
  locked?: boolean;
  removed_by_category?: string | null;
  /** present when deleted */
  author_flair_text?: string;
};

export type RedditSearchListingResponse = {
  data?: {
    after?: string | null;
    before?: string | null;
    children?: RedditListingChild[];
  };
};

function buildUrl(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const u = new URL(`https://oauth.reddit.com${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export async function redditAuthenticatedFetch(
  cfg: RedditEnvConfig,
  pathWithQuery: string
): Promise<{ ok: true; json: unknown } | { ok: false; error: string; status?: number }> {
  const tok = await getRedditAccessToken(cfg);
  if (!tok.ok) return { ok: false, error: tok.error };

  let res: Response;
  try {
    res = await fetch(pathWithQuery, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tok.token}`,
        "User-Agent": cfg.userAgent,
        Accept: "application/json",
      },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reddit request failed" };
  }

  if (res.status === 401) {
    clearRedditTokenCache();
    return { ok: false, error: "Reddit API unauthorized (token may be invalid; check credentials)" };
  }

  if (res.status === 429) {
    return { ok: false, error: "Reddit rate limited (429); wait and retry", status: 429 };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: "Reddit response not JSON", status: res.status };
  }

  if (!res.ok) {
    const errObj = json as { message?: string; error?: number };
    return { ok: false, error: errObj.message || `Reddit HTTP ${res.status}`, status: res.status };
  }

  return { ok: true, json };
}

export async function searchRedditPosts(params: {
  cfg: RedditEnvConfig;
  q: string;
  subreddit: string | null;
  sort: RedditSortMode;
  t: RedditTimeRange;
  limit: number;
  after?: string | null;
}): Promise<{ ok: true; children: RedditListingChild[]; after: string | null } | { ok: false; error: string }> {
  const path = params.subreddit ? `/r/${encodeURIComponent(params.subreddit)}/search.json` : "/search.json";
  const url = buildUrl(path, {
    q: params.q,
    restrict_sr: params.subreddit ? true : false,
    sort: params.sort === "comments" ? "comments" : params.sort,
    t: params.t,
    limit: params.limit,
    after: params.after || undefined,
    raw_json: 1,
    include_over_18: false,
  });

  const r = await redditAuthenticatedFetch(params.cfg, url);
  if (!r.ok) return { ok: false, error: r.error };

  const root = r.json as { data?: RedditSearchListingResponse["data"] };
  const data = root?.data;
  const children = Array.isArray(data?.children) ? data.children : [];
  const after = data?.after ?? null;
  return { ok: true, children, after };
}
