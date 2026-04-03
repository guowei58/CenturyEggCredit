import type { AccessLevel, PageType, ResearchProviderId } from "./types";
import { fetchWithTimeout, hostnameOf, normalizeUrlForMatch, originOf, parseIsoOrNull } from "./utils";

const UA = "CenturyEggCredit/1.0 (research-finder)";

export type ExtractedPage = {
  finalUrl: string;
  normalizedUrl: string;
  canonicalUrl: string | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  byline: string | null;
  sectionLabel: string | null;
  publishedAt: string | null;
  excerpt: string | null;
  accessLevel: AccessLevel;
  isPubliclyAccessible: boolean;
  pageType: PageType;
  notes: string[];
};

function pickFirstMatch(re: RegExp, html: string): string | null {
  const m = re.exec(html);
  if (!m) return null;
  return (m[1] ?? "").toString().replace(/\s+/g, " ").trim() || null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function classifyPageType(args: { provider: ResearchProviderId; url: string; title: string; h1: string; meta: string; text: string; gated: boolean }): PageType {
  const blob = `${args.title} ${args.h1} ${args.meta} ${args.text}`.toLowerCase();
  const u = args.url.toLowerCase();
  if (args.gated && args.provider === "wsj_bankruptcy") return "gated_article";
  if (/podcast/.test(blob) || /\/podcast/.test(u)) return "podcast";
  if (/webinar/.test(blob) || /\/webinar/.test(u) || /\/events?\//.test(u)) return /event/.test(blob) ? "event" : "webinar";
  if (/transcript/.test(blob)) return "transcript";
  if (/presentation|slides|deck/.test(blob) || /\.pdf($|\?)/.test(u)) return "presentation";
  if (/report|research|analysis|note|insight|outlook/.test(blob)) return "research_report";
  if (/news|press/.test(blob)) return "news";
  if (/article/.test(blob) || /\/news\//.test(u) || args.provider === "wsj_bankruptcy") return "article";
  if (/about|careers|privacy|terms|login|signup|trial/.test(u)) return "irrelevant";
  return "generic_page";
}

function detectAccessLevel(args: { provider: ResearchProviderId; status: number; html: string; url: string }): { access: AccessLevel; public: boolean; notes: string[] } {
  const notes: string[] = [];
  if (args.status === 401 || args.status === 403) return { access: "gated", public: false, notes: ["http_auth_or_forbidden"] };
  if (args.status === 402) return { access: "gated", public: false, notes: ["payment_required"] };
  const h = args.html.toLowerCase();
  const u = args.url.toLowerCase();

  const paywallHints = /(subscribe|subscription|required|sign in|log in|trial|metered|already a subscriber)/i;
  const wsjHard = args.provider === "wsj_bankruptcy" && /wsj/.test(u) && paywallHints.test(h);
  if (wsjHard) return { access: "gated", public: true, notes: ["wsj_paywall_signals"] };

  if (paywallHints.test(h) && /paywall|subscriber/i.test(h)) {
    notes.push("paywall_signals");
    return { access: "partially_gated", public: true, notes };
  }

  return { access: "public", public: true, notes };
}

export async function extractPublicMetadata(params: { provider: ResearchProviderId; url: string; timeoutMs: number }): Promise<ExtractedPage> {
  const notes: string[] = [];
  let res: Response;
  try {
    res = await fetchWithTimeout(params.url, params.timeoutMs, {
      method: "GET",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow",
    });
  } catch (e) {
    return {
      finalUrl: params.url,
      normalizedUrl: normalizeUrlForMatch(params.url) ?? params.url,
      canonicalUrl: null,
      title: null,
      metaDescription: null,
      h1: null,
      byline: null,
      sectionLabel: null,
      publishedAt: null,
      excerpt: null,
      accessLevel: "gated",
      isPubliclyAccessible: false,
      pageType: "irrelevant",
      notes: [`fetch_error:${e instanceof Error ? e.message : "unknown"}`],
    };
  }

  const finalUrl = res.url || params.url;
  const html = await res.text().catch(() => "");
  const norm = normalizeUrlForMatch(finalUrl) ?? normalizeUrlForMatch(params.url) ?? finalUrl;

  const titleRaw =
    pickFirstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, html) ??
    pickFirstMatch(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i, html);
  const metaDesc =
    pickFirstMatch(/name=["']description["'][^>]*content=["']([^"']+)["']/i, html) ??
    pickFirstMatch(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i, html);
  const canonical =
    pickFirstMatch(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i, html) ?? null;

  const h1 = stripTags(pickFirstMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html) ?? "") || null;

  const pub =
    parseIsoOrNull(pickFirstMatch(/property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i, html)) ??
    parseIsoOrNull(pickFirstMatch(/name=["']article:published_time["'][^>]*content=["']([^"']+)["']/i, html)) ??
    parseIsoOrNull(pickFirstMatch(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i, html)) ??
    null;

  const byline =
    pickFirstMatch(/property=["']article:author["'][^>]*content=["']([^"']+)["']/i, html) ??
    pickFirstMatch(/name=["']author["'][^>]*content=["']([^"']+)["']/i, html) ??
    null;

  const { access, public: isPublic, notes: accessNotes } = detectAccessLevel({ provider: params.provider, status: res.status, html, url: finalUrl });
  notes.push(...accessNotes);

  const textExcerpt = stripTags(html).slice(0, 360) || null;
  const pageType = classifyPageType({
    provider: params.provider,
    url: finalUrl,
    title: titleRaw ?? "",
    h1: h1 ?? "",
    meta: metaDesc ?? "",
    text: textExcerpt ?? "",
    gated: access !== "public",
  });

  return {
    finalUrl,
    normalizedUrl: norm,
    canonicalUrl: canonical ? (normalizeUrlForMatch(canonical) ?? canonical) : null,
    title: titleRaw ? stripTags(titleRaw) : null,
    metaDescription: metaDesc ? stripTags(metaDesc) : null,
    h1,
    byline: byline ? stripTags(byline) : null,
    sectionLabel: null,
    publishedAt: pub,
    excerpt: textExcerpt,
    accessLevel: access,
    isPubliclyAccessible: isPublic,
    pageType,
    notes,
  };
}

