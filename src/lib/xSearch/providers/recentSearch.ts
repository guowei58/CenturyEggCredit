import { loadXSearchConfigFromEnv } from "../config";
import { buildXQuery } from "../query/queryBuilder";
import { normalizeTweet } from "../normalize/postNormalizer";
import type { NormalizedXPost, XPostProvider, XProviderResult, XSearchParams } from "../types";
import { clampInt, fetchWithTimeout } from "../utils";
import { requireBearerToken } from "./base";

type XApiRecentResponse = {
  data?: Array<Record<string, unknown>>;
  includes?: { users?: Array<Record<string, unknown>> };
  meta?: { result_count?: number; next_token?: string };
  errors?: Array<{ message?: string }>;
  title?: string;
  detail?: string;
};

function extractXErrorMessage(json: XApiRecentResponse, status: number, endpoint: string): string {
  const msg =
    json.errors?.[0]?.message ||
    (typeof json.detail === "string" ? json.detail : "") ||
    (typeof json.title === "string" ? json.title : "") ||
    "";
  if (status === 402) {
    return `X API ${endpoint} returned HTTP 402 (Payment Required). This usually means your X project/app is not entitled to this endpoint on the current plan. ${msg ? `Details: ${msg}` : ""}`.trim();
  }
  return (msg ? `${msg} (HTTP ${status})` : `X API ${endpoint} error HTTP ${status}`).trim();
}

function toUserMap(includes: XApiRecentResponse["includes"]): Map<string, { id: string; username?: string; name?: string }> {
  const m = new Map<string, { id: string; username?: string; name?: string }>();
  const users = includes?.users ?? [];
  for (const u of users) {
    const id = typeof u.id === "string" ? u.id : "";
    if (!id) continue;
    m.set(id, {
      id,
      username: typeof u.username === "string" ? u.username : undefined,
      name: typeof u.name === "string" ? u.name : undefined,
    });
  }
  return m;
}

export function createRecentSearchProvider(): XPostProvider {
  const cfg = loadXSearchConfigFromEnv();
  return {
    id: "recent_search",
    enabled: cfg.enabled.recent_search,
    async search(params: XSearchParams): Promise<XProviderResult> {
      if (!cfg.enabled.recent_search) {
        return { providerId: "recent_search", success: false, posts: [], error: "Recent search disabled" };
      }
      const token = requireBearerToken();
      const tk = params.ticker.trim().toUpperCase();
      const built = buildXQuery({
        ticker: tk,
        companyName: params.companyName,
        aliases: params.aliases,
        includeRetweets: params.includeRetweets ?? cfg.includeRetweets,
        language: params.language ?? cfg.defaultLanguage,
      });

      const limit = clampInt(params.limit ?? cfg.defaultLimit, 10, 100);

      const url = new URL("https://api.x.com/2/tweets/search/recent");
      url.searchParams.set("query", built.query);
      url.searchParams.set("max_results", String(limit));
      url.searchParams.set(
        "tweet.fields",
        [
          "created_at",
          "lang",
          "public_metrics",
          "entities",
          "conversation_id",
          "referenced_tweets",
          "author_id",
        ].join(",")
      );
      url.searchParams.set("expansions", "author_id");
      url.searchParams.set("user.fields", "username,name");

      let res: Response;
      try {
        res = await fetchWithTimeout(url.toString(), cfg.timeoutMs, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        return { providerId: "recent_search", success: false, posts: [], error: e instanceof Error ? e.message : "Network error" };
      }

      let json: XApiRecentResponse;
      try {
        json = (await res.json()) as XApiRecentResponse;
      } catch {
        return { providerId: "recent_search", success: false, posts: [], error: "Invalid JSON response" };
      }
      if (!res.ok) {
        const msg = extractXErrorMessage(json, res.status, "recent search");
        return { providerId: "recent_search", success: false, posts: [], error: msg, query: built.query, queryExplanation: built.explanation };
      }

      const usersById = toUserMap(json.includes);
      const data = Array.isArray(json.data) ? json.data : [];
      const posts: NormalizedXPost[] = [];

      for (const row of data) {
        const id = typeof row.id === "string" ? row.id : "";
        if (!id) continue;
        const tweet = row as unknown as Parameters<typeof normalizeTweet>[0]["tweet"];
        // provisional scoring signals (ranker will re-score later; keep simple confidence baseline here)
        const text = typeof (row as { text?: unknown }).text === "string" ? String((row as { text?: unknown }).text) : "";
        const signals: string[] = [];
        if (text.toLowerCase().includes(`$${tk}`.toLowerCase())) signals.push("cashtag");
        if (text.toLowerCase().includes(tk.toLowerCase())) signals.push("ticker");
        if (params.companyName && text.toLowerCase().includes(params.companyName.toLowerCase())) signals.push("company_name");

        const confidence = Math.min(1, 0.25 + signals.length * 0.18);
        posts.push(
          normalizeTweet({
            tweet,
            usersById,
            sourceProvider: "recent_search",
            matchedTicker: tk,
            companyName: params.companyName,
            aliases: params.aliases ?? [],
            matchSignals: signals,
            confidenceScore: Number(confidence.toFixed(3)),
            relevanceScore: 0,
          })
        );
      }

      return {
        providerId: "recent_search",
        success: true,
        posts,
        query: built.query,
        queryExplanation: built.explanation,
      };
    },
  };
}

