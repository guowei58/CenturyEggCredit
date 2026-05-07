import * as cheerio from "cheerio";
import { OPENCORPORATES_WEB_HEADERS } from "@/lib/opencorporates/scrapeOpenCorporatesBrowserHeaders";
import { fetchWithBackoff, ocThrottle } from "@/lib/opencorporates/rateLimitedFetch";

function looksLikeCaptcha(html: string): boolean {
  return /captcha|challenge|verify you are human|haproxy challenge|access denied|robot/i.test(html.slice(0, 8000));
}

/**
 * Load an OpenCorporates **website** company page and extract registered address + status when HTML is available.
 * Datacenter / automated requests may receive a CAPTCHA — see `blockedReason` in the result.
 */
export async function scrapeOpenCorporatesCompanyPage(pageUrl: string): Promise<{
  registered_address_in_full: string | null;
  current_status: string | null;
  blockedReason: string | null;
}> {
  await ocThrottle();
  let html: string;
  try {
    const res = await fetchWithBackoff(pageUrl, {
      method: "GET",
      retries: 2,
      headers: { ...OPENCORPORATES_WEB_HEADERS },
    });
    html = await res.text();
  } catch {
    return {
      registered_address_in_full: null,
      current_status: null,
      blockedReason: "Could not load company page (network).",
    };
  }

  if (looksLikeCaptcha(html)) {
    return {
      registered_address_in_full: null,
      current_status: null,
      blockedReason:
        "OpenCorporates returned a CAPTCHA / challenge page (common for automated requests). Try again later or confirm the company in a normal browser.",
    };
  }

  const $ = cheerio.load(html);

  let registered_address_in_full: string | null = null;

  /** Primary: definition lists */
  $("dt, th, .attribute-label, .label").each((_, el) => {
    const label = $(el).text().replace(/\s+/g, " ").trim();
    if (!/^registered address$/i.test(label)) return;
    const dd = $(el).next("dd");
    if (dd.length) {
      const t = dd.text().replace(/\s+/g, " ").trim();
      if (t.length > 8) registered_address_in_full = t;
    }
  });

  /** Alternate: table rows */
  if (!registered_address_in_full) {
    $("tr").each((_, row) => {
      const cells = $(row).find("td, th");
      if (cells.length < 2) return;
      const k = $(cells[0]).text().replace(/\s+/g, " ").trim();
      if (!/^registered address$/i.test(k)) return;
      const v = $(cells[1]).text().replace(/\s+/g, " ").trim();
      if (v.length > 8) registered_address_in_full = v;
    });
  }

  /** Generic: line after "Registered address" heading */
  if (!registered_address_in_full) {
    const body = $.root().text().replace(/\s+/g, " ");
    const m = body.match(/registered address\s*[:\s]+(.{12,240}?)(?=Current status|Company type|Incorporation|$)/i);
    if (m?.[1]) registered_address_in_full = m[1].trim();
  }

  let current_status: string | null = null;
  $("dt, th").each((_, el) => {
    const label = $(el).text().replace(/\s+/g, " ").trim();
    if (!/^current status$/i.test(label)) return;
    const dd = $(el).next("dd");
    if (dd.length) current_status = dd.text().replace(/\s+/g, " ").trim();
  });

  return {
    registered_address_in_full: registered_address_in_full?.trim() || null,
    current_status,
    blockedReason: null,
  };
}
