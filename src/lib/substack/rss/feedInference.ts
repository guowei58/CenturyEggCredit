import { hostnameOf, originOf } from "../utils";

export function inferFeedUrl(baseUrl: string): string | null {
  const origin = originOf(baseUrl);
  if (!origin) return null;
  // Substack supports /feed on both subdomains and custom domains.
  return `${origin}/feed`;
}

export function inferSubdomainFromBaseUrl(baseUrl: string): string | null {
  const host = hostnameOf(baseUrl);
  if (host.endsWith(".substack.com")) return host.replace(/\.substack\.com$/i, "");
  return null;
}

