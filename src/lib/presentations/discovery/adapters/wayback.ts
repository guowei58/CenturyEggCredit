import { extractPresentationLinksFromHtml, hostMatchesAllowedDomain } from "../extract-links";
import type { PresentationAdapterContext, RawPresentationLink } from "../types";
import { inferPeriodFromText, parseFiscalPeriodToken } from "../period";

function timestampNearDate(isoDate: string): string {
  return isoDate.replace(/-/g, "").slice(0, 8);
}

async function waybackAvailableUrl(url: string, timestamp: string): Promise<string | null> {
  try {
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${timestamp}`;
    const res = await fetch(api, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      archived_snapshots?: { closest?: { available?: boolean; url?: string } };
    };
    const closest = data.archived_snapshots?.closest;
    if (closest?.available && closest.url) return closest.url;
    return null;
  } catch {
    return null;
  }
}

async function cdxSnapshots(domain: string, limit = 30): Promise<string[]> {
  try {
    const q = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`${domain}/*`)}&output=json&filter=statuscode:200&filter=mimetype:text/html&limit=${limit}&collapse=urlkey`;
    const res = await fetch(q, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const rows = (await res.json()) as string[][];
    if (!Array.isArray(rows) || rows.length < 2) return [];
    const urlIdx = rows[0]?.indexOf("original") ?? -1;
    if (urlIdx < 0) return [];
    const urls: string[] = [];
    for (let i = 1; i < rows.length; i++) {
      const u = rows[i]?.[urlIdx];
      if (typeof u === "string" && /events|presentation|results|earnings/i.test(u)) urls.push(u);
    }
    return urls;
  } catch {
    return [];
  }
}

function scoreWaybackLink(title: string, url: string, period: string): { score: number; evidence: string[] } {
  const hay = `${title} ${url}`.toLowerCase();
  let score = 18;
  const evidence: string[] = ["wayback_archive"];
  if (/presentation|earnings|investor|quarterly|results/.test(hay)) {
    score += 12;
    evidence.push("presentation_keywords");
  }
  const inferred = inferPeriodFromText(hay);
  const fp = parseFiscalPeriodToken(period);
  if (fp && inferred && inferred.includes(String(fp.year))) {
    score += 15;
    evidence.push("period_in_archive_link");
  }
  return { score, evidence };
}

/** Resolve archived IR pages and PDF links near the earnings date. */
export async function discoverWaybackPresentations(
  seedUrls: string[],
  period: string,
  anchorDate: string,
  ctx: PresentationAdapterContext
): Promise<RawPresentationLink[]> {
  const ts = timestampNearDate(anchorDate);
  const allowedHosts = new Set([...ctx.irDomains, ...ctx.cdnDomains]);
  const results: RawPresentationLink[] = [];
  const seen = new Set<string>();

  for (const url of seedUrls.slice(0, 8)) {
    const archivedPage = await waybackAvailableUrl(url, ts);
    if (!archivedPage) continue;
    try {
      const res = await fetch(archivedPage, { signal: AbortSignal.timeout(18_000) });
      if (!res.ok) continue;
      const html = await res.text();
      for (const link of extractPresentationLinksFromHtml(html, archivedPage)) {
        if (!hostMatchesAllowedDomain(link.url, allowedHosts)) continue;
        const archivedPdf = await waybackAvailableUrl(link.url, ts);
        const finalUrl = archivedPdf ?? link.url;
        const key = finalUrl.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const { score, evidence } = scoreWaybackLink(link.title, finalUrl, period);
        results.push({
          url: finalUrl,
          title: link.title,
          source_page_url: archivedPage,
          source_type: "wayback",
          file_type: link.file_type,
          document_date: null,
          pre_score: score,
          evidence: [...evidence, "from_archived_ir_page"],
        });
      }
    } catch {
      /* skip */
    }
  }

  for (const domain of ctx.irDomains.slice(0, 3)) {
    const historical = await cdxSnapshots(domain, 25);
    for (const histUrl of historical.slice(0, 6)) {
      const archivedPage = await waybackAvailableUrl(histUrl, ts);
      if (!archivedPage) continue;
      try {
        const res = await fetch(archivedPage, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) continue;
        const html = await res.text();
        for (const link of extractPresentationLinksFromHtml(html, archivedPage)) {
          const archivedPdf = await waybackAvailableUrl(link.url, ts);
          const finalUrl = archivedPdf ?? link.url;
          const key = finalUrl.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const { score, evidence } = scoreWaybackLink(link.title, finalUrl, period);
          results.push({
            url: finalUrl,
            title: link.title,
            source_page_url: archivedPage,
            source_type: "wayback",
            file_type: link.file_type,
            document_date: null,
            pre_score: score,
            evidence: [...evidence, "cdx_ir_snapshot"],
          });
        }
      } catch {
        /* skip */
      }
    }
  }

  return results.sort((a, b) => b.pre_score - a.pre_score);
}
