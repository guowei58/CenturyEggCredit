/**
 * Fetch official and IR HTML pages and collect absolute PDF hrefs (no JavaScript rendering).
 */

import type { PdfForRanking } from "./types";

const FETCH_HEADERS = {
  "User-Agent": "CenturyEggCredit/1.0 (presentations pipeline)",
  Accept: "text/html,application/xhtml+xml",
};

function absolutize(base: string, href: string): string | null {
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

function extractPdfLinks(html: string, pageUrl: string): PdfForRanking[] {
  const results: PdfForRanking[] = [];
  const seen = new Set<string>();
  const re = /href\s*=\s*["']([^"'#?\s][^"']*\.pdf[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    const abs = absolutize(pageUrl, raw);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    const title = decodeURIComponent(abs.split("/").pop() || abs).replace(/\+/g, " ");
    results.push({
      url: abs,
      title,
      sourcePage: pageUrl,
      date: null,
    });
  }
  return results;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      return null;
    }
    return await res.text();
  } catch {
    return null;
  }
}

export async function crawlOfficialSiteAndExtractPdfs(
  officialWebsite: string,
  irPage: string | null
): Promise<PdfForRanking[]> {
  const seeds = new Set<string>();
  const root = officialWebsite.trim();
  if (root.startsWith("http")) seeds.add(root);
  const ir = irPage?.trim();
  if (ir && ir.startsWith("http")) seeds.add(ir);

  const merged: PdfForRanking[] = [];
  const seenUrl = new Set<string>();

  for (const pageUrl of Array.from(seeds)) {
    const html = await fetchHtml(pageUrl);
    if (!html) continue;
    for (const p of extractPdfLinks(html, pageUrl)) {
      if (seenUrl.has(p.url)) continue;
      seenUrl.add(p.url);
      merged.push(p);
    }
  }
  return merged;
}
