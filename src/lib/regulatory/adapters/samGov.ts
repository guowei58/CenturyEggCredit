import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

type SamEntity = {
  entityRegistration?: {
    ueiSAM?: string | null;
    legalBusinessName?: string | null;
    dbaName?: string | null;
    registrationStatus?: string | null;
    registrationDate?: string | null;
    registrationExpirationDate?: string | null;
    exclusionStatusFlag?: string | null;
    samRegistered?: string | null;
    purposeOfRegistrationDesc?: string | null;
  };
  coreData?: {
    entityInformation?: {
      entityURL?: string | null;
      entityStartDate?: string | null;
      submissionDate?: string | null;
    };
    physicalAddress?: {
      addressLine1?: string | null;
      city?: string | null;
      stateOrProvinceCode?: string | null;
      zipCode?: string | null;
      countryCode?: string | null;
    };
    generalInformation?: {
      entityTypeDesc?: string | null;
      organizationStructureDesc?: string | null;
      stateOfIncorporationDesc?: string | null;
      countryOfIncorporationDesc?: string | null;
      cageCode?: string | null;
    };
    businessTypes?: {
      businessTypeList?: Array<{ businessTypeDesc?: string | null }>;
    };
  };
  assertions?: {
    goodsAndServices?: {
      primaryNaics?: string | null;
      naicsList?: Array<{ naicsCode?: string | null; naicsDescription?: string | null }>;
      pscList?: Array<{ pscCode?: string | null; pscDescription?: string | null }>;
    };
  };
  integrityInformation?: {
    entitySummary?: {
      exclusionURL?: string | null;
      proceedingsURL?: string | null;
    };
    corporateRelationships?: {
      immediateOwnerName?: string | null;
      highestLevelOwnerName?: string | null;
    };
  };
};

function rid() {
  return `sam_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function apiKey(): string | undefined {
  return process.env.SAM_GOV_API_KEY?.trim();
}

function samSearchUrl(query: string): string {
  return `https://sam.gov/search/?index=entity-information&keywordSearch=${encodeURIComponent(query)}`;
}

export const samGovAdapter: RegulatoryAgencyAdapter = {
  sourceId: "sam_gov",
  validateConfig: () => {
    const key = apiKey();
    if (!key) {
      return {
        ok: false,
        mode: "missing_key",
        message: "Set SAM_GOV_API_KEY in .env.local.",
        envKeyName: "SAM_GOV_API_KEY",
      };
    }
    return { ok: true, mode: "api_key", message: "Searching SAM.gov Entity Management API by legal business name." };
  },
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const key = apiKey();
    if (!key) {
      return { ok: false, error: "SAM.gov API key missing.", hint: "Set SAM_GOV_API_KEY in .env.local and restart." };
    }
    const samKey = key;

    async function fetchSearch(searchField: "legalBusinessName" | "dbaName", value: string) {
      const url = new URL("https://api.sam.gov/entity-information/v4/entities");
      url.searchParams.set("api_key", samKey);
      url.searchParams.set(searchField, value);
      url.searchParams.set("page", "1");
      url.searchParams.set("size", "10");
      url.searchParams.set("includeSections", "entityRegistration,coreData,assertions,integrityInformation");
      url.searchParams.set("proceedingsData", "Yes");
      if (params.state?.trim()) {
        url.searchParams.set("physicalAddressProvinceOrStateCode", params.state.trim().toUpperCase());
      }
      const res = await fetch(url.toString(), {
        cache: "no-store",
        headers: { "X-Api-Key": samKey, Accept: "application/json" },
      });
      const raw = await res.json().catch(() => null);
      return { res, raw, url: url.toString() };
    }

    const primary = await fetchSearch("legalBusinessName", q);
    let fallback = null as Awaited<ReturnType<typeof fetchSearch>> | null;
    if ((!primary.res.ok || !(((primary.raw as { entityData?: unknown[] } | null)?.entityData ?? []) as unknown[]).length) && q.length >= 4) {
      fallback = await fetchSearch("dbaName", q);
    }
    const active = fallback?.res.ok && ((((fallback.raw as { entityData?: unknown[] } | null)?.entityData ?? []) as unknown[]).length > 0) ? fallback : primary;
    if (!active.res.ok) {
      return {
        ok: false,
        error: `SAM.gov request failed (HTTP ${active.res.status}).`,
        requestUrl: active.url.replace(key, "(redacted)"),
        raw: active.raw,
      };
    }

    const rows = (((active.raw as { entityData?: unknown[] } | null)?.entityData ?? []) as SamEntity[]);
    const retrievedAt = new Date().toISOString();
    const results: RegulatorySearchResult[] = rows.map((r) => {
      const reg = r.entityRegistration ?? {};
      const core = r.coreData ?? {};
      const physical = core.physicalAddress ?? {};
      const info = core.entityInformation ?? {};
      const general = core.generalInformation ?? {};
      const goods = r.assertions?.goodsAndServices ?? {};
      const businessTypes = (core.businessTypes?.businessTypeList ?? [])
        .map((b) => String(b.businessTypeDesc ?? "").trim())
        .filter(Boolean);

      const uei = String(reg.ueiSAM ?? "").trim();
      const legalName = String(reg.legalBusinessName ?? "").trim();
      const dbaName = String(reg.dbaName ?? "").trim();
      const state = String(physical.stateOrProvinceCode ?? "").trim();
      const city = String(physical.city ?? "").trim();
      const address = String(physical.addressLine1 ?? "").trim();
      const zip = String(physical.zipCode ?? "").trim();
      const country = String(physical.countryCode ?? "").trim();
      const registrationStatus = String(reg.registrationStatus ?? "").trim();
      const registrationDate = String(reg.registrationDate ?? "").trim();
      const expirationDate = String(reg.registrationExpirationDate ?? "").trim();
      const exclusionFlag = String(reg.exclusionStatusFlag ?? "").trim();
      const entityUrl = String(info.entityURL ?? "").trim();
      const purpose = String(reg.purposeOfRegistrationDesc ?? "").trim();
      const entityType = String(general.entityTypeDesc ?? "").trim();
      const orgStructure = String(general.organizationStructureDesc ?? "").trim();
      const cageCode = String(general.cageCode ?? "").trim();
      const incorporation = String(general.stateOfIncorporationDesc ?? general.countryOfIncorporationDesc ?? "").trim();
      const primaryNaics = String(goods.primaryNaics ?? "").trim();
      const naics = (goods.naicsList ?? [])
        .map((n) => [String(n.naicsCode ?? "").trim(), String(n.naicsDescription ?? "").trim()].filter(Boolean).join(" "))
        .filter(Boolean)[0];
      const psc = (goods.pscList ?? [])
        .map((p) => [String(p.pscCode ?? "").trim(), String(p.pscDescription ?? "").trim()].filter(Boolean).join(" "))
        .filter(Boolean)[0];
      const integrity = r.integrityInformation ?? {};
      const exclusionUrl = String(integrity.entitySummary?.exclusionURL ?? "").trim();
      const proceedingsUrl = String(integrity.entitySummary?.proceedingsURL ?? "").trim();
      const immediateOwner = String(integrity.corporateRelationships?.immediateOwnerName ?? "").trim();
      const highestOwner = String(integrity.corporateRelationships?.highestLevelOwnerName ?? "").trim();
      const confidence = matchConfidenceFromQuery(q, [legalName, dbaName, entityType, orgStructure, city, state, primaryNaics, naics, psc, cageCode]);
      const detailUrl = samSearchUrl(uei || legalName || q);

      return {
        result_id: rid(),
        source_id: "sam_gov",
        source_name: "SAM.gov",
        agency: "GSA",
        category: "Federal Contracting / Exclusions / Opportunities",
        query_used: q,
        matched_entity: legalName || q,
        matched_entity_confidence: confidence,
        title: legalName || "SAM.gov entity",
        record_type: exclusionUrl ? "entity_exclusion_candidate" : "entity",
        record_subtype: entityType || orgStructure || purpose || undefined,
        description: [
          dbaName ? `DBA: ${dbaName}` : "",
          purpose ? `Purpose: ${purpose}` : "",
          businessTypes.length ? `Types: ${businessTypes.slice(0, 3).join(", ")}` : "",
          incorporation ? `Incorporation: ${incorporation}` : "",
          orgStructure ? `Structure: ${orgStructure}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
        filing_or_record_date: registrationDate || undefined,
        effective_date: info.entityStartDate || undefined,
        last_updated: expirationDate || info.submissionDate || undefined,
        status: registrationStatus || undefined,
        jurisdiction: country || incorporation || undefined,
        state: state || undefined,
        facility_name: legalName || undefined,
        facility_address: [address, city, state, zip, country].filter(Boolean).join(", ") || undefined,
        agency_identifier: uei || cageCode || undefined,
        document_url: exclusionUrl || proceedingsUrl || entityUrl || detailUrl,
        detail_url: detailUrl,
        raw_source_url: exclusionUrl || proceedingsUrl || entityUrl || detailUrl,
        raw_json: r,
        confidence,
        importance_score: exclusionFlag === "Y" ? 95 : registrationStatus === "Active" ? 70 : 30,
        notes: [
          cageCode ? `CAGE ${cageCode}` : "",
          primaryNaics ? `Primary NAICS ${primaryNaics}` : "",
          naics ? `NAICS ${naics}` : "",
          psc ? `PSC ${psc}` : "",
          exclusionFlag ? `Excluded: ${exclusionFlag}` : "",
          immediateOwner ? `Immediate owner: ${immediateOwner}` : "",
          highestOwner ? `Highest owner: ${highestOwner}` : "",
          exclusionUrl ? "Exclusion details available" : "",
          proceedingsUrl ? "Integrity/proceedings details available" : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
        retrieved_at: retrievedAt,
        request_url: active.url.replace(key, "(redacted)"),
      };
    });

    const warnings: string[] = [];
    if (fallback && active === fallback) {
      warnings.push("Primary legal-name search returned no rows, so this tab retried against SAM.gov DBA names.");
    }

    return {
      ok: true,
      requestUrl: active.url.replace(key, "(redacted)"),
      raw: { primary: primary.raw, fallback: fallback?.raw ?? null },
      results,
      warnings: warnings.length ? warnings : undefined,
    };
  },
};
