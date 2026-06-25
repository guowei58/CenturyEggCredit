import { isPrivateWorkspaceKey, workspaceSearchCompanyName } from "@/lib/company-workspace-key";

const TRACKING = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"]);

export function normalizeUrlForMatch(href: string): string | null {
  try {
    const u = new URL(href);
    u.hash = "";
    for (const k of Array.from(u.searchParams.keys())) {
      if (TRACKING.has(k.toLowerCase())) u.searchParams.delete(k);
    }
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    u.pathname = path;
    return u.toString();
  } catch {
    return null;
  }
}

export function isAmbiguousTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  if (t.length <= 2) return true;
  // Common single-letter-ish or English word tickers can be noisy; keep tiny list.
  const noisy = new Set(["IT", "AI", "ON", "IN", "AT", "AS", "OR", "AN", "BE", "BY", "US", "WE"]);
  return noisy.has(t);
}

/** Cashtags that collide with common non-equity speech (e.g. SATS / satoshis). */
const CASHTAG_NOISY = new Set(["SATS", "BIT", "WEN", "MEME", "GME"]);

export function isCashtagNoisyTicker(ticker: string): boolean {
  return CASHTAG_NOISY.has(ticker.trim().toUpperCase());
}

export function needsFinanceScopedQuery(ticker: string): boolean {
  return isAmbiguousTicker(ticker) || isCashtagNoisyTicker(ticker);
}

export function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function parseIsoOrNull(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal, next: { revalidate: 0 } })
    .finally(() => clearTimeout(tid));
}

export function postUrlFromId(id: string): string {
  // Keep canonical-ish URL; username may be missing without extra expansions.
  return `https://x.com/i/web/status/${encodeURIComponent(id)}`;
}

/** Opens X.com search (Latest) for cashtag + optional company name. */
export function xComSearchUrl(ticker: string, companyName?: string): string {
  const tk = ticker.trim();
  if (!tk) return "https://x.com/search";
  if (isPrivateWorkspaceKey(tk)) {
    const name = workspaceSearchCompanyName(tk, companyName);
    return `https://x.com/search?q=${encodeURIComponent(`"${name}"`)}&f=live`;
  }
  const upper = tk.toUpperCase();
  const name = companyName?.trim();
  const q =
    name && name.toUpperCase() !== upper ? `$${upper} OR "${name}"` : `$${upper}`;
  return `https://x.com/search?q=${encodeURIComponent(q)}&f=live`;
}

