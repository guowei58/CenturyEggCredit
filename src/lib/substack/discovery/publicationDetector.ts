import type { SubstackPublication } from "../types";
import { hostnameOf, originOf, normalizeUrlForMatch, nowIso, stableId } from "../utils";

export type DetectedPublication = {
  publication: SubstackPublication;
  confidence: number;
  isPostUrl: boolean;
};

function looksLikeSubstackPostPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (p.startsWith("/p/")) return true;
  if (p.includes("/p/")) return true;
  return false;
}

function isSubstackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "substack.com" || h.endsWith(".substack.com");
}

export function detectPublicationFromHit(params: {
  url: string;
  title: string;
  snippet: string;
}): DetectedPublication | null {
  const norm = normalizeUrlForMatch(params.url) ?? params.url;
  const host = hostnameOf(norm);
  const origin = originOf(norm);
  if (!origin || !host) return null;

  const blob = `${params.title} ${params.snippet}`.toLowerCase();
  const path = (() => {
    try {
      return new URL(norm).pathname;
    } catch {
      return "/";
    }
  })();

  const postPath = looksLikeSubstackPostPath(path);
  const substackHost = isSubstackHost(host);

  // Conservative: custom domains require "Substack" mention or /p/ path.
  const hasSubstackHint = blob.includes("substack") || blob.includes("published on substack");
  const likely = substackHost || (postPath && hasSubstackHint);

  if (!likely) return null;

  const subdomain = host.endsWith(".substack.com") ? host.replace(/\.substack\.com$/i, "") : null;
  const baseUrl = `${origin}/`;

  let confidence = 0.4;
  if (substackHost) confidence += 0.35;
  if (postPath) confidence += 0.2;
  if (hasSubstackHint) confidence += 0.15;
  confidence = Math.min(1, confidence);

  const now = nowIso();
  const pub: SubstackPublication = {
    id: stableId(["substack_pub", baseUrl.toLowerCase()]),
    name: null,
    subdomain,
    baseUrl,
    feedUrl: null,
    isLikelySubstack: true,
    detectionMethod: "serpapi",
    status: "unknown",
    confidenceScore: confidence,
    lastDiscoveredAt: now,
    lastIngestedAt: null,
  };

  return { publication: pub, confidence, isPostUrl: postPath };
}

