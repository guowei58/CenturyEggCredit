import type { Confidence, RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

/** openFDA split enforcement recalls into food / device / drug; the unified `enforcement/recall.json` path is gone (404). */
const ENFORCEMENT_ENDPOINTS = [
  "https://api.fda.gov/food/enforcement.json",
  "https://api.fda.gov/device/enforcement.json",
  "https://api.fda.gov/drug/enforcement.json",
] as const;

function rid() {
  return `fda_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function appendApiKey(u: URL): void {
  const k = process.env.FDA_OPENFDA_API_KEY?.trim();
  if (k) u.searchParams.set("api_key", k);
}

const ENTITY_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "llc",
  "l.l.c",
  "ltd",
  "limited",
  "lp",
  "l.p",
  "llp",
  "plc",
  "sa",
  "ag",
  "gmbh",
  "bv",
  "nv",
  "holdings",
  "holding",
]);

function normalizeEntityText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantEntityTokens(value: string): string[] {
  return normalizeEntityText(value)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !ENTITY_SUFFIXES.has(token));
}

function buildEntityNameVariants(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const variants = new Set<string>();
  variants.add(trimmed);

  const normalized = normalizeEntityText(trimmed);
  if (normalized) variants.add(normalized);

  const tokens = normalized.split(/\s+/).filter(Boolean);
  let cut = tokens.length;
  while (cut > 0 && ENTITY_SUFFIXES.has(tokens[cut - 1] ?? "")) cut -= 1;
  const stripped = tokens.slice(0, cut).join(" ").trim();
  if (stripped) variants.add(stripped);

  return Array.from(variants).filter(Boolean);
}

function buildSearchClause(q: string, start?: string, end?: string, state?: string): string {
  const parts: string[] = [];
  const safe = q.replace(/"/g, '\\"');
  parts.push(`recalling_firm:"${safe}"`);
  if (start || end) {
    const gte = (start ?? "19000101").replace(/-/g, "");
    const lte = (end ?? "21000101").replace(/-/g, "");
    parts.push(`report_date:[${gte}+TO+${lte}]`);
  }
  const st = state?.trim().toUpperCase();
  if (st && st.length === 2) {
    parts.push(`state:${st}`);
  }
  return parts.join(" AND ");
}

function isOpenFdaNoResults404(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const err = (raw as { error?: { message?: string } }).error;
  return err?.message === "No matches found!";
}

function docUrlForProductType(productType: string | undefined): string {
  const p = (productType ?? "").toLowerCase();
  if (p.includes("food")) return "https://open.fda.gov/apis/food/enforcement/";
  if (p.includes("device")) return "https://open.fda.gov/apis/device/enforcement/";
  return "https://open.fda.gov/apis/drug/enforcement/";
}

function humanRecordUrl(productType: string | undefined, eventId: string): string {
  const p = (productType ?? "").toLowerCase();
  if (eventId && p.includes("device")) {
    return `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm?id=${encodeURIComponent(eventId)}`;
  }
  if (eventId) {
    return `https://www.accessdata.fda.gov/scripts/ires/index.cfm?Event=${encodeURIComponent(eventId)}`;
  }
  return docUrlForProductType(productType);
}

type FetchPart = { rows: Record<string, unknown>[]; requestUrl: string; error?: string };

async function fetchOneEnforcement(endpoint: string, search: string, limit: number): Promise<FetchPart> {
  const u = new URL(endpoint);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("search", search);
  appendApiKey(u);
  const requestUrl = u.toString();

  const res = await fetch(requestUrl, { cache: "no-store" });
  const raw = await res.json().catch(() => null);

  if (res.ok) {
    const results = (raw as { results?: unknown })?.results;
    const rows = Array.isArray(results) ? (results as Record<string, unknown>[]) : [];
    return { rows, requestUrl };
  }
  if (res.status === 404 && isOpenFdaNoResults404(raw)) {
    return { rows: [], requestUrl };
  }
  const msg = (raw as { error?: { message?: string } })?.error?.message;
  return { rows: [], requestUrl, error: msg || `openFDA HTTP ${res.status}` };
}

function rowKey(r: Record<string, unknown>): string {
  const num = String(r.recall_number ?? "").trim();
  return num || `${r.product_type ?? ""}:${r.event_id ?? ""}`;
}

function nameMatchConfidence(query: string, variants: string[], recallingFirm: string): Confidence {
  const firmNorm = normalizeEntityText(recallingFirm);
  if (!firmNorm) return "Low";

  const variantNorms = variants.map((v) => normalizeEntityText(v)).filter(Boolean);
  if (variantNorms.some((v) => v === firmNorm)) return "High";

  const firmTokens = new Set(significantEntityTokens(recallingFirm));
  const queryTokens = Array.from(new Set(significantEntityTokens(query)));
  if (queryTokens.length === 0) return "Low";

  const hits = queryTokens.filter((token) => firmTokens.has(token)).length;
  if (hits === queryTokens.length) return "High";
  if (hits >= Math.max(2, Math.ceil(queryTokens.length / 2))) return "Medium";
  if (hits > 0) return "Low";
  return "Low";
}

export const openFdaAdapter: RegulatoryAgencyAdapter = {
  sourceId: "fda_openfda",
  validateConfig: () => ({
    ok: true,
    mode: process.env.FDA_OPENFDA_API_KEY?.trim() ? "api_key" : "no_key",
    message: process.env.FDA_OPENFDA_API_KEY?.trim()
      ? "openFDA with API key (higher rate limits)."
      : "Unauthenticated openFDA mode (lower rate limits).",
  }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const variants = buildEntityNameVariants(q);
    const exactClauses = variants.map((variant) => buildSearchClause(variant, params.startDate, params.endDate, params.state));
    const limitEach = 12;

    const parts = await Promise.all(
      exactClauses.flatMap((search) =>
        ENFORCEMENT_ENDPOINTS.map((ep) => fetchOneEnforcement(ep, search, limitEach))
      )
    );

    const failures = parts.filter((p) => p.error);
    if (failures.length === parts.length) {
      return {
        ok: false,
        error: failures[0].error ? `openFDA: ${failures[0].error}` : "openFDA request failed.",
        requestUrl: parts[0].requestUrl,
        raw: { searches: exactClauses, parts },
      };
    }

    const seen = new Set<string>();
    const merged: Record<string, unknown>[] = [];
    for (const p of parts) {
      for (const r of p.rows) {
        const key = rowKey(r);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(r);
      }
    }

    const ranked = merged
      .map((row) => {
        const recallingFirm = String(row.recalling_firm ?? "").trim();
        const confidence = nameMatchConfidence(q, variants, recallingFirm);
        return { row, confidence };
      })
      .sort((a, b) => {
        const rank: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1 };
        const byConfidence = rank[b.confidence] - rank[a.confidence];
        if (byConfidence !== 0) return byConfidence;
        const da = String(a.row.report_date ?? "");
        const db = String(b.row.report_date ?? "");
        return db.localeCompare(da);
      });

    const preferred = ranked.filter((item) => item.confidence !== "Low");
    const visible = (preferred.length > 0 ? preferred : ranked).slice(0, 25);
    const primaryRequestUrl = parts.find((p) => p.requestUrl)?.requestUrl ?? "";
    const omittedLowConfidenceCount = preferred.length > 0 ? ranked.length - preferred.length : 0;

    const retrievedAt = new Date().toISOString();
    const results: RegulatorySearchResult[] = visible.map(({ row: r, confidence }) => {
      const recallingFirm = String(r.recalling_firm ?? "").trim();
      const product = String(r.product_description ?? "").trim();
      const reason = String(r.reason_for_recall ?? "").trim();
      const classification = String(r.classification ?? "").trim();
      const status = String(r.status ?? "").trim();
      const reportDate = String(r.report_date ?? "").trim();
      const recallNumber = String(r.recall_number ?? "").trim();
      const city = String(r.city ?? "").trim();
      const state = String(r.state ?? "").trim();
      const country = String(r.country ?? "").trim();
      const productType = String(r.product_type ?? "").trim();
      const eventId = String(r.event_id ?? "").trim();
      const detailBase = humanRecordUrl(productType, eventId);

      return {
        result_id: rid(),
        source_id: "fda_openfda",
        source_name: "FDA / openFDA",
        agency: "FDA",
        category: "Healthcare / Product / Recalls / Enforcement",
        query_used: q,
        matched_entity: recallingFirm || q,
        matched_entity_confidence: confidence,
        title: product || `Recall ${recallNumber || ""}`.trim(),
        record_type: "recall",
        record_subtype: [classification, productType].filter(Boolean).join(" · ") || undefined,
        description: reason || undefined,
        filing_or_record_date: reportDate
          ? `${reportDate.slice(0, 4)}-${reportDate.slice(4, 6)}-${reportDate.slice(6, 8)}`
          : undefined,
        status: status || undefined,
        state: state || undefined,
        facility_name: recallingFirm || undefined,
        facility_address: [city, state, country].filter(Boolean).join(", ") || undefined,
        agency_identifier: recallNumber || undefined,
        detail_url: detailBase,
        raw_source_url: detailBase,
        raw_json: r,
        confidence,
        importance_score: confidence === "High" ? 80 : confidence === "Medium" ? 55 : 20,
        retrieved_at: retrievedAt,
        request_url: primaryRequestUrl,
        notes: `${exactClauses.join(" || ")} · Source: food/device/drug enforcement APIs`,
      };
    });

    const warnings: string[] = [];
    if (preferred.length > 0 && omittedLowConfidenceCount > 0) {
      warnings.push(
        `Suppressed ${omittedLowConfidenceCount} low-confidence recall hit(s) whose recalling_firm did not closely match the searched company name.`
      );
    }
    if (ranked.length > 25) {
      warnings.push(`Showing 25 of ${ranked.length} recalls matched across food, device, and drug enforcement.`);
    }
    if (preferred.length === 0 && ranked.length > 0) {
      warnings.push("Only low-confidence phrase matches were found in the FDA recall datasets for this company name.");
    }

    return {
      ok: true,
      requestUrl: primaryRequestUrl,
      raw: { searches: exactClauses, mergedCount: ranked.length, results: visible.map((item) => item.row) },
      results,
      warnings: warnings.length ? warnings : undefined,
    };
  },
};
