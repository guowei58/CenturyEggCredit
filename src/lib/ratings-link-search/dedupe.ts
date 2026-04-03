import { createHash } from "crypto";

import type { NormalizedRatingsLink } from "./types";

/** Strip tracking params and normalize host/path for deduplication. */
export function canonicalizeUrl(href: string): string | null {
  try {
    const u = new URL(href);
    const strip = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "gclid",
      "fbclid",
    ]);
    for (const k of Array.from(u.searchParams.keys())) {
      if (strip.has(k.toLowerCase())) u.searchParams.delete(k);
    }
    u.hash = "";
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    u.pathname = path;
    return u.toString();
  } catch {
    return null;
  }
}

export function stableLinkId(url: string, title: string): string {
  return createHash("sha256")
    .update(`${url}\n${title}`)
    .digest("hex")
    .slice(0, 24);
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "")
    .trim();
}

/**
 * Keep highest companyMatchScore per canonical URL; then collapse very similar titles per agency.
 */
export function dedupeNormalizedResults(results: NormalizedRatingsLink[]): NormalizedRatingsLink[] {
  const byUrl = new Map<string, NormalizedRatingsLink>();
  for (const r of results) {
    const canon = canonicalizeUrl(r.url) ?? r.url;
    const prev = byUrl.get(canon);
    if (!prev || r.companyMatchScore > prev.companyMatchScore) {
      byUrl.set(canon, { ...r, url: canon });
    }
  }

  const afterUrl = Array.from(byUrl.values()).sort((a, b) => b.companyMatchScore - a.companyMatchScore);
  const byAgencyTitle = new Map<string, NormalizedRatingsLink>();
  for (const r of afterUrl) {
    const key = `${r.agency}::${normalizeTitleKey(r.title)}`;
    const prev = byAgencyTitle.get(key);
    if (!prev || r.companyMatchScore > prev.companyMatchScore) {
      byAgencyTitle.set(key, r);
    }
  }
  return Array.from(byAgencyTitle.values());
}
