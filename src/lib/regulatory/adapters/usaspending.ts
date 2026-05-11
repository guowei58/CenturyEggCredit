import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";
import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";

function rid() {
  return `usasp_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

const COUNT_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award_count/";
const SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const FIELDS = [
  "Award ID",
  "Recipient Name",
  "Recipient UEI",
  "Start Date",
  "End Date",
  "Award Amount",
  "Total Outlays",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Funding Agency",
  "Funding Sub Agency",
  "NAICS",
  "PSC",
  "Place of Performance",
  "Description",
  "Award Type",
] as const;

const AWARD_GROUP_CODES: Record<string, string[]> = {
  contracts: ["A", "B", "C", "D"],
  grants: ["02", "03", "04", "05", "F001", "F002"],
  direct_payments: ["06", "10", "F006", "F007"],
  loans: ["07", "08", "F003", "F004"],
  other: ["09", "11", "-1", "F005", "F008", "F009", "F010"],
  idvs: ["IDV_A", "IDV_B", "IDV_B_A", "IDV_B_B", "IDV_B_C", "IDV_C", "IDV_D", "IDV_E"],
};

function buildFilters(params: RegulatorySearchParams, awardTypeCodes?: string[]) {
  const filters: Record<string, unknown> = {
    keywords: [params.query?.trim() ?? ""],
  };

  if (awardTypeCodes?.length) {
    filters.award_type_codes = awardTypeCodes;
  }
  if (params.startDate || params.endDate) {
    filters.time_period = [
      {
        start_date: params.startDate ?? "2007-10-01",
        end_date: params.endDate ?? "2100-01-01",
      },
    ];
  }

  return filters;
}

export const usaspendingAdapter: RegulatoryAgencyAdapter = {
  sourceId: "usaspending",
  validateConfig: () => ({ ok: true, mode: "no_key" }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const pageSize = Math.min(Math.max((params.filters?.pageSize as number) ?? 25, 1), 100);

    const countRes = await fetch(COUNT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filters: buildFilters(params) }),
      cache: "no-store",
    });
    const countRaw = await countRes.json().catch(() => null);
    if (!countRes.ok) {
      return { ok: false, error: `USAspending request failed (HTTP ${countRes.status}).`, requestUrl: COUNT_URL, raw: countRaw };
    }

    const counts = ((countRaw as any)?.results ?? {}) as Record<string, number | undefined>;
    const groups = Object.entries(counts)
      .filter(([group, count]) => (count ?? 0) > 0 && AWARD_GROUP_CODES[group])
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, 3);

    if (groups.length === 0) {
      return { ok: true, requestUrl: COUNT_URL, raw: countRaw, results: [] };
    }

    async function runSearch(fields: readonly string[]) {
      const searchBodies = groups.map(([group]) => ({
        fields: [...fields],
        page: 1,
        limit: Math.max(5, Math.ceil(pageSize / groups.length)),
        sort: "Award Amount",
        order: "desc",
        filters: buildFilters(params, AWARD_GROUP_CODES[group]),
      }));
      const responses = await Promise.all(
        searchBodies.map((body) =>
          fetch(SEARCH_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
          }).then(async (res) => ({ res, raw: await res.json().catch(() => null), body }))
        )
      );
      return { searchBodies, responses };
    }

    let { responses } = await runSearch(FIELDS);
    if (responses.some(({ res }) => !res.ok)) {
      const baseFields = ["Award ID", "Recipient Name", "Start Date", "End Date", "Award Amount", "Awarding Agency", "Funding Agency", "NAICS", "PSC", "Award Type"];
      ({ responses } = await runSearch(baseFields));
    }

    const failed = responses.find(({ res }) => !res.ok);
    if (failed) {
      return {
        ok: false,
        error: `USAspending request failed (HTTP ${failed.res.status}).`,
        requestUrl: SEARCH_URL,
        raw: failed.raw,
      };
    }

    const seen = new Set<string>();
    const rows: any[] = [];
    for (const { raw } of responses) {
      const partRows = ((raw as any)?.results ?? []) as any[];
      for (const row of partRows) {
        const key = String(row?.generated_internal_id ?? row?.internal_id ?? row?.["Award ID"] ?? "").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    }

    rows.sort((a, b) => {
      const aa = typeof a?.["Award Amount"] === "number" ? a["Award Amount"] : -1;
      const bb = typeof b?.["Award Amount"] === "number" ? b["Award Amount"] : -1;
      return bb - aa;
    });

    const retrievedAt = new Date().toISOString();
    const results: RegulatorySearchResult[] = rows.slice(0, pageSize).map((r) => {
      const awardId = String(r?.["Award ID"] ?? "").trim();
      const recipient = String(r?.["Recipient Name"] ?? "").trim();
      const amount = r?.["Award Amount"];
      const awarding = String(r?.["Awarding Agency"] ?? "").trim();
      const awardingSub = String(r?.["Awarding Sub Agency"] ?? "").trim();
      const funding = String(r?.["Funding Agency"] ?? "").trim();
      const fundingSub = String(r?.["Funding Sub Agency"] ?? "").trim();
      const start = String(r?.["Start Date"] ?? "").trim();
      const end = String(r?.["End Date"] ?? "").trim();
      const description = String(r?.Description ?? "").trim();
      const recipientUei = String(r?.["Recipient UEI"] ?? "").trim();
      const totalOutlays = r?.["Total Outlays"];
      const placeOfPerformance = String(r?.["Place of Performance"] ?? "").trim();
      const naicsCode = String(r?.["NAICS"]?.code ?? "").trim();
      const naicsDesc = String(r?.["NAICS"]?.description ?? "").trim();
      const pscCode = String(r?.["PSC"]?.code ?? "").trim();
      const pscDesc = String(r?.["PSC"]?.description ?? "").trim();
      const awardType = String(r?.["Award Type"] ?? "").trim();
      const generatedId = String(r?.generated_internal_id ?? "").trim();
      const detailUrl = generatedId
        ? `https://www.usaspending.gov/award/${encodeURIComponent(generatedId)}`
        : awardId
          ? `https://www.usaspending.gov/search/?hash=${encodeURIComponent(awardId)}`
          : "https://www.usaspending.gov/";
      const confidence = matchConfidenceFromQuery(q, [recipient, awarding, awardingSub, funding, fundingSub, description, placeOfPerformance, recipientUei]);

      return {
        result_id: rid(),
        source_id: "usaspending",
        source_name: "USAspending",
        agency: "Treasury",
        category: "Federal Awards / Contracts / Grants",
        query_used: q,
        matched_entity: recipient || q,
        matched_entity_confidence: confidence,
        title: recipient || "Award",
        record_type: "award",
        record_subtype: awardType || undefined,
        description:
          [
            awarding ? `Awarding: ${awarding}` : "",
            awardingSub ? `Sub-agency: ${awardingSub}` : "",
            funding ? `Funding: ${funding}` : "",
            fundingSub ? `Funding sub-agency: ${fundingSub}` : "",
            description,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        filing_or_record_date: start || undefined,
        effective_date: start || undefined,
        last_updated: end || undefined,
        status: undefined,
        jurisdiction: placeOfPerformance || undefined,
        agency_identifier: awardId || generatedId || undefined,
        document_url: detailUrl,
        detail_url: detailUrl,
        raw_source_url: detailUrl,
        raw_json: r,
        confidence,
        importance_score: typeof amount === "number" ? Math.max(0, Math.min(100, Math.log10(Math.abs(amount) + 1) * 10)) : 0,
        notes: [
          recipientUei ? `UEI ${recipientUei}` : "",
          naicsCode ? `NAICS ${naicsCode}${naicsDesc ? ` ${naicsDesc}` : ""}` : "",
          pscCode ? `PSC ${pscCode}${pscDesc ? ` ${pscDesc}` : ""}` : "",
          typeof amount === "number" ? `$${amount.toLocaleString()}` : "",
          typeof totalOutlays === "number" ? `Outlays $${totalOutlays.toLocaleString()}` : "",
          placeOfPerformance ? `Performance: ${placeOfPerformance}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
        retrieved_at: retrievedAt,
        request_url: SEARCH_URL,
      };
    });

    const warnings: string[] = [];
    if (params.state?.trim()) {
      warnings.push("USAspending state filtering is not wired yet in this tab; results are keyword-based across award groups.");
    }
    if (Object.keys(counts).length > groups.length) {
      warnings.push(`Searched the top ${groups.length} matching award group(s): ${groups.map(([g]) => g).join(", ")}.`);
    }

    return { ok: true, requestUrl: SEARCH_URL, raw: { countRaw, responses: responses.map((r) => r.raw) }, results, warnings: warnings.length ? warnings : undefined };
  },
};

