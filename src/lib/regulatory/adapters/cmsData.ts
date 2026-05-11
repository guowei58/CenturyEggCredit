import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

type NpiOrganizationResult = {
  number?: string | null;
  enumeration_type?: string | null;
  basic?: {
    organization_name?: string | null;
    status?: string | null;
    enumeration_date?: string | null;
    last_updated?: string | null;
  };
  addresses?: Array<{
    address_1?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country_name?: string | null;
    address_purpose?: string | null;
    telephone_number?: string | null;
  }>;
  taxonomies?: Array<{
    code?: string | null;
    desc?: string | null;
    primary?: boolean | null;
    state?: string | null;
  }>;
};

type CmsDataApiRow = Record<string, string | number | boolean | null | undefined>;

const CMS_NPI_API_URL = "https://npiregistry.cms.hhs.gov/api/";
const CMS_HOSPITAL_ENROLLMENTS_DATASET_URL = "https://data.cms.gov/data-api/v1/dataset/92033181-e995-4b7d-930f-6630f91b3fef/data";
const CMS_HOSPITAL_ALL_OWNERS_DATASET_URL = "https://data.cms.gov/data-api/v1/dataset/6d82d503-a021-4ab3-910c-8aa259775ee8/data";
const CMS_HOSPITAL_CHOW_DATASET_URL = "https://data.cms.gov/data-api/v1/dataset/621923b2-9620-4f31-a042-c36428a995cb/data";
const CMS_SNF_ALL_OWNERS_DATASET_URL = "https://data.cms.gov/data-api/v1/dataset/128fb95f-427c-4df9-bce4-8db0ee8ec6ad/data";

const CMS_HOSPITAL_ENROLLMENTS_PAGE =
  "https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-enrollments";
const CMS_HOSPITAL_ALL_OWNERS_PAGE =
  "https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-all-owners";
const CMS_HOSPITAL_CHOW_PAGE =
  "https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-change-of-ownership";
const CMS_SNF_ALL_OWNERS_PAGE =
  "https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/skilled-nursing-facility-all-owners";

function rid() {
  return `cms_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function npiDetailUrl(npi: string): string {
  return `https://npiregistry.cms.hhs.gov/provider-view/${encodeURIComponent(npi)}`;
}

function joinParts(parts: Array<string | null | undefined>): string | undefined {
  const joined = parts.map((part) => text(part)).filter(Boolean).join(", ");
  return joined || undefined;
}

function yesNoFlag(value: string): boolean {
  return value.toUpperCase() === "Y";
}

function proprietaryLabel(value: string): string | undefined {
  const v = value.toUpperCase();
  if (v === "P") return "Proprietary";
  if (v === "N") return "Non-profit";
  return undefined;
}

async function fetchCmsDataApiRows(datasetUrl: string, query: string, size: number) {
  const url = new URL(datasetUrl);
  url.searchParams.set("keyword", query);
  url.searchParams.set("size", String(size));

  const res = await fetch(url.toString(), { cache: "no-store", headers: { accept: "application/json" } });
  const raw = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`CMS dataset request failed (HTTP ${res.status}).`);
  }

  return {
    requestUrl: url.toString(),
    rows: (Array.isArray(raw) ? raw : []) as CmsDataApiRow[],
    raw,
  };
}

function stateMatches(stateFilter: string | undefined, ...values: Array<string | undefined>): boolean {
  if (!stateFilter?.trim()) return true;
  const expected = stateFilter.trim().toUpperCase();
  return values.some((value) => text(value).toUpperCase() === expected);
}

function summarizeHospitalSubgroups(row: CmsDataApiRow): string | undefined {
  const subgroupMap: Array<[string, string]> = [
    ["SUBGROUP - GENERAL", "General"],
    ["SUBGROUP - ACUTE CARE", "Acute care"],
    ["SUBGROUP - ALCOHOL DRUG", "Alcohol / drug"],
    ["SUBGROUP - CHILDRENS", "Children's"],
    ["SUBGROUP - LONG-TERM", "Long-term"],
    ["SUBGROUP - PSYCHIATRIC", "Psychiatric"],
    ["SUBGROUP - REHABILITATION", "Rehabilitation"],
    ["SUBGROUP - SHORT-TERM", "Short-term"],
    ["SUBGROUP - SWING-BED APPROVED", "Swing-bed"],
    ["SUBGROUP - PSYCHIATRIC UNIT", "Psych unit"],
    ["SUBGROUP - REHABILITATION UNIT", "Rehab unit"],
    ["SUBGROUP - SPECIALTY HOSPITAL", "Specialty"],
  ];

  const active = subgroupMap.filter(([key]) => yesNoFlag(text(row[key]))).map(([, label]) => label);
  if (yesNoFlag(text(row["SUBGROUP - OTHER"]))) {
    active.push(text(row["SUBGROUP - OTHER TEXT"]) || "Other");
  }
  return active.length ? active.join("; ") : undefined;
}

function ownerName(row: CmsDataApiRow): string {
  const organization = text(row["ORGANIZATION NAME - OWNER"]);
  if (organization) return organization;
  return [text(row["FIRST NAME - OWNER"]), text(row["MIDDLE NAME - OWNER"]), text(row["LAST NAME - OWNER"])]
    .filter(Boolean)
    .join(" ");
}

function ownerAddress(row: CmsDataApiRow): string | undefined {
  return joinParts([
    text(row["ADDRESS LINE 1 - OWNER"]),
    text(row["ADDRESS LINE 2 - OWNER"]),
    text(row["CITY - OWNER"]),
    text(row["STATE - OWNER"]),
    text(row["ZIP CODE - OWNER"]),
  ]);
}

function ownerEntityFlags(row: CmsDataApiRow): string[] {
  const flags: Array<[string, string]> = [
    ["PRIVATE EQUITY COMPANY - OWNER", "Private equity"],
    ["REIT - OWNER", "REIT"],
    ["CHAIN HOME OFFICE - OWNER", "Chain home office"],
    ["HOLDING COMPANY - OWNER", "Holding company"],
    ["FINANCIAL INSTITUTION - OWNER", "Financial institution"],
    ["INVESTMENT FIRM - OWNER", "Investment firm"],
    ["FOR PROFIT - OWNER", "For profit"],
    ["NON PROFIT - OWNER", "Non-profit"],
  ];
  return flags.filter(([key]) => yesNoFlag(text(row[key]))).map(([, label]) => label);
}

function sortResults(results: RegulatorySearchResult[]): RegulatorySearchResult[] {
  return [...results].sort((a, b) => {
    if (b.importance_score !== a.importance_score) return b.importance_score - a.importance_score;
    const aDate = Date.parse(a.filing_or_record_date ?? a.last_updated ?? a.retrieved_at) || 0;
    const bDate = Date.parse(b.filing_or_record_date ?? b.last_updated ?? b.retrieved_at) || 0;
    return bDate - aDate;
  });
}

export const cmsDataAdapter: RegulatoryAgencyAdapter = {
  sourceId: "cms_data",
  validateConfig: () => ({
    ok: true,
    mode: "no_key",
    message: "Searching CMS NPI Registry plus hospital and ownership datasets.",
  }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const npiUrl = new URL(CMS_NPI_API_URL);
    npiUrl.searchParams.set("version", "2.1");
    npiUrl.searchParams.set("organization_name", q);
    npiUrl.searchParams.set("enumeration_type", "NPI-2");
    npiUrl.searchParams.set("limit", "10");
    if (params.state?.trim()) npiUrl.searchParams.set("state", params.state.trim().toUpperCase());

    const [npiPart, hospitalEnrollmentsPart, hospitalOwnersPart, hospitalChowPart, snfOwnersPart] = await Promise.allSettled([
      (async () => {
        const res = await fetch(npiUrl.toString(), { cache: "no-store", headers: { accept: "application/json" } });
        const raw = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`CMS NPI Registry request failed (HTTP ${res.status}).`);
        return { requestUrl: npiUrl.toString(), raw, rows: (((raw as { results?: unknown[] } | null)?.results ?? []) as NpiOrganizationResult[]) };
      })(),
      fetchCmsDataApiRows(CMS_HOSPITAL_ENROLLMENTS_DATASET_URL, q, 8),
      fetchCmsDataApiRows(CMS_HOSPITAL_ALL_OWNERS_DATASET_URL, q, 8),
      fetchCmsDataApiRows(CMS_HOSPITAL_CHOW_DATASET_URL, q, 8),
      fetchCmsDataApiRows(CMS_SNF_ALL_OWNERS_DATASET_URL, q, 8),
    ]);

    const warnings: string[] = [];
    const results: RegulatorySearchResult[] = [];
    const retrievedAt = new Date().toISOString();

    if (npiPart.status === "fulfilled") {
      for (const row of npiPart.value.rows) {
        const basic = row.basic ?? {};
        const legalName = text(basic.organization_name);
        const npi = text(row.number);
        const address =
          (row.addresses ?? []).find((a) => text(a.address_purpose).toUpperCase() === "LOCATION") ??
          row.addresses?.[0] ??
          null;
        const taxonomy = (row.taxonomies ?? []).find((t) => t.primary) ?? row.taxonomies?.[0] ?? null;
        const state = text(address?.state ?? taxonomy?.state);
        const city = text(address?.city);
        const facilityAddress = joinParts([
          text(address?.address_1),
          city,
          state,
          text(address?.postal_code),
          text(address?.country_name),
        ]);
        const taxonomyLabel = [text(taxonomy?.code), text(taxonomy?.desc)].filter(Boolean).join(" ");
        const confidence = matchConfidenceFromQuery(q, [legalName, city, state, taxonomyLabel]);
        const detailUrl = npi ? npiDetailUrl(npi) : "https://npiregistry.cms.hhs.gov/";
        results.push({
          result_id: rid(),
          source_id: "cms_data",
          source_name: "CMS Data",
          agency: "CMS",
          category: "Healthcare Provider / Facility / Medicare",
          query_used: q,
          matched_entity: legalName || q,
          matched_entity_confidence: confidence,
          title: legalName || "CMS provider / facility",
          record_type: "provider",
          record_subtype: text(row.enumeration_type) || undefined,
          description: taxonomyLabel || undefined,
          filing_or_record_date: text(basic.enumeration_date) || undefined,
          last_updated: text(basic.last_updated) || undefined,
          status: text(basic.status) || undefined,
          state: state || undefined,
          facility_name: legalName || undefined,
          facility_address: facilityAddress,
          agency_identifier: npi || undefined,
          detail_url: detailUrl,
          raw_source_url: detailUrl,
          raw_json: row,
          confidence,
          importance_score: confidence === "High" ? 80 : confidence === "Medium" ? 55 : 25,
          notes: address?.telephone_number ? `Phone ${text(address.telephone_number)}` : undefined,
          retrieved_at: retrievedAt,
          request_url: npiPart.value.requestUrl,
        });
      }
    } else {
      warnings.push("CMS NPI Registry results are temporarily unavailable.");
    }

    if (hospitalEnrollmentsPart.status === "fulfilled") {
      for (const row of hospitalEnrollmentsPart.value.rows) {
        const state = text(row["STATE"]);
        const city = text(row["CITY"]);
        if (!stateMatches(params.state, state, text(row["ENROLLMENT STATE"]))) continue;
        const orgName = text(row["ORGANIZATION NAME"]);
        const dba = text(row["DOING BUSINESS AS NAME"]);
        const confidence = matchConfidenceFromQuery(q, [orgName, dba, city, state, text(row["PROVIDER TYPE TEXT"])]);
        const facilityAddress = joinParts([
          text(row["ADDRESS LINE 1"]),
          text(row["ADDRESS LINE 2"]),
          city,
          state,
          text(row["ZIP CODE"]),
        ]);
        const subgroupSummary = summarizeHospitalSubgroups(row);
        results.push({
          result_id: rid(),
          source_id: "cms_data",
          source_name: "CMS Data",
          agency: "CMS",
          category: "Healthcare Provider / Facility / Medicare",
          query_used: q,
          matched_entity: orgName || dba || q,
          matched_entity_confidence: confidence,
          title: dba || orgName || "CMS hospital enrollment",
          record_type: "hospital enrollment",
          record_subtype: text(row["PROVIDER TYPE TEXT"]) || undefined,
          description:
            [text(row["ORGANIZATION TYPE STRUCTURE"]), proprietaryLabel(text(row["PROPRIETARY NONPROFIT"]))]
              .filter(Boolean)
              .join(" / ") || undefined,
          filing_or_record_date: text(row["INCORPORATION DATE"]) || undefined,
          state: state || undefined,
          facility_name: dba || orgName || undefined,
          facility_address: facilityAddress,
          agency_identifier: text(row["CCN"]) || text(row["NPI"]) || undefined,
          detail_url: CMS_HOSPITAL_ENROLLMENTS_PAGE,
          raw_source_url: hospitalEnrollmentsPart.value.requestUrl,
          raw_json: row,
          confidence,
          importance_score: confidence === "High" ? 78 : confidence === "Medium" ? 58 : 35,
          notes: [
            text(row["NPI"]) ? `NPI ${text(row["NPI"])}` : "",
            text(row["CCN"]) ? `CCN ${text(row["CCN"])}` : "",
            subgroupSummary ? `Subgroups: ${subgroupSummary}` : "",
          ]
            .filter(Boolean)
            .join(". ") || undefined,
          retrieved_at: retrievedAt,
          request_url: hospitalEnrollmentsPart.value.requestUrl,
        });
      }
    } else {
      warnings.push("CMS hospital enrollment results are temporarily unavailable.");
    }

    if (hospitalOwnersPart.status === "fulfilled") {
      for (const row of hospitalOwnersPart.value.rows) {
        const orgName = text(row["ORGANIZATION NAME"]);
        const owner = ownerName(row);
        const ownerState = text(row["STATE - OWNER"]);
        if (!stateMatches(params.state, ownerState)) continue;
        const confidence = matchConfidenceFromQuery(q, [orgName, owner, text(row["ROLE TEXT - OWNER"]), ownerState]);
        results.push({
          result_id: rid(),
          source_id: "cms_data",
          source_name: "CMS Data",
          agency: "CMS",
          category: "Healthcare Provider / Facility / Medicare",
          query_used: q,
          matched_entity: orgName || q,
          matched_entity_confidence: confidence,
          title: owner ? `${orgName} owner: ${owner}` : `${orgName} owner record`,
          record_type: "ownership",
          record_subtype: "hospital owner",
          description: text(row["ROLE TEXT - OWNER"]) || undefined,
          filing_or_record_date: text(row["ASSOCIATION DATE - OWNER"]) || undefined,
          state: ownerState || undefined,
          facility_name: orgName || undefined,
          facility_address: ownerAddress(row),
          agency_identifier: text(row["ASSOCIATE ID - OWNER"]) || text(row["ASSOCIATE ID"]) || undefined,
          detail_url: CMS_HOSPITAL_ALL_OWNERS_PAGE,
          raw_source_url: hospitalOwnersPart.value.requestUrl,
          raw_json: row,
          confidence,
          importance_score:
            confidence === "High"
              ? text(row["PERCENTAGE OWNERSHIP"])
                ? 82
                : 74
              : confidence === "Medium"
                ? 56
                : 30,
          notes: [
            text(row["PERCENTAGE OWNERSHIP"]) ? `Ownership ${text(row["PERCENTAGE OWNERSHIP"])}%` : "",
            ownerEntityFlags(row).length ? `Owner flags: ${ownerEntityFlags(row).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(". ") || undefined,
          retrieved_at: retrievedAt,
          request_url: hospitalOwnersPart.value.requestUrl,
        });
      }
    } else {
      warnings.push("CMS hospital ownership results are temporarily unavailable.");
    }

    if (hospitalChowPart.status === "fulfilled") {
      for (const row of hospitalChowPart.value.rows) {
        const buyer = text(row["ORGANIZATION NAME - BUYER"]);
        const seller = text(row["ORGANIZATION NAME - SELLER"]);
        const dbaBuyer = text(row["DOING BUSINESS AS NAME - BUYER"]);
        const dbaSeller = text(row["DOING BUSINESS AS NAME - SELLER"]);
        const buyerState = text(row["ENROLLMENT STATE - BUYER"]);
        const sellerState = text(row["ENROLLMENT STATE - SELLER"]);
        if (!stateMatches(params.state, buyerState, sellerState)) continue;
        const confidence = matchConfidenceFromQuery(q, [buyer, seller, dbaBuyer, dbaSeller, text(row["CHOW TYPE TEXT"])]);
        results.push({
          result_id: rid(),
          source_id: "cms_data",
          source_name: "CMS Data",
          agency: "CMS",
          category: "Healthcare Provider / Facility / Medicare",
          query_used: q,
          matched_entity: buyer || seller || q,
          matched_entity_confidence: confidence,
          title: buyer && seller ? `${buyer} acquired ${seller}` : buyer || seller || "CMS hospital ownership change",
          record_type: "change of ownership",
          record_subtype: "hospital CHOW",
          description: text(row["CHOW TYPE TEXT"]) || undefined,
          filing_or_record_date: text(row["EFFECTIVE DATE"]) || undefined,
          state: buyerState || sellerState || undefined,
          facility_name: dbaBuyer || buyer || undefined,
          agency_identifier: text(row["CCN - BUYER"]) || text(row["CCN - SELLER"]) || undefined,
          detail_url: CMS_HOSPITAL_CHOW_PAGE,
          raw_source_url: hospitalChowPart.value.requestUrl,
          raw_json: row,
          confidence,
          importance_score: confidence === "High" ? 84 : confidence === "Medium" ? 62 : 34,
          notes: [
            seller ? `Seller ${seller}` : "",
            dbaSeller ? `Seller DBA ${dbaSeller}` : "",
            text(row["CCN - BUYER"]) ? `Buyer CCN ${text(row["CCN - BUYER"])}` : "",
            text(row["CCN - SELLER"]) ? `Seller CCN ${text(row["CCN - SELLER"])}` : "",
          ]
            .filter(Boolean)
            .join(". ") || undefined,
          retrieved_at: retrievedAt,
          request_url: hospitalChowPart.value.requestUrl,
        });
      }
    } else {
      warnings.push("CMS hospital ownership-change results are temporarily unavailable.");
    }

    if (snfOwnersPart.status === "fulfilled") {
      for (const row of snfOwnersPart.value.rows) {
        const orgName = text(row["ORGANIZATION NAME"]);
        const owner = ownerName(row);
        const ownerState = text(row["STATE - OWNER"]);
        if (!stateMatches(params.state, ownerState)) continue;
        const confidence = matchConfidenceFromQuery(q, [orgName, owner, text(row["ROLE TEXT - OWNER"]), ownerState]);
        results.push({
          result_id: rid(),
          source_id: "cms_data",
          source_name: "CMS Data",
          agency: "CMS",
          category: "Healthcare Provider / Facility / Medicare",
          query_used: q,
          matched_entity: orgName || q,
          matched_entity_confidence: confidence,
          title: owner ? `${orgName} SNF owner: ${owner}` : `${orgName} SNF owner record`,
          record_type: "ownership",
          record_subtype: "skilled nursing facility owner",
          description: text(row["ROLE TEXT - OWNER"]) || undefined,
          filing_or_record_date: text(row["ASSOCIATION DATE - OWNER"]) || undefined,
          state: ownerState || undefined,
          facility_name: orgName || undefined,
          facility_address: ownerAddress(row),
          agency_identifier: text(row["ASSOCIATE ID - OWNER"]) || text(row["ASSOCIATE ID"]) || undefined,
          detail_url: CMS_SNF_ALL_OWNERS_PAGE,
          raw_source_url: snfOwnersPart.value.requestUrl,
          raw_json: row,
          confidence,
          importance_score:
            confidence === "High"
              ? text(row["PERCENTAGE OWNERSHIP"])
                ? 80
                : 72
              : confidence === "Medium"
                ? 54
                : 28,
          notes: [
            text(row["PERCENTAGE OWNERSHIP"]) ? `Ownership ${text(row["PERCENTAGE OWNERSHIP"])}%` : "",
            ownerEntityFlags(row).length ? `Owner flags: ${ownerEntityFlags(row).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(". ") || undefined,
          retrieved_at: retrievedAt,
          request_url: snfOwnersPart.value.requestUrl,
        });
      }
    } else {
      warnings.push("CMS skilled nursing facility ownership results are temporarily unavailable.");
    }

    const topResults = sortResults(results).slice(0, 25);
    if (topResults.length === 0 && warnings.length === 0) {
      warnings.push("No CMS provider, hospital, or ownership records matched this query.");
    }

    return {
      ok: true,
      requestUrl: npiUrl.toString(),
      raw: {
        npi: npiPart.status === "fulfilled" ? npiPart.value.raw : null,
        hospitalEnrollments: hospitalEnrollmentsPart.status === "fulfilled" ? hospitalEnrollmentsPart.value.raw : null,
        hospitalOwners: hospitalOwnersPart.status === "fulfilled" ? hospitalOwnersPart.value.raw : null,
        hospitalChow: hospitalChowPart.status === "fulfilled" ? hospitalChowPart.value.raw : null,
        snfOwners: snfOwnersPart.status === "fulfilled" ? snfOwnersPart.value.raw : null,
      },
      results: topResults,
      warnings: warnings.length ? warnings : undefined,
    };
  },
};
