import type { RedditEnvConfig } from "./config";

type TokenState = {
  accessToken: string;
  expiresAtMs: number;
};

let cached: TokenState | null = null;

function basicAuthHeader(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/**
 * Reddit "script" app password grant. Tokens typically last 1 hour.
 * https://github.com/reddit-archive/reddit/wiki/OAuth2
 */
export async function getRedditAccessToken(cfg: RedditEnvConfig): Promise<
  | { ok: true; token: string }
  | { ok: false; error: string }
> {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.username || !cfg.password) {
    return { ok: false, error: "Reddit OAuth: set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD" };
  }

  const now = Date.now();
  if (cached && cached.expiresAtMs > now + 30_000) {
    return { ok: true, token: cached.accessToken };
  }

  const body = new URLSearchParams({
    grant_type: "password",
    username: cfg.username,
    password: cfg.password,
  });

  let res: Response;
  try {
    res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(cfg.clientId, cfg.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": cfg.userAgent,
      },
      body: body.toString(),
      next: { revalidate: 0 },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reddit token network error" };
  }

  let json: { access_token?: string; expires_in?: number; error?: string; message?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return { ok: false, error: "Reddit token: invalid JSON" };
  }

  if (!res.ok || !json.access_token) {
    const msg = json.error || json.message || `HTTP ${res.status}`;
    return { ok: false, error: `Reddit OAuth failed: ${msg}` };
  }

  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  cached = {
    accessToken: json.access_token,
    expiresAtMs: now + expiresIn * 1000,
  };

  return { ok: true, token: cached.accessToken };
}

/** Clear token (401 recovery + tests). */
export function clearRedditTokenCache(): void {
  cached = null;
}
