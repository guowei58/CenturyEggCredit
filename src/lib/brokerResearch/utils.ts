import { createHash } from "crypto";

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

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True if host equals domain or is a subdomain of it. */
export function hostMatchesBrokerDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

export function urlMatchesBrokerDomains(url: string, domains: string[]): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  return domains.some((d) => hostMatchesBrokerDomain(host, d));
}

export function normalizeTitleForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9\s'-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

export function stableResultId(brokerId: string, url: string, title: string): string {
  const h = createHash("sha256").update(`${brokerId}|${url}|${title}`).digest("hex");
  return h.slice(0, 32);
}

export function parsePublishedDate(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function escapeGoogleQueryToken(s: string): string {
  return s.replace(/"/g, "").trim();
}

export function isLikelyGenericLandingPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/research" || p === "/insights" || p === "/ideas") return true;
  if (/^\/(research|insights|ideas)\/?$/i.test(p)) return true;
  return false;
}
