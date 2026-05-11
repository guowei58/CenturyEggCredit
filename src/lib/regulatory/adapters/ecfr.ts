import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

function rid() {
  return `ecfr_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** Best-effort CFR section URL from hierarchy (eCFR URL patterns vary by title). */
function ecfrSectionUrl(h: Record<string, string | null | undefined>): string {
  const title = String(h?.title ?? "").trim();
  const part = String(h?.part ?? "").trim().replace(/^Part\s+/i, "");
  const sec = String(h?.section ?? "").trim().replace(/^§\s*/u, "");
  if (title && part && sec) {
    return `https://www.ecfr.gov/current/title-${encodeURIComponent(title)}/part-${encodeURIComponent(part)}/section-${encodeURIComponent(sec)}`;
  }
  return "https://www.ecfr.gov/";
}

export const ecfrAdapter: RegulatoryAgencyAdapter = {
  sourceId: "ecfr",
  validateConfig: () => ({ ok: true, mode: "no_key" }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const pageSize = Math.min(Math.max((params.filters?.pageSize as number) ?? 25, 1), 100);
    const perPage = Math.min(pageSize, 25);
    const pageCount = Math.min(Math.max(Math.ceil(pageSize / perPage), 1), 4);
    const pageUrls = Array.from({ length: pageCount }, (_, index) => {
      const url = new URL("https://www.ecfr.gov/api/search/v1/results");
      url.searchParams.set("query", q);
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(index + 1));
      return url;
    });

    const responses = await Promise.all(
      pageUrls.map(async (url) => {
        const res = await fetch(url.toString(), { cache: "no-store", headers: { accept: "application/json" } });
        const raw = await res.json().catch(() => null);
        return { res, raw, url: url.toString() };
      })
    );
    const failed = responses.find((item) => !item.res.ok);

    if (failed) {
      return {
        ok: false,
        error: `eCFR search failed (HTTP ${failed.res.status}).`,
        hint: "Use keyword search at ecfr.gov if the API response changes.",
        requestUrl: failed.url,
        raw: failed.raw,
      };
    }

    const rows = responses.flatMap((item) => {
      const payload = item.raw as {
        results?: Array<{
          hierarchy?: Record<string, string | null>;
          hierarchy_headings?: Record<string, string | null>;
          headings?: Record<string, string | null>;
          full_text_excerpt?: string;
          structure_index?: number;
          starts_on?: string;
          ends_on?: string | null;
          reserved?: boolean;
          removed?: boolean;
          change_types?: string[];
          type?: string;
        }>;
      };
      return payload?.results ?? [];
    });
    const retrievedAt = new Date().toISOString();

    const results: RegulatorySearchResult[] = rows.map((r, i) => {
      const hh = r?.hierarchy_headings ?? {};
      const sectionHeading = stripHtml(String(hh?.section ?? "").trim());
      const partHeading = stripHtml(String(hh?.part ?? "").trim());
      const titleHeading = stripHtml(String(hh?.title ?? "").trim());
      const hier = r?.hierarchy ?? {};
      const citation = [hier?.title ? `Title ${String(hier.title).trim()}` : "", hier?.part ? `Part ${String(hier.part).trim()}` : "", hier?.section ? `Section ${String(hier.section).trim()}` : ""]
        .filter(Boolean)
        .join(" / ");
      const title = [citation, titleHeading, partHeading, sectionHeading].filter(Boolean).join(" · ") || `CFR hit ${i + 1}`;
      const excerpt = stripHtml(String(r?.full_text_excerpt ?? "").trim());
      const detail = ecfrSectionUrl(hier as Record<string, string | null | undefined>);
      const type = String(r?.type ?? "Section").trim() || "Section";
      const startsOn = String(r?.starts_on ?? "").trim();
      const endsOn = String(r?.ends_on ?? "").trim();
      const changeTypes = Array.isArray(r?.change_types) ? r.change_types.map(String).filter(Boolean) : [];
      const confidence = matchConfidenceFromQuery(q, [title, excerpt, titleHeading, partHeading, sectionHeading]);

      return {
        result_id: rid(),
        source_id: "ecfr",
        source_name: "eCFR",
        agency: "GPO / NARA",
        category: "Current Federal Regulations",
        query_used: q,
        matched_entity: citation || q,
        matched_entity_confidence: confidence,
        title,
        record_type: type,
        record_subtype: citation || undefined,
        description: excerpt || undefined,
        filing_or_record_date: startsOn || undefined,
        effective_date: startsOn || undefined,
        last_updated: endsOn || undefined,
        status: r?.removed ? "Removed" : r?.reserved ? "Reserved" : changeTypes.join(", ") || undefined,
        jurisdiction: titleHeading || undefined,
        document_url: detail,
        detail_url: detail,
        raw_source_url: detail,
        source_quote: excerpt || undefined,
        raw_json: r,
        confidence,
        importance_score: confidence === "High" ? 70 : confidence === "Medium" ? 45 : 20,
        retrieved_at: retrievedAt,
        notes:
          typeof r?.structure_index === "number"
            ? [`structure_index=${r.structure_index}`, changeTypes.length ? `changes=${changeTypes.join(",")}` : "", "Verify citation in eCFR if the deep link 404s."]
                .filter(Boolean)
                .join(" — ")
            : "Verify citation in eCFR.",
        request_url: pageUrls[0].toString(),
      };
    });

    return { ok: true, requestUrl: pageUrls[0].toString(), raw: responses.map((item) => item.raw), results: results.slice(0, pageSize) };
  },
};
