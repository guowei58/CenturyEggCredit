import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

function rid() {
  return `fr_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export const federalRegisterAdapter: RegulatoryAgencyAdapter = {
  sourceId: "federal_register",
  validateConfig: () => ({ ok: true, mode: "no_key" }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
    url.searchParams.set("per_page", String(Math.min(Math.max(params.filters?.pageSize as number ?? 25, 1), 100)));
    url.searchParams.set("order", "newest");
    url.searchParams.set("conditions[term]", q);
    if (params.startDate) url.searchParams.set("conditions[publication_date][gte]", params.startDate);
    if (params.endDate) url.searchParams.set("conditions[publication_date][lte]", params.endDate);

    const res = await fetch(url.toString(), { cache: "no-store" });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: `Federal Register request failed (HTTP ${res.status}).`, requestUrl: url.toString(), raw };
    }

    const docs = (raw as any)?.results as any[] | undefined;
    const topDocs = (docs ?? []).slice(0, 10);
    const detailResponses = await Promise.allSettled(
      topDocs.map(async (doc) => {
        const documentNumber = String(doc?.document_number ?? "").trim();
        if (!documentNumber) return null;
        const detailUrl = `https://www.federalregister.gov/api/v1/documents/${encodeURIComponent(documentNumber)}.json`;
        const detailRes = await fetch(detailUrl, { cache: "no-store" });
        if (!detailRes.ok) return null;
        const detailRaw = await detailRes.json().catch(() => null);
        return { documentNumber, detailRaw };
      })
    );
    const detailByNumber = new Map<string, any>();
    for (const item of detailResponses) {
      if (item.status !== "fulfilled" || !item.value?.documentNumber) continue;
      detailByNumber.set(item.value.documentNumber, item.value.detailRaw);
    }
    const retrievedAt = new Date().toISOString();
    const results: RegulatorySearchResult[] = (docs ?? []).map((d) => {
      const docNumber = String(d?.document_number ?? "").trim();
      const detail = detailByNumber.get(docNumber) ?? d;
      const title = String(detail?.title ?? d?.title ?? "").trim() || "Federal Register document";
      const type = String(detail?.type ?? d?.type ?? "").trim() || "document";
      const agencyNames = Array.isArray(detail?.agencies)
        ? detail.agencies.map((a: any) => a?.name).filter(Boolean).join(", ")
        : Array.isArray(d?.agencies)
          ? d.agencies.map((a: any) => a?.name).filter(Boolean).join(", ")
          : "";
      const pubDate = String(detail?.publication_date ?? d?.publication_date ?? "").trim();
      const effectiveDate = String(detail?.effective_on ?? detail?.effective_date ?? "").trim();
      const updatedAt = String(detail?.updated_at ?? "").trim();
      const htmlUrl = String(detail?.html_url ?? d?.html_url ?? detail?.public_inspection_url ?? d?.public_inspection_url ?? "").trim();
      const pdfUrl = String(detail?.pdf_url ?? d?.pdf_url ?? "").trim();
      const abstract = String(detail?.abstract ?? d?.abstract ?? detail?.summary ?? "").trim();
      const excerpts = String(d?.excerpts ?? "").trim().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const docketIds = Array.isArray(detail?.docket_ids) ? detail.docket_ids.map(String).filter(Boolean) : [];
      const cfrRefs = Array.isArray(detail?.cfr_references) ? detail.cfr_references.map(String).filter(Boolean) : [];
      const uscRefs = Array.isArray(detail?.usc_references) ? detail.usc_references.map(String).filter(Boolean) : [];
      const rinList = Array.isArray(detail?.regulation_id_numbers) ? detail.regulation_id_numbers.map(String).filter(Boolean) : [];
      const topics = Array.isArray(detail?.topics) ? detail.topics.map((topic: any) => String(topic?.name ?? topic ?? "").trim()).filter(Boolean) : [];
      const confidence = matchConfidenceFromQuery(q, [title, abstract, excerpts, agencyNames, ...docketIds, ...topics, ...rinList]);
      const importance =
        type === "Rule" ? 85 : type === "Proposed Rule" ? 75 : type === "Notice" ? 55 : confidence === "High" ? 45 : 25;

      return {
        result_id: rid(),
        source_id: "federal_register",
        source_name: "Federal Register",
        agency: agencyNames || "Federal Register",
        category: "Rules / Notices / Proposed Rules",
        query_used: q,
        matched_entity: params.companyName || q,
        matched_entity_confidence: confidence,
        title,
        record_type: type,
        record_subtype: docNumber ? `Document ${docNumber}` : undefined,
        description: abstract || undefined,
        filing_or_record_date: pubDate || undefined,
        effective_date: effectiveDate || undefined,
        last_updated: updatedAt || undefined,
        docket_number: docketIds[0] || undefined,
        agency_identifier: rinList[0] || docNumber || undefined,
        document_url: pdfUrl || htmlUrl || undefined,
        detail_url: htmlUrl || undefined,
        raw_source_url: htmlUrl || undefined,
        source_quote: excerpts || undefined,
        raw_json: d,
        confidence,
        importance_score: importance,
        notes:
          [
            detail?.significant ? "Economically significant" : "",
            docketIds.length > 1 ? `Additional dockets: ${docketIds.slice(1, 4).join(", ")}` : "",
            rinList.length ? `RIN: ${rinList.join(", ")}` : "",
            cfrRefs.length ? `CFR: ${cfrRefs.slice(0, 4).join(", ")}` : "",
            uscRefs.length ? `USC: ${uscRefs.slice(0, 4).join(", ")}` : "",
            topics.length ? `Topics: ${topics.slice(0, 4).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        retrieved_at: retrievedAt,
        request_url: url.toString(),
      };
    });

    return { ok: true, requestUrl: url.toString(), raw, results };
  },
};

