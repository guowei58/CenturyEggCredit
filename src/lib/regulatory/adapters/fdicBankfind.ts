import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

type FdicInstitutionRow = {
  data?: Record<string, unknown>;
};

function rid() {
  return `fdic_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function tokenizeQuery(q: string): string[] {
  return q
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

function quoted(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildNameVariants(q: string): string[] {
  const trimmed = q.trim();
  const upper = trimmed.toUpperCase();
  const normalized = upper.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const noSuffix = normalized.replace(/\b(NATIONAL ASSOCIATION|N A|NA|BANK|CORP(?:ORATION)?|CO(?:MPANY)?|INC(?:ORPORATED)?|LLC)\b/g, " ").replace(/\s+/g, " ").trim();
  const variants = [upper, normalized, noSuffix];

  // FDIC legal bank records often use charter suffixes even when users search the brand name.
  if (/\bBANK\b/.test(normalized) && !/\b(NATIONAL ASSOCIATION|N A|NA)\b/.test(normalized)) {
    variants.push(`${normalized}, NATIONAL ASSOCIATION`);
    variants.push(`${normalized} NATIONAL ASSOCIATION`);
    variants.push(`${normalized}, NA`);
    variants.push(`${normalized} NA`);
  }

  return [...new Set(variants.filter((value) => value.length >= 4))];
}

function buildFilters(q: string, state?: string): string {
  const variants = buildNameVariants(q);
  const phraseParts = variants.map((variant) => `NAME:${quoted(variant)}`);
  const tokenPrefixes = tokenizeQuery(q)
    .slice(0, 3)
    .map((t) => `NAME:${t}*`);
  const nameClause = phraseParts.length > 0 ? `(${phraseParts.join(" OR ")})` : tokenPrefixes.join(" AND ");
  const parts = [nameClause];
  if (state?.trim()) parts.push(`STALP:${state.trim().toUpperCase()}`);
  return parts.join(" AND ");
}

function fdicBankfindUrl(name: string): string {
  return `https://banks.data.fdic.gov/bankfind-suite/bankfind?searchField=NAME&searchValue=${encodeURIComponent(name)}`;
}

export const fdicBankfindAdapter: RegulatoryAgencyAdapter = {
  sourceId: "fdic_bankfind",
  validateConfig: () => ({ ok: true, mode: "no_key", message: "Searching FDIC BankFind Suite institutions API." }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const url = new URL("https://api.fdic.gov/banks/institutions");
    url.searchParams.set("filters", buildFilters(q, params.state));
    url.searchParams.set("limit", "10");
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString(), { cache: "no-store", headers: { accept: "application/json" } });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        error: `FDIC BankFind request failed (HTTP ${res.status}).`,
        requestUrl: url.toString(),
        raw,
      };
    }

    const rows = (((raw as { data?: unknown[] } | null)?.data ?? []) as FdicInstitutionRow[]);
    const retrievedAt = new Date().toISOString();
    const results: RegulatorySearchResult[] = rows.map((row) => {
      const d = row.data ?? {};
      const name = String(d.NAME ?? "").trim();
      const city = String(d.CITY ?? "").trim();
      const state = String(d.STALP ?? "").trim();
      const cert = String(d.CERT ?? "").trim();
      const status = Number(d.ACTIVE ?? 0) === 1 ? "Active" : "Inactive";
      const address = String(d.ADDRESS ?? "").trim();
      const web = String(d.WEBADDR ?? "").trim();
      const klass = String(d.BKCLASS ?? "").trim();
      const confidence = matchConfidenceFromQuery(q, [name, city, state, address]);
      const detailUrl = fdicBankfindUrl(name || q);

      return {
        result_id: rid(),
        source_id: "fdic_bankfind",
        source_name: "FDIC BankFind",
        agency: "FDIC",
        category: "Banks / Financial Institutions",
        query_used: q,
        matched_entity: name || q,
        matched_entity_confidence: confidence,
        title: name || "FDIC-insured institution",
        record_type: "institution",
        record_subtype: klass || undefined,
        description: [city, state].filter(Boolean).join(", ") || undefined,
        filing_or_record_date: String(d.INSDATE ?? "").trim() || undefined,
        last_updated: String(d.DATEUPDT ?? "").trim() || undefined,
        status,
        state: state || undefined,
        facility_name: name || undefined,
        facility_address: [address, city, state, String(d.ZIP ?? "").trim()].filter(Boolean).join(", ") || undefined,
        agency_identifier: cert || undefined,
        document_url: web || undefined,
        detail_url: detailUrl,
        raw_source_url: detailUrl,
        raw_json: row,
        confidence,
        importance_score: status === "Active" ? 70 : 35,
        notes: String(d.FDICREGN ?? "").trim() || undefined,
        retrieved_at: retrievedAt,
        request_url: url.toString(),
      };
    });

    return { ok: true, requestUrl: url.toString(), raw, results };
  },
};
