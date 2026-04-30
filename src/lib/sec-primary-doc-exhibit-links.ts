/**
 * Discover Exhibit 21 / subsidiary-schedule attachments linked from the primary filing HTML.
 * Many filers put only a pointer in the primary doc; the actual table lives at href targets under the same accession folder.
 */

const ALLOWED_HOSTS = new Set(["www.sec.gov", "sec.gov"]);

function isLikelySubsidiaryAttachmentUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  if (!path.includes("/archives/edgar/data/")) return false;
  if (/\.(pdf|jpg|jpeg|png|gif|zip|xlsx?|doc)$/i.test(path)) return false;
  if (/index\.json$/i.test(path)) return false;
  if (/\.xsl$/i.test(path)) return false;
  return /\.(htm|html|txt)$/i.test(path);
}

function normalizeArchivesUrl(u: URL): string {
  u.hash = "";
  return u.href;
}

/** Positive signals on URL path / query + anchor text (mirrors sec-filing-exhibits filename scoring). */
function scoreExhibit21Href(pathname: string, search: string, linkTextPlain: string): number {
  const p = pathname.toLowerCase();
  const q = search.toLowerCase();
  const t = linkTextPlain.toLowerCase();
  let score = 0;

  if (/index-|xslF|\.xsl$/i.test(pathname)) return 0;

  if (/(?:^|[^a-z0-9])ex21(?:[^0-9a-z]|\.(htm|html|txt)$)/i.test(pathname)) score += 100;
  if (/exhibit(?:[^a-z0-9]+)?21(?:[^0-9]|\.|$)/i.test(pathname)) score += 88;
  if (/\bsubsidiar/i.test(pathname)) score += 62;

  if (/\bex21\b/i.test(q)) score += 40;

  if (/exhibit[^a-z0-9]*21/i.test(t)) score += 82;
  if (/\bsubsidiar(?:y|ies)?\b/i.test(t)) score += 58;
  if (/\blist\s+of\s+subsidiaries\b/i.test(t)) score += 52;
  if (/\borganization\b.*\bsubsidiar/i.test(t)) score += 45;

  return score;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Returns ranked unique Archives URLs that likely point to Exhibit 21 or the subsidiary table (best first).
 */
export function extractExhibit21CandidateUrlsFromPrimaryHtml(html: string, baseDocUrl: string): string[] {
  if (!html || html.length < 80 || !baseDocUrl) return [];

  let base: URL;
  try {
    base = new URL(baseDocUrl);
  } catch {
    return [];
  }

  const candidates: { url: string; score: number }[] = [];
  const seen = new Set<string>();

  const anchorBlock = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let bm: RegExpExecArray | null;
  while ((bm = anchorBlock.exec(html)) !== null) {
    const block = bm[0];
    const hrefm = /\bhref\s*=\s*(["'])([^"']*)\1/i.exec(block);
    if (!hrefm?.[2]) continue;
    const hrefRaw = hrefm[2].trim();
    if (!hrefRaw || hrefRaw.startsWith("#") || /^javascript:/i.test(hrefRaw)) continue;

    let resolved: URL;
    try {
      resolved = new URL(hrefRaw, base);
    } catch {
      continue;
    }

    if (!ALLOWED_HOSTS.has(resolved.hostname.toLowerCase())) continue;
    if (!isLikelySubsidiaryAttachmentUrl(resolved)) continue;

    const normalized = normalizeArchivesUrl(resolved);
    if (seen.has(normalized)) continue;

    const inner = stripTags(block.replace(/^<a\b[^>]*>|<\/a>$/gi, ""));
    const score = scoreExhibit21Href(resolved.pathname, resolved.search, inner);
    if (score < 52) continue;

    seen.add(normalized);
    candidates.push({ url: normalized, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.map((c) => c.url);
}
