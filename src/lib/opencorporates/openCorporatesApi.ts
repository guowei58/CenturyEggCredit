import { fetchWithBackoff, ocThrottle } from "@/lib/opencorporates/rateLimitedFetch";
import type { OpenCorporatesCompanyHit, OpenCorporatesSearchMeta } from "@/lib/opencorporates/types";

const API_ROOT = "https://api.opencorporates.com/v0.4";

function buildSearchUrl(q: string, apiToken: string, jurisdictionCode?: string | null): string {
  const u = new URL(`${API_ROOT}/companies/search`);
  u.searchParams.set("q", q);
  u.searchParams.set("api_token", apiToken);
  u.searchParams.set("per_page", "30");
  u.searchParams.set("inactive", "false");
  if (jurisdictionCode?.trim()) {
    u.searchParams.set("jurisdiction_code", jurisdictionCode.trim());
  }
  return u.toString();
}

export function parseOpenCorporatesSearchPayload(raw: Record<string, unknown>): {
  companies: OpenCorporatesCompanyHit[];
  totalCount: number;
  page: number;
  totalPages: number;
} {
  const results = raw.results as Record<string, unknown> | undefined;
  const companiesWrappers = (results?.companies as unknown[]) ?? [];
  const companies: OpenCorporatesCompanyHit[] = [];
  for (const w of companiesWrappers) {
    if (!w || typeof w !== "object") continue;
    const c = (w as { company?: Record<string, unknown> }).company;
    if (!c || typeof c !== "object") continue;
    const name = String(c.name ?? "").trim();
    const company_number = String(c.company_number ?? "").trim();
    const jurisdiction_code = String(c.jurisdiction_code ?? "").trim();
    if (!name || !jurisdiction_code) continue;
    companies.push({
      name,
      company_number,
      jurisdiction_code,
      inactive: Boolean(c.inactive),
      current_status: c.current_status != null ? String(c.current_status) : null,
      registered_address_in_full:
        c.registered_address_in_full != null ? String(c.registered_address_in_full) : null,
      opencorporates_url: c.opencorporates_url != null ? String(c.opencorporates_url) : null,
      registry_url: c.registry_url != null ? String(c.registry_url) : null,
      incorporation_date: c.incorporation_date != null ? String(c.incorporation_date) : null,
      previous_names: c.previous_names,
    });
  }
  const totalCount = Number(results?.total_count ?? companies.length) || companies.length;
  const page = Number(results?.page ?? 1) || 1;
  const totalPages = Number(results?.total_pages ?? 1) || 1;
  return { companies, totalCount, page, totalPages };
}

export async function openCorporatesCompanySearch(params: {
  query: string;
  jurisdictionCode?: string | null;
  apiToken: string;
}): Promise<
  | { ok: true; meta: OpenCorporatesSearchMeta; companies: OpenCorporatesCompanyHit[] }
  | { ok: false; status: number; bodySnippet: string; meta?: Partial<OpenCorporatesSearchMeta> }
> {
  await ocThrottle();
  const url = buildSearchUrl(params.query, params.apiToken, params.jurisdictionCode);
  const res = await fetchWithBackoff(url, { method: "GET", retries: 4 });
  const text = await res.text();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      status: res.status,
      bodySnippet: text.slice(0, 400),
    };
  }

  const apiEndpoint = url.replace(/api_token=[^&]+/, "api_token=redacted");
  const responseAt = new Date().toISOString();

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      bodySnippet: text.slice(0, 500),
      meta: {
        apiEndpoint,
        query: params.query,
        jurisdictionFilter: params.jurisdictionCode ?? null,
        responseAt,
        resultCount: 0,
        raw,
      },
    };
  }

  const parsed = parseOpenCorporatesSearchPayload(raw);
  const meta: OpenCorporatesSearchMeta = {
    apiEndpoint,
    query: params.query,
    jurisdictionFilter: params.jurisdictionCode ?? null,
    responseAt,
    resultCount: parsed.totalCount,
    totalPages: parsed.totalPages,
    page: parsed.page,
    raw,
  };

  return { ok: true, meta, companies: parsed.companies };
}

/** Fetch full company record when search hits lack `registered_address_in_full`. */
export async function openCorporatesCompanyGet(params: {
  jurisdictionCode: string;
  companyNumber: string;
  apiToken: string;
}): Promise<Record<string, unknown> | null> {
  await ocThrottle();
  const u = new URL(
    `${API_ROOT}/companies/${encodeURIComponent(params.jurisdictionCode)}/${encodeURIComponent(params.companyNumber)}`
  );
  u.searchParams.set("api_token", params.apiToken);
  const res = await fetchWithBackoff(u.toString(), { method: "GET", retries: 3 });
  const text = await res.text();
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!res.ok) return null;
    const results = raw.results as Record<string, unknown> | undefined;
    const company = results?.company as Record<string, unknown> | undefined;
    return company ?? null;
  } catch {
    return null;
  }
}
