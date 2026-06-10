import { getCandidateWebsites } from "@/lib/presentations/candidates";
import {
  buildIrSeedUrls,
  collectHostsFromUrls,
  extractPresentationLinksFromHtml,
  hostMatchesAllowedDomain,
} from "../extract-links";
import type { PresentationAdapterContext, PresentationDiscoveryInput, RawPresentationLink } from "../types";
import { inferPeriodFromText, parseFiscalPeriodToken } from "../period";

const FETCH_HEADERS = {
  "User-Agent": "CenturyEggCredit/1.0 (presentation discovery)",
  Accept: "text/html,application/xhtml+xml,application/json",
};

async function fetchText(url: string, timeoutMs = 18_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/json") && !ct.includes("text/plain")) {
      return null;
    }
    return await res.text();
  } catch {
    return null;
  }
}

function scoreIrLink(title: string, url: string, period: string): { score: number; evidence: string[] } {
  const hay = `${title} ${url}`.toLowerCase();
  let score = 25;
  const evidence: string[] = ["live_ir"];
  const keywords = ["presentation", "investor", "earnings", "quarterly", "results", "deck", "slides"];
  for (const kw of keywords) {
    if (hay.includes(kw)) {
      score += 8;
      evidence.push(`keyword:${kw}`);
    }
  }
  const inferred = inferPeriodFromText(hay);
  const fp = parseFiscalPeriodToken(period);
  if (fp && inferred && inferred.toLowerCase().includes(`q${fp.quarter}`) && inferred.includes(String(fp.year))) {
    score += 20;
    evidence.push("period_match_in_link");
  }
  return { score, evidence };
}

export async function discoverLiveIrPresentations(
  input: PresentationDiscoveryInput,
  ctx: PresentationAdapterContext
): Promise<{ links: RawPresentationLink[]; irDomains: string[]; cdnDomains: string[] }> {
  const { candidates } = await getCandidateWebsites(input.ticker);
  const baseUrls = candidates.map((c) => c.url).slice(0, 6);
  const seeds = buildIrSeedUrls(baseUrls);
  const allowedHosts = new Set<string>([...ctx.irDomains, ...collectHostsFromUrls(seeds)]);

  const results: RawPresentationLink[] = [];
  const seen = new Set<string>();

  for (const pageUrl of seeds.slice(0, 14)) {
    const html = await fetchText(pageUrl);
    if (!html) continue;
    for (const link of extractPresentationLinksFromHtml(html, pageUrl)) {
      if (!hostMatchesAllowedDomain(link.url, allowedHosts)) {
        try {
          allowedHosts.add(new URL(link.url).hostname.toLowerCase());
        } catch {
          continue;
        }
      }
      const key = link.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const { score, evidence } = scoreIrLink(link.title, link.url, input.period);
      results.push({
        url: link.url,
        title: link.title,
        source_page_url: pageUrl,
        source_type: "live_ir",
        file_type: link.file_type,
        document_date: null,
        pre_score: score,
        evidence,
      });
    }
  }

  const irDomains = collectHostsFromUrls(baseUrls);
  const cdnDomains = collectHostsFromUrls(results.map((r) => r.url)).filter((h) => !irDomains.includes(h));

  return {
    links: results.sort((a, b) => b.pre_score - a.pre_score),
    irDomains,
    cdnDomains,
  };
}
