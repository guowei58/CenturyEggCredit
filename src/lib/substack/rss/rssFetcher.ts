import { fetchWithTimeout } from "../utils";

const USER_AGENT = "CenturyEggCredit/1.0 (Substack RSS ingester)";

export async function fetchRssXml(url: string, timeoutMs: number): Promise<string> {
  const res = await fetchWithTimeout(url, timeoutMs, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml, */*" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RSS fetch failed HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  return res.text();
}

