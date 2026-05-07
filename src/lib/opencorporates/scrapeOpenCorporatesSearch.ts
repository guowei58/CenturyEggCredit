import * as cheerio from "cheerio";
import { OPENCORPORATES_WEB_HEADERS } from "@/lib/opencorporates/scrapeOpenCorporatesBrowserHeaders";
import { fetchWithBackoff, ocThrottle } from "@/lib/opencorporates/rateLimitedFetch";
import type { OpenCorporatesCompanyHit, OpenCorporatesSearchMeta } from "@/lib/opencorporates/types";

const BASE = "https://opencorporates.com";

function looksLikeCaptcha(html: string): boolean {
  return /captcha|challenge|verify you are human|haproxy challenge/i.test(html.slice(0, 8000));
}

/**
 * OpenCorporates **website** search (`/companies?q=…`). Parses company links from `/companies/{jurisdiction}/{number}` paths.
 */
export async function scrapeOpenCorporatesCompanySearch(params: {
  query: string;
  jurisdictionCode?: string | null;
}): Promise<
  | { ok: true; meta: OpenCorporatesSearchMeta; companies: OpenCorporatesCompanyHit[] }
  | { ok: false; status: number; bodySnippet: string }
> {
  await ocThrottle();
  const u = new URL(`${BASE}/companies`);
  u.searchParams.set("q", params.query);
  if (params.jurisdictionCode?.trim()) {
    u.searchParams.set("jurisdiction_code", params.jurisdictionCode.trim());
  }

  const res = await fetchWithBackoff(u.toString(), {
    method: "GET",
    retries: 2,
    headers: { ...OPENCORPORATES_WEB_HEADERS },
  });
  const html = await res.text();
  const responseAt = new Date().toISOString();
  if (!res.ok) {
    return { ok: false, status: res.status, bodySnippet: html.slice(0, 400) };
  }
  if (looksLikeCaptcha(html)) {
    return {
      ok: false,
      status: 503,
      bodySnippet:
        "OpenCorporates search returned a CAPTCHA / challenge page. Automated scraping cannot solve CAPTCHAs — try again later or from a different network.",
    };
  }

  const $ = cheerio.load(html);
  const companies: OpenCorporatesCompanyHit[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const m = href.match(/\/companies\/([a-z0-9_]{2,12})\/([^/?#]+)/i);
    if (!m) return;
    const jurisdiction_code = m[1].toLowerCase();
    const company_number = decodeURIComponent(m[2]);
    const key = `${jurisdiction_code}:${company_number}`;
    if (seen.has(key)) return;
    seen.add(key);

    const name =
      $(el).text().replace(/\s+/g, " ").trim() ||
      ($(el).closest("li, tr, article").find("h2, h3, .name").first().text().replace(/\s+/g, " ").trim() ??
        "");

    let snippet = "";
    const row = $(el).closest("li, tr");
    if (row.length) {
      snippet = row.text().replace(/\s+/g, " ").trim().slice(0, 280);
    }

    companies.push({
      name: name || company_number,
      company_number,
      jurisdiction_code,
      inactive: /\bdissolved\b/i.test(snippet),
      current_status: null,
      registered_address_in_full: snippet.length > 12 ? snippet : null,
      opencorporates_url: href.startsWith("http") ? href : `${BASE}${href.startsWith("/") ? "" : "/"}${href}`,
      registry_url: null,
      incorporation_date: null,
      previous_names: null,
    });
  });

  const raw = {
    scrape: true,
    url: u.toString(),
    parsed_count: companies.length,
  } as Record<string, unknown>;

  const meta: OpenCorporatesSearchMeta = {
    apiEndpoint: u.toString(),
    query: params.query,
    jurisdictionFilter: params.jurisdictionCode ?? null,
    responseAt,
    resultCount: companies.length,
    raw,
  };

  return { ok: true, meta, companies };
}
