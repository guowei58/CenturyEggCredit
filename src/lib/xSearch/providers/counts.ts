import { loadXSearchConfigFromEnv } from "../config";
import { buildXQuery } from "../query/queryBuilder";
import type { XSearchParams } from "../types";
import { fetchWithTimeout } from "../utils";
import { requireBearerToken } from "./base";

type CountsResponse = {
  meta?: { total_tweet_count?: number };
  errors?: Array<{ message?: string }>;
  title?: string;
  detail?: string;
};

function extractXCountsErrorMessage(json: CountsResponse, status: number): string {
  const msg =
    json.errors?.[0]?.message ||
    (typeof json.detail === "string" ? json.detail : "") ||
    (typeof json.title === "string" ? json.title : "") ||
    "";
  if (status === 402) {
    return `X counts returned HTTP 402 (Payment Required). Your plan/app may not be entitled to counts. ${msg ? `Details: ${msg}` : ""}`.trim();
  }
  return (msg ? `${msg} (HTTP ${status})` : `X counts HTTP ${status}`).trim();
}

export async function getRecentCountEstimate(params: XSearchParams): Promise<
  | { ok: true; count: number | null; query: string; explanation: string }
  | { ok: false; error: string; query?: string; explanation?: string }
> {
  const cfg = loadXSearchConfigFromEnv();
  if (!cfg.enableCounts) return { ok: true, count: null, query: "", explanation: "" };
  if (!cfg.bearerToken) {
    return { ok: false, error: "X_BEARER_TOKEN is not set" };
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

  const url = new URL("https://api.x.com/2/tweets/counts/recent");
  url.searchParams.set("query", built.query);
  url.searchParams.set("granularity", "hour");

  let res: Response;
  try {
    res = await fetchWithTimeout(url.toString(), cfg.timeoutMs, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error", query: built.query, explanation: built.explanation };
  }

  let json: CountsResponse;
  try {
    json = (await res.json()) as CountsResponse;
  } catch {
    return { ok: false, error: "Invalid JSON response", query: built.query, explanation: built.explanation };
  }
  if (!res.ok) {
    return { ok: false, error: extractXCountsErrorMessage(json, res.status), query: built.query, explanation: built.explanation };
  }

  return { ok: true, count: json.meta?.total_tweet_count ?? null, query: built.query, explanation: built.explanation };
}

