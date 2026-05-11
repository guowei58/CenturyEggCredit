import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import {
  buildFfiecBulkDownloadUrl,
  buildFfiecUbprReportUrl,
  FFIEC_CDR_BULK_URL,
  getFfiecBulkCatalog,
  searchFfiecInstitutions,
} from "@/lib/regulatory/ffiecCdr";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

function rid() {
  return `ffiec_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function topCycleIds(options: { value: string }[], count = 5): string[] {
  return options.slice(0, count).map((option) => option.value);
}

function makeInstitutionResult(
  q: string,
  institution: Awaited<ReturnType<typeof searchFfiecInstitutions>>[number],
  cycleIds: string[],
  requestUrl: string,
): RegulatorySearchResult {
  const confidence = matchConfidenceFromQuery(q, [
    institution.name,
    institution.city,
    institution.state,
    institution.address,
    institution.cert,
  ]);

  return {
    result_id: rid(),
    source_id: "ffiec_cdr",
    source_name: "FFIEC CDR",
    agency: "FFIEC",
    category: "Bank Call Reports / UBPR / Reporter Panels",
    query_used: q,
    matched_entity: institution.name,
    matched_entity_confidence: confidence,
    title: `${institution.name} FFIEC public report`,
    record_type: "institution report",
    record_subtype: "UBPR / call report view",
    description: [institution.city, institution.state].filter(Boolean).join(", ") || undefined,
    status: institution.active === undefined ? undefined : institution.active ? "Active" : "Inactive",
    state: institution.state,
    facility_name: institution.name,
    facility_address: [institution.address, institution.city, institution.state].filter(Boolean).join(", ") || undefined,
    agency_identifier: institution.rssd || institution.cert,
    detail_url: institution.rssd ? buildFfiecUbprReportUrl(institution.rssd, cycleIds) : FFIEC_CDR_BULK_URL,
    raw_source_url: institution.rssd ? buildFfiecUbprReportUrl(institution.rssd, cycleIds) : FFIEC_CDR_BULK_URL,
    raw_json: institution.raw,
    confidence,
    importance_score: institution.active ? 85 : 60,
    notes: [
      institution.rssd ? `RSSD ${institution.rssd}` : "",
      institution.cert ? `FDIC cert ${institution.cert}` : "",
      "Public FFIEC report page keyed off the matched institution identifier.",
    ]
      .filter(Boolean)
      .join(". "),
    retrieved_at: new Date().toISOString(),
    request_url: requestUrl,
  };
}

function makeBulkResult(args: {
  q: string;
  title: string;
  subtype: string;
  periodLabel: string;
  productId: "ReportingSeriesSinglePeriod" | "ReportingSeriesSubsetSchedulesFourPeriods";
  periodValue: string;
  format: "tsv" | "xbrl";
  matchedEntity?: string;
  matchedConfidence: "High" | "Medium" | "Low";
}): RegulatorySearchResult {
  return {
    result_id: rid(),
    source_id: "ffiec_cdr",
    source_name: "FFIEC CDR",
    agency: "FFIEC",
    category: "Bank Call Reports / UBPR / Reporter Panels",
    query_used: args.q,
    matched_entity: args.matchedEntity || args.q,
    matched_entity_confidence: args.matchedConfidence,
    title: args.title,
    record_type: "bulk dataset",
    record_subtype: args.subtype,
    description: "Official FFIEC CDR bulk ZIP download for all commercial banks.",
    filing_or_record_date: args.periodLabel,
    detail_url: FFIEC_CDR_BULK_URL,
    download_url: buildFfiecBulkDownloadUrl({
      productId: args.productId,
      periodValue: args.periodValue,
      format: args.format,
    }),
    raw_source_url: FFIEC_CDR_BULK_URL,
    raw_json: {
      productId: args.productId,
      periodValue: args.periodValue,
      format: args.format,
      periodLabel: args.periodLabel,
    },
    confidence: args.matchedConfidence,
    importance_score: 72,
    notes: "Downloaded through the app's FFIEC proxy so the legacy ASP.NET postback flow resolves to a direct file download.",
    retrieved_at: new Date().toISOString(),
    request_url: FFIEC_CDR_BULK_URL,
  };
}

export const ffiecCdrAdapter: RegulatoryAgencyAdapter = {
  sourceId: "ffiec_cdr",
  validateConfig: () => ({ ok: true, mode: "no_key", message: "Using public FFIEC CDR institution pages and bulk downloads." }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const warnings: string[] = [];
    const [institutionsResult, bulkCatalogResult] = await Promise.allSettled([
      searchFfiecInstitutions(q, params.state),
      getFfiecBulkCatalog(),
    ]);

    if (institutionsResult.status === "rejected" && bulkCatalogResult.status === "rejected") {
      return {
        ok: false,
        error: "FFIEC CDR lookup failed.",
        hint: "The FFIEC public site and the supporting institution lookup both failed during this request.",
        requestUrl: FFIEC_CDR_BULK_URL,
        raw: {
          institutionsError: String(institutionsResult.reason ?? "Unknown error"),
          bulkCatalogError: String(bulkCatalogResult.reason ?? "Unknown error"),
        },
      };
    }

    const institutions = institutionsResult.status === "fulfilled" ? institutionsResult.value : [];
    const bulkCatalog = bulkCatalogResult.status === "fulfilled" ? bulkCatalogResult.value : null;

    if (institutionsResult.status === "rejected") {
      warnings.push("Institution matching is temporarily unavailable, so only FFIEC bulk download rows are shown.");
    }
    if (bulkCatalogResult.status === "rejected") {
      warnings.push("FFIEC bulk ZIP options could not be refreshed, so only institution-specific FFIEC report links are shown.");
    }

    const requestUrl = FFIEC_CDR_BULK_URL;
    const results: RegulatorySearchResult[] = [];
    const singlePeriodCycleIds = bulkCatalog ? topCycleIds(bulkCatalog.singlePeriodOptions) : [];

    for (const institution of institutions.slice(0, 3)) {
      results.push(makeInstitutionResult(q, institution, singlePeriodCycleIds, requestUrl));
    }

    const topInstitution = institutions[0];
    const datasetConfidence = topInstitution
      ? matchConfidenceFromQuery(q, [topInstitution.name, topInstitution.city, topInstitution.state])
      : "Low";

    if (bulkCatalog) {
      const latestSinglePeriod = bulkCatalog.singlePeriodOptions[0];
      if (latestSinglePeriod) {
        results.push(
          makeBulkResult({
            q,
            title: `FFIEC call-report bulk ZIP (${latestSinglePeriod.label}, tab delimited)`,
            subtype: "single period / tab delimited",
            periodLabel: latestSinglePeriod.label,
            productId: "ReportingSeriesSinglePeriod",
            periodValue: latestSinglePeriod.value,
            format: "tsv",
            matchedEntity: topInstitution?.name,
            matchedConfidence: datasetConfidence,
          }),
        );
        results.push(
          makeBulkResult({
            q,
            title: `FFIEC call-report bulk ZIP (${latestSinglePeriod.label}, XBRL)`,
            subtype: "single period / XBRL",
            periodLabel: latestSinglePeriod.label,
            productId: "ReportingSeriesSinglePeriod",
            periodValue: latestSinglePeriod.value,
            format: "xbrl",
            matchedEntity: topInstitution?.name,
            matchedConfidence: datasetConfidence,
          }),
        );
      }

      const latestFourPeriods = bulkCatalog.fourPeriodOptions[0];
      if (latestFourPeriods) {
        results.push(
          makeBulkResult({
            q,
            title: `FFIEC four-period call-report subset ZIP (${latestFourPeriods.label}, tab delimited)`,
            subtype: "four periods / subset schedules",
            periodLabel: latestFourPeriods.label,
            productId: "ReportingSeriesSubsetSchedulesFourPeriods",
            periodValue: latestFourPeriods.value,
            format: "tsv",
            matchedEntity: topInstitution?.name,
            matchedConfidence: datasetConfidence,
          }),
        );
      }
    }

    if (institutions.length === 0) {
      warnings.push("No FFIEC-reporting institution match was found for this query, so only generic call-report bulk downloads are shown.");
    }

    return {
      ok: true,
      requestUrl,
      raw: {
        institutions,
        bulkCatalog,
      },
      results,
      warnings: warnings.length ? warnings : undefined,
    };
  },
};
