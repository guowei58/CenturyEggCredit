import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

function rid() {
  return `rg_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function apiKey(): string | undefined {
  return process.env.REGULATIONS_GOV_API_KEY?.trim() || process.env.DATA_GOV_API_KEY?.trim() || "DEMO_KEY";
}

function redactKey(url: string): string {
  return url.replace(/api_key=[^&]+/, "api_key=(redacted)");
}

function arrayify<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

export const regulationsGovAdapter: RegulatoryAgencyAdapter = {
  sourceId: "regulations_gov",
  validateConfig: () => {
    const explicitKey = process.env.REGULATIONS_GOV_API_KEY?.trim() || process.env.DATA_GOV_API_KEY?.trim();
    if (explicitKey) return { ok: true, mode: "api_key", message: "Using your configured Regulations.gov API key." };
    return { ok: true, mode: "no_key", message: "Using Regulations.gov DEMO_KEY fallback (lower rate limits)." };
  },
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const documentUrl = new URL("https://api.regulations.gov/v4/documents");
    documentUrl.searchParams.set("filter[searchTerm]", q);
    documentUrl.searchParams.set("page[size]", "20");
    documentUrl.searchParams.set("sort", "-postedDate");
    documentUrl.searchParams.set("include", "attachments");
    const docketUrl = new URL("https://api.regulations.gov/v4/dockets");
    docketUrl.searchParams.set("filter[searchTerm]", q);
    docketUrl.searchParams.set("page[size]", "10");
    docketUrl.searchParams.set("sort", "-lastModifiedDate");
    const key = apiKey()!;
    documentUrl.searchParams.set("api_key", key);
    docketUrl.searchParams.set("api_key", key);
    if (params.startDate) documentUrl.searchParams.set("filter[postedDate][ge]", params.startDate);
    if (params.endDate) documentUrl.searchParams.set("filter[postedDate][le]", params.endDate);

    const [documentsRes, docketsRes] = await Promise.all([
      fetch(documentUrl.toString(), {
        cache: "no-store",
        headers: { "X-Api-Key": key },
      }),
      fetch(docketUrl.toString(), {
        cache: "no-store",
        headers: { "X-Api-Key": key },
      }),
    ]);
    const [documentsRaw, docketsRaw] = await Promise.all([
      documentsRes.json().catch(() => null),
      docketsRes.json().catch(() => null),
    ]);
    if (!documentsRes.ok) {
      return {
        ok: false,
        error: `Regulations.gov request failed (HTTP ${documentsRes.status}).`,
        requestUrl: redactKey(documentUrl.toString()),
        raw: documentsRaw,
      };
    }

    const documentData = documentsRaw as { data?: Array<Record<string, unknown>>; included?: Array<Record<string, unknown>> };
    const docketData = docketsRaw as { data?: Array<Record<string, unknown>> };
    const documentRows = documentData?.data ?? [];
    const docketRows = docketsRes.ok ? docketData?.data ?? [] : [];
    const attachmentById = new Map<string, Record<string, unknown>>();
    for (const included of arrayify(documentData?.included)) {
      const id = String(included?.id ?? "").trim();
      if (!id) continue;
      attachmentById.set(id, included);
    }
    const retrievedAt = new Date().toISOString();
    const seen = new Set<string>();
    const results: RegulatorySearchResult[] = [];

    for (const d of documentRows) {
      const id = String(d?.id ?? "").trim();
      const attrs = (d?.attributes ?? {}) as Record<string, unknown>;
      const rel = (d?.relationships ?? {}) as Record<string, any>;
      const title = String(attrs?.title ?? attrs?.documentType ?? "Document").trim();
      const posted = String(attrs?.postedDate ?? "").trim();
      const agency = String((attrs?.agencyId as string | undefined) ?? "").trim();
      const subtype = String(attrs?.documentType ?? "").trim();
      const abstract = String(attrs?.abstract ?? "").trim();
      const frDoc = String(attrs?.frDocNum ?? "").trim();
      const docketId =
        String(attrs?.docketId ?? "").trim() ||
        String(rel?.docket?.data?.id ?? "").trim();
      const commentStart = String(attrs?.commentStartDate ?? "").trim();
      const commentEnd = String(attrs?.commentEndDate ?? "").trim();
      const openForComment = String(attrs?.openForComment ?? "").trim();
      const rin = String(attrs?.rin ?? "").trim();
      const lastModified = String(attrs?.lastModifiedDate ?? "").trim();
      const attachmentIds = arrayify(rel?.attachments?.data).map((item) => String(item?.id ?? "").trim()).filter(Boolean);
      const attachmentFormats = attachmentIds
        .map((attachmentId) => (attachmentById.get(attachmentId)?.attributes ?? {}) as Record<string, unknown>)
        .map((attachmentAttrs) => String(attachmentAttrs?.fileFormats ?? attachmentAttrs?.format ?? "").trim())
        .filter(Boolean);
      const detail =
        id ? `https://www.regulations.gov/document/${encodeURIComponent(id)}` : "https://www.regulations.gov/";
      const confidence = matchConfidenceFromQuery(q, [title, abstract, agency, subtype, docketId, frDoc, rin]);
      const keyId = `document:${id || title}`;
      if (seen.has(keyId)) continue;
      seen.add(keyId);

      results.push({
        result_id: rid(),
        source_id: "regulations_gov",
        source_name: "Regulations.gov",
        agency: agency || "Federal agencies",
        category: "Rulemaking Dockets / Comments / Agency Documents",
        query_used: q,
        matched_entity: params.companyName?.trim() || q,
        matched_entity_confidence: confidence,
        title,
        record_type: "document",
        record_subtype: subtype || undefined,
        description: abstract || undefined,
        filing_or_record_date: posted || undefined,
        effective_date: commentStart || undefined,
        last_updated: lastModified || undefined,
        status: openForComment ? `Open for comment: ${openForComment}` : undefined,
        docket_number: docketId || undefined,
        agency_identifier: frDoc || rin || undefined,
        document_url: detail,
        detail_url: detail,
        raw_source_url: detail,
        raw_json: d,
        confidence,
        importance_score: confidence === "High" ? 80 : confidence === "Medium" ? 55 : 25,
        notes:
          [
            frDoc ? `FR document: ${frDoc}` : "",
            rin ? `RIN: ${rin}` : "",
            commentEnd ? `Comment deadline: ${commentEnd}` : "",
            attachmentFormats.length ? `Attachments: ${attachmentFormats.slice(0, 3).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        retrieved_at: retrievedAt,
        request_url: redactKey(documentUrl.toString()),
      });
    }

    for (const d of docketRows) {
      const id = String(d?.id ?? "").trim();
      const attrs = (d?.attributes ?? {}) as Record<string, unknown>;
      const title = String(attrs?.title ?? attrs?.docketTitle ?? "Docket").trim();
      const agency = String(attrs?.agencyId ?? "").trim();
      const docketId = String(attrs?.docketId ?? id).trim();
      const commentStart = String(attrs?.commentStartDate ?? "").trim();
      const commentEnd = String(attrs?.commentEndDate ?? "").trim();
      const lastModified = String(attrs?.lastModifiedDate ?? "").trim();
      const rin = String(attrs?.rin ?? "").trim();
      const keyId = `docket:${docketId}`;
      if (seen.has(keyId)) continue;
      seen.add(keyId);
      const detail = docketId ? `https://www.regulations.gov/docket/${encodeURIComponent(docketId)}` : "https://www.regulations.gov/";
      const confidence = matchConfidenceFromQuery(q, [title, agency, docketId, rin]);
      results.push({
        result_id: rid(),
        source_id: "regulations_gov",
        source_name: "Regulations.gov",
        agency: agency || "Federal agencies",
        category: "Rulemaking Dockets / Comments / Agency Documents",
        query_used: q,
        matched_entity: params.companyName?.trim() || q,
        matched_entity_confidence: confidence,
        title,
        record_type: "docket",
        record_subtype: "Rulemaking docket",
        description: [commentStart ? `Comments opened ${commentStart}` : "", commentEnd ? `close ${commentEnd}` : ""].filter(Boolean).join(" · ") || undefined,
        filing_or_record_date: commentStart || undefined,
        last_updated: lastModified || undefined,
        docket_number: docketId || undefined,
        agency_identifier: rin || undefined,
        document_url: detail,
        detail_url: detail,
        raw_source_url: detail,
        raw_json: d,
        confidence,
        importance_score: confidence === "High" ? 85 : confidence === "Medium" ? 60 : 30,
        notes: [rin ? `RIN: ${rin}` : "", commentEnd ? `Comment deadline: ${commentEnd}` : ""].filter(Boolean).join(" · ") || undefined,
        retrieved_at: retrievedAt,
        request_url: redactKey(docketUrl.toString()),
      });
    }

    results.sort((a, b) => {
      const rank = (value: string) => (value === "High" ? 2 : value === "Medium" ? 1 : 0);
      const diff = rank(b.confidence) - rank(a.confidence);
      if (diff !== 0) return diff;
      return String(b.last_updated ?? b.filing_or_record_date ?? "").localeCompare(String(a.last_updated ?? a.filing_or_record_date ?? ""));
    });

    return {
      ok: true,
      requestUrl: redactKey(documentUrl.toString()),
      raw: { documentsRaw, docketsRaw: docketsRes.ok ? docketsRaw : null },
      results: results.slice(0, 25),
      warnings: docketsRes.ok ? undefined : ["Docket enrichment was unavailable for this query; showing document matches only."],
    };
  },
};
