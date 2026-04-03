/**
 * Resolve company name and search-result URL candidates for presentations discovery.
 * Requires SERPER_API_KEY for non-empty candidates; otherwise returns [] and pipeline shows fallback message.
 */

import { getCompanyProfile } from "@/lib/sec-edgar";

type SerperOrganic = { link?: string; title?: string };

export async function getCandidateWebsites(ticker: string): Promise<{
  companyName: string;
  candidates: { url: string; title: string }[];
}> {
  const safe = ticker.trim().toUpperCase();
  const profile = await getCompanyProfile(safe);
  const companyName = profile?.name?.trim() || safe;
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) {
    return { companyName, candidates: [] };
  }

  const q = `${companyName} ${safe} investor relations site`;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q, num: 15 }),
    });
    if (!res.ok) {
      return { companyName, candidates: [] };
    }
    const data = (await res.json()) as { organic?: SerperOrganic[] };
    const organic = Array.isArray(data.organic) ? data.organic : [];
    const candidates = organic
      .map((o) => ({
        url: typeof o.link === "string" ? o.link.trim() : "",
        title: typeof o.title === "string" ? o.title.trim() : "",
      }))
      .filter((c) => c.url.startsWith("http"));
    return { companyName, candidates };
  } catch {
    return { companyName, candidates: [] };
  }
}
