import { createHash } from "crypto";

const TRACKING = new Set([
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

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function toAbsoluteUrl(baseUrl: string, href: string): string | null {
  const h = (href ?? "").trim();
  if (!h) return null;
  if (/^(mailto:|tel:|javascript:)/i.test(h)) return null;
  try {
    return new URL(h, baseUrl).toString();
  } catch {
    return null;
  }
}

export function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export function guessExtension(url: string): string | null {
  try {
    const p = new URL(url).pathname.toLowerCase();
    const m = /\.([a-z0-9]{1,6})$/.exec(p);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function safeTextExcerpt(text: string, max = 320): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export function isSameDomain(aUrl: string, bUrl: string): boolean {
  const a = hostnameOf(aUrl).replace(/^www\./, "");
  const b = hostnameOf(bUrl).replace(/^www\./, "");
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function nowIso(): string {
  return new Date().toISOString();
}

