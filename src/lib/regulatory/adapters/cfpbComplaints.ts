import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

type CfpbComplaint = {
  _id?: string | null;
  _source?: {
    complaint_id?: string | null;
    company?: string | null;
    product?: string | null;
    sub_product?: string | null;
    issue?: string | null;
    sub_issue?: string | null;
    state?: string | null;
    date_received?: string | null;
    date_sent_to_company?: string | null;
    submitted_via?: string | null;
    timely?: string | null;
    company_response?: string | null;
    company_public_response?: string | null;
    complaint_what_happened?: string | null;
  };
};

type CfpbComplaintSearchResponse = {
  _meta?: {
    break_points?: Record<string, [number | string, string] | undefined> | null;
  } | null;
  hits?: {
    total?: {
      value?: number | null;
    } | null;
    hits?: CfpbComplaint[] | null;
  } | null;
};

const CFPB_API_BASE = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/";
const CFPB_PAGE_SIZE = 100;

function rid() {
  return `cfpb_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function buildCompanySuggestUrl(q: string): string {
  const url = new URL("_suggest_company", CFPB_API_BASE);
  url.searchParams.set("text", q);
  url.searchParams.set("size", "10");
  return url.toString();
}

function formatDateOnly(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDefaultDateRange(params: RegulatorySearchParams): { minDate: string; maxDate: string } {
  const end = params.endDate ? new Date(params.endDate) : new Date();
  const start = params.startDate ? new Date(params.startDate) : new Date(end);
  if (!params.startDate) start.setMonth(start.getMonth() - 3);
  return { minDate: formatDateOnly(start), maxDate: formatDateOnly(end) };
}

function buildCompanySearchUrl(
  company: string,
  options: {
    state?: string;
    minDate?: string;
    maxDate?: string;
    size?: number;
    page?: number;
    searchAfter?: string;
  } = {},
): string {
  const url = new URL(CFPB_API_BASE);
  url.searchParams.set("company", company);
  url.searchParams.set("size", String(options.size ?? CFPB_PAGE_SIZE));
  url.searchParams.set("no_aggs", "true");
  url.searchParams.set("no_highlight", "true");
  url.searchParams.set("sort", "created_date_desc");
  if (options.minDate) url.searchParams.set("date_received_min", options.minDate);
  if (options.maxDate) url.searchParams.set("date_received_max", options.maxDate);
  if (options.state?.trim()) url.searchParams.set("state", options.state.trim().toUpperCase());
  if (options.page && options.searchAfter) {
    url.searchParams.set("page", String(options.page));
    url.searchParams.set("frm", String(options.size ?? CFPB_PAGE_SIZE));
    url.searchParams.set("search_after", options.searchAfter);
  }
  return url.toString();
}

function buildReadableCompanySearchUrl(company: string, state?: string): string {
  const url = new URL("https://www.consumerfinance.gov/data-research/consumer-complaints/search/");
  url.searchParams.set("company", company);
  if (state?.trim()) url.searchParams.set("state", state.trim().toUpperCase());
  return url.toString();
}

function complaintDetailUrl(id: string): string {
  return `https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail/${encodeURIComponent(id)}`;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function extractComplaintRows(raw: unknown): CfpbComplaint[] {
  if (Array.isArray(raw)) return raw as CfpbComplaint[];
  return ((raw as CfpbComplaintSearchResponse | null)?.hits?.hits ?? []).filter(Boolean);
}

function extractBreakpoint(raw: unknown, page: number): string | undefined {
  const value = (raw as CfpbComplaintSearchResponse | null)?._meta?.break_points?.[String(page)];
  if (!value || value.length < 2) return undefined;
  return `${value[0]}_${value[1]}`;
}

function extractTotal(raw: unknown): number {
  return Number((raw as CfpbComplaintSearchResponse | null)?.hits?.total?.value ?? 0) || 0;
}

export const cfpbComplaintsAdapter: RegulatoryAgencyAdapter = {
  sourceId: "cfpb_complaints",
  validateConfig: () => ({ ok: true, mode: "no_key", message: "Searching CFPB complaint-database company matches." }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const suggestUrl = buildCompanySuggestUrl(q);
    const suggestRes = await fetch(suggestUrl, { cache: "no-store", headers: { accept: "application/json" } });
    const suggestRaw = await suggestRes.json().catch(() => null);
    if (!suggestRes.ok) {
      return {
        ok: false,
        error: `CFPB company suggest failed (HTTP ${suggestRes.status}).`,
        requestUrl: suggestUrl,
        raw: suggestRaw,
      };
    }

    const suggestions = (Array.isArray(suggestRaw) ? suggestRaw : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .slice(0, 10);

    let complaintRows: CfpbComplaint[] = [];
    let complaintUrl: string | undefined;
    let complaintCount = 0;
    let pagesFetched = 0;
    const { minDate, maxDate } = buildDefaultDateRange(params);
    if (suggestions.length > 0) {
      complaintUrl = buildCompanySearchUrl(suggestions[0], {
        state: params.state,
        minDate,
        maxDate,
        size: CFPB_PAGE_SIZE,
      });
      try {
        let page = 1;
        let raw = await fetchJsonWithTimeout<unknown>(complaintUrl, 12000);
        complaintRows.push(...extractComplaintRows(raw));
        complaintCount = extractTotal(raw) || complaintRows.length;
        pagesFetched += 1;

        while (complaintRows.length < complaintCount) {
          const nextPage = page + 1;
          const searchAfter = extractBreakpoint(raw, nextPage);
          if (!searchAfter) break;
          const nextUrl = buildCompanySearchUrl(suggestions[0], {
            state: params.state,
            minDate,
            maxDate,
            size: CFPB_PAGE_SIZE,
            page: nextPage,
            searchAfter,
          });
          raw = await fetchJsonWithTimeout<unknown>(nextUrl, 12000);
          const nextRows = extractComplaintRows(raw);
          if (nextRows.length === 0) break;
          complaintRows.push(...nextRows);
          pagesFetched += 1;
          page = nextPage;
        }
      } catch {
        complaintRows = [];
      }
    }

    const retrievedAt = new Date().toISOString();
    const complaintResults: RegulatorySearchResult[] = complaintRows.map((row) => {
      const src = row._source ?? {};
      const complaintId = String(src.complaint_id ?? row._id ?? "").trim();
      const company = String(src.company ?? suggestions[0] ?? q).trim();
      const product = String(src.product ?? "").trim();
      const issue = String(src.issue ?? "").trim();
      const subIssue = String(src.sub_issue ?? "").trim();
      const description = String(src.complaint_what_happened ?? "").trim();
      const confidence = matchConfidenceFromQuery(q, [company, product, issue, subIssue]);
      const detailUrl = complaintId ? complaintDetailUrl(complaintId) : complaintUrl || suggestUrl;

      return {
        result_id: rid(),
        source_id: "cfpb_complaints",
        source_name: "CFPB Complaints",
        agency: "CFPB",
        category: "Consumer Finance Complaints",
        query_used: q,
        matched_entity: company || q,
        matched_entity_confidence: confidence,
        title: [product, issue].filter(Boolean).join(" - ") || `Complaint ${complaintId || ""}`.trim(),
        record_type: "complaint",
        record_subtype: subIssue || undefined,
        description: description || undefined,
        filing_or_record_date: String(src.date_received ?? "").trim() || undefined,
        last_updated: String(src.date_sent_to_company ?? "").trim() || undefined,
        status: String(src.company_response ?? src.timely ?? "").trim() || undefined,
        state: String(src.state ?? "").trim() || undefined,
        agency_identifier: complaintId || undefined,
        detail_url: detailUrl,
        raw_source_url: complaintUrl || suggestUrl,
        raw_json: row,
        confidence,
        importance_score: 60,
        notes: String(src.company_public_response ?? "").trim() || undefined,
        retrieved_at: retrievedAt,
        request_url: complaintUrl || suggestUrl,
      };
    });

    if (complaintResults.length > 0) {
      return {
        ok: true,
        requestUrl: complaintUrl || suggestUrl,
        raw: { suggestions, complaintCount, returnedCount: complaintRows.length, pagesFetched, minDate, maxDate },
        results: complaintResults,
        warnings: [`Showing all CFPB complaints received from ${minDate} through ${maxDate}.`],
      };
    }

    const fallbackResults: RegulatorySearchResult[] = suggestions.map((company) => {
      const confidence = matchConfidenceFromQuery(q, [company]);
      const detailUrl = buildReadableCompanySearchUrl(company, params.state);
      const rawUrl = buildCompanySearchUrl(company, { state: params.state, minDate, maxDate, size: CFPB_PAGE_SIZE });
      return {
        result_id: rid(),
        source_id: "cfpb_complaints",
        source_name: "CFPB Complaints",
        agency: "CFPB",
        category: "Consumer Finance Complaints",
        query_used: q,
        matched_entity: company,
        matched_entity_confidence: confidence,
        title: company,
        record_type: "company_match",
        description: "Company name match in CFPB's complaint database. Open the source link to view complaints for this company.",
        detail_url: detailUrl,
        raw_source_url: rawUrl,
        raw_json: { company },
        confidence,
        importance_score: confidence === "High" ? 55 : 35,
        retrieved_at: retrievedAt,
        request_url: suggestUrl,
      };
    });

    return {
      ok: true,
      requestUrl: suggestUrl,
      raw: suggestRaw,
      results: fallbackResults,
      warnings:
        fallbackResults.length > 0
          ? ["CFPB returned company matches, but complaint-detail retrieval was too large or too slow for this query, so this tab is showing direct company matches instead."]
          : undefined,
    };
  },
};
