/**
 * URL/title helpers for deduplication and display.
 */

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
]);

export function normalizeUrlForMatch(href: string): string | null {
  try {
    const u = new URL(href);
    u.hash = "";
    for (const k of Array.from(u.searchParams.keys())) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
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

/** Collapse whitespace and lowercase for fuzzy title match. */
export function normalizeTitleForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9\s'-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaccard similarity on word sets (0–1). */
export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeTitleForMatch(a).split(" ").filter((w) => w.length > 1));
  const wb = new Set(normalizeTitleForMatch(b).split(" ").filter((w) => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const x of Array.from(wa)) {
    if (wb.has(x)) inter += 1;
  }
  const union = wa.size + wb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function parseIsoOrNull(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Alpha Vantage time_published: often YYYYMMDDTHHmmss */
export function parseAlphaVantageTime(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s.trim());
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return parseIsoOrNull(s);
}

export function unixSecondsToIso(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  return new Date(sec * 1000).toISOString();
}

export function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}
