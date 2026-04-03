import { createHash } from "crypto";

const TRACKING = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"]);

export function nowIso(): string {
  return new Date().toISOString();
}

export function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

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

export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function parseIsoOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal, next: { revalidate: 0 } }).finally(() => clearTimeout(tid));
}

export function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

