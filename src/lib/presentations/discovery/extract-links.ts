import type { PresentationFileType } from "./types";

export type ExtractedFileLink = {
  url: string;
  title: string;
  file_type: PresentationFileType;
};

const FILE_EXT_RE = /\.(pdf|pptx?)(?:[?#]|$)/i;

export function detectPresentationFileType(urlOrName: string): PresentationFileType | null {
  const m = FILE_EXT_RE.exec(urlOrName.toLowerCase());
  if (!m) return null;
  const ext = m[1]!.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "pptx") return "pptx";
  if (ext === "ppt") return "ppt";
  return null;
}

export function absolutizeUrl(base: string, href: string): string | null {
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

function titleFromUrl(url: string): string {
  try {
    const seg = decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
    return seg.replace(/\+/g, " ").replace(/[-_]+/g, " ").trim() || url;
  } catch {
    return url;
  }
}

function pushLink(results: ExtractedFileLink[], seen: Set<string>, pageUrl: string, href: string, title?: string) {
  const abs = absolutizeUrl(pageUrl, href);
  if (!abs) return;
  const file_type = detectPresentationFileType(abs);
  if (!file_type) return;
  const key = abs.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  results.push({
    url: abs,
    title: (title ?? titleFromUrl(abs)).trim() || titleFromUrl(abs),
    file_type,
  });
}

/** Extract PDF/PPT links from href attributes, embedded JSON, and script payloads. */
export function extractPresentationLinksFromHtml(html: string, pageUrl: string): ExtractedFileLink[] {
  const results: ExtractedFileLink[] = [];
  const seen = new Set<string>();

  const hrefRe = /href\s*=\s*["']([^"'#?\s][^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    pushLink(results, seen, pageUrl, m[1]!);
  }

  const urlInJsonRe = /https?:\\\/\\\/[^"'\\]+\.(?:pdf|pptx?)(?:\\\/[^"'\\]*)?/gi;
  while ((m = urlInJsonRe.exec(html)) !== null) {
    const decoded = m[0]!.replace(/\\\//g, "/");
    pushLink(results, seen, pageUrl, decoded);
  }

  const bareUrlRe = /https?:\/\/[^\s"'<>]+\.(?:pdf|pptx?)(?:\?[^\s"'<>]*)?/gi;
  while ((m = bareUrlRe.exec(html)) !== null) {
    pushLink(results, seen, pageUrl, m[0]!);
  }

  return results;
}

export function hostMatchesAllowedDomain(url: string, allowedHosts: Set<string>): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const allowed of allowedHosts) {
      const a = allowed.toLowerCase();
      if (host === a || host.endsWith(`.${a}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function collectHostsFromUrls(urls: string[]): string[] {
  const hosts = new Set<string>();
  for (const u of urls) {
    try {
      hosts.add(new URL(u).hostname.toLowerCase());
    } catch {
      /* skip */
    }
  }
  return Array.from(hosts);
}

export const IR_PATH_SUFFIXES = [
  "/events-and-presentations/default.aspx",
  "/events-and-presentations",
  "/financials/quarterly-results/default.aspx",
  "/events-presentations",
  "/presentations",
  "/quarterly-results",
  "/financial-results",
  "/news-events/events",
  "/investor-relations/events-and-presentations",
  "/investors/events-and-presentations",
  "/investors/presentations",
  "/investors/events",
];

export function buildIrSeedUrls(baseUrls: string[]): string[] {
  const seeds = new Set<string>();
  for (const base of baseUrls) {
    const trimmed = base.trim();
    if (!trimmed.startsWith("http")) continue;
    seeds.add(trimmed.replace(/\/+$/, ""));
    let origin: string;
    try {
      origin = new URL(trimmed).origin;
    } catch {
      continue;
    }
    for (const suffix of IR_PATH_SUFFIXES) {
      seeds.add(`${origin}${suffix}`);
    }
  }
  return Array.from(seeds);
}
