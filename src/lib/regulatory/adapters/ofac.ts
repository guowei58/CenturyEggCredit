import { XMLParser } from "fast-xml-parser";
import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

type OfacAka = {
  uid?: string | null;
  type?: string | null;
  category?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

type OfacAddress = {
  uid?: string | null;
  address1?: string | null;
  address2?: string | null;
  address3?: string | null;
  city?: string | null;
  stateOrProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

type OfacId = {
  uid?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  idCountry?: string | null;
  issueDate?: string | null;
  expirationDate?: string | null;
};

type OfacDateOfBirthItem = {
  uid?: string | null;
  dateOfBirth?: string | null;
  mainEntry?: string | boolean | null;
};

type OfacPlaceOfBirthItem = {
  uid?: string | null;
  placeOfBirth?: string | null;
  mainEntry?: string | boolean | null;
};

type OfacCountryItem = {
  uid?: string | null;
  country?: string | null;
  mainEntry?: string | boolean | null;
};

type OfacVesselInfo = {
  callSign?: string | null;
  vesselType?: string | null;
  vesselFlag?: string | null;
  vesselOwner?: string | null;
  tonnage?: string | null;
  grossRegisteredTonnage?: string | null;
};

type OfacEntry = {
  uid?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  sdnType?: string | null;
  remarks?: string | null;
  programList?: { program?: string | string[] | null } | null;
  akaList?: { aka?: OfacAka | OfacAka[] | null } | null;
  addressList?: { address?: OfacAddress | OfacAddress[] | null } | null;
  idList?: { id?: OfacId | OfacId[] | null } | null;
  dateOfBirthList?: { dateOfBirthItem?: OfacDateOfBirthItem | OfacDateOfBirthItem[] | null } | null;
  placeOfBirthList?: { placeOfBirthItem?: OfacPlaceOfBirthItem | OfacPlaceOfBirthItem[] | null } | null;
  nationalityList?: { nationality?: OfacCountryItem | OfacCountryItem[] | null } | null;
  citizenshipList?: { citizenship?: OfacCountryItem | OfacCountryItem[] | null } | null;
  vesselInfo?: OfacVesselInfo | null;
};

const OFAC_XML_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const OFAC_SANCTIONS_SERVICE_URL = "https://ofac.treasury.gov/sanctions-list-service";
const OFAC_SEARCH_DETAIL_BASE_URL = "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=";

function rid() {
  return `ofac_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function arrayify<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function asTextList(value: string | string[] | null | undefined): string[] {
  return arrayify(value).map((v) => String(v ?? "").trim()).filter(Boolean);
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(" ");
}

function formatAkaName(aka: OfacAka): string {
  return joinParts([aka.firstName, aka.lastName]);
}

function formatPrimaryName(entry: OfacEntry): string {
  return joinParts([entry.firstName, entry.lastName]) || String(entry.lastName ?? "").trim();
}

function countryNames(items: OfacCountryItem | OfacCountryItem[] | null | undefined): string[] {
  return arrayify(items).map((item) => String(item?.country ?? "").trim()).filter(Boolean);
}

function summarizeIds(ids: OfacId[], count: number) {
  return ids
    .slice(0, count)
    .map((id) => {
      const type = String(id.idType ?? "").trim();
      const number = String(id.idNumber ?? "").trim();
      const country = String(id.idCountry ?? "").trim();
      return [type, number, country ? `(${country})` : ""].filter(Boolean).join(" ");
    })
    .filter(Boolean);
}

function ofacDetailUrl(uid: string | null | undefined): string {
  const trimmed = String(uid ?? "").trim();
  if (!trimmed) return OFAC_SANCTIONS_SERVICE_URL;
  return `${OFAC_SEARCH_DETAIL_BASE_URL}${encodeURIComponent(trimmed)}`;
}

export const ofacAdapter: RegulatoryAgencyAdapter = {
  sourceId: "ofac",
  validateConfig: () => ({ ok: true, mode: "no_key", message: "Downloading OFAC's live SDN XML export and matching richer sanctions profile data." }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const res = await fetch(OFAC_XML_URL, { cache: "no-store", headers: { accept: "application/xml,text/xml,*/*" } });
    const rawText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `OFAC SDN download failed (HTTP ${res.status}).`,
        requestUrl: OFAC_XML_URL,
        raw: rawText.slice(0, 1000),
      };
    }

    const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });
    const parsed = parser.parse(rawText) as { sdnList?: { sdnEntry?: OfacEntry | OfacEntry[] } };
    const entries = arrayify(parsed?.sdnList?.sdnEntry);
    const retrievedAt = new Date().toISOString();

    const matched = entries
      .map((entry) => {
        const name = formatPrimaryName(entry);
        const akas = arrayify(entry.akaList?.aka)
          .map((aka) => formatAkaName(aka ?? {}))
          .filter(Boolean);
        const addresses = arrayify(entry.addressList?.address);
        const primaryAddress = addresses[0];
        const ids = arrayify(entry.idList?.id);
        const nationality = countryNames(entry.nationalityList?.nationality);
        const citizenship = countryNames(entry.citizenshipList?.citizenship);
        const dobs = arrayify(entry.dateOfBirthList?.dateOfBirthItem)
          .map((item) => String(item?.dateOfBirth ?? "").trim())
          .filter(Boolean);
        const pobs = arrayify(entry.placeOfBirthList?.placeOfBirthItem)
          .map((item) => String(item?.placeOfBirth ?? "").trim())
          .filter(Boolean);
        const confidence = matchConfidenceFromQuery(q, [
          name,
          ...akas,
          ...summarizeIds(ids, 6),
          ...nationality,
          ...citizenship,
          ...pobs,
        ]);
        return { entry, name, akas, primaryAddress, confidence, ids, nationality, citizenship, dobs, pobs };
      })
      .filter((row) => row.confidence !== "Low")
      .sort((a, b) => {
        const rank = { High: 2, Medium: 1, Low: 0 } as const;
        return rank[b.confidence] - rank[a.confidence];
      })
      .slice(0, 25);

    const results: RegulatorySearchResult[] = matched.map(
      ({ entry, name, akas, primaryAddress, confidence, ids, nationality, citizenship, dobs, pobs }) => {
      const programs = asTextList(entry.programList?.program);
      const state = String(primaryAddress?.stateOrProvince ?? "").trim();
      const city = String(primaryAddress?.city ?? "").trim();
      const facilityAddress = [
        String(primaryAddress?.address1 ?? "").trim(),
        String(primaryAddress?.address2 ?? "").trim(),
        String(primaryAddress?.address3 ?? "").trim(),
        city,
        state,
        String(primaryAddress?.postalCode ?? "").trim(),
        String(primaryAddress?.country ?? "").trim(),
      ]
        .filter(Boolean)
        .join(", ");
      const title = String(entry.title ?? "").trim();
      const remarks = String(entry.remarks ?? "").trim();
      const vessel = entry.vesselInfo ?? null;
      const vesselSummary = vessel
        ? [
            String(vessel.vesselType ?? "").trim(),
            String(vessel.vesselFlag ?? "").trim(),
            String(vessel.callSign ?? "").trim() ? `Call sign ${String(vessel.callSign ?? "").trim()}` : "",
            String(vessel.vesselOwner ?? "").trim() ? `Owner ${String(vessel.vesselOwner ?? "").trim()}` : "",
          ]
            .filter(Boolean)
            .join(" / ")
        : "";
      const idSummary = summarizeIds(ids, 4);
      const sanctionsExtra = ids
        .filter((id) => /Secondary sanctions risk|Additional Sanctions Information/i.test(String(id.idType ?? "")))
        .map((id) => [String(id.idType ?? "").trim(), String(id.idNumber ?? "").trim()].filter(Boolean).join(" "))
        .filter(Boolean);

      const uid = String(entry.uid ?? "").trim();

      return {
        result_id: rid(),
        source_id: "ofac",
        source_name: "OFAC / Treasury Sanctions",
        agency: "Treasury (OFAC)",
        category: "Sanctions / Blocked Parties",
        query_used: q,
        matched_entity: name || q,
        matched_entity_confidence: confidence,
        title: name || "OFAC SDN match",
        record_type: String(entry.sdnType ?? "SDN").trim() || "SDN",
        record_subtype: title || (vessel?.vesselType ? String(vessel.vesselType).trim() : undefined),
        description:
          [
            programs.length ? `Programs: ${programs.join(", ")}` : "",
            vesselSummary,
            title,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        state: state || undefined,
        jurisdiction: String(primaryAddress?.country ?? "").trim() || nationality[0] || citizenship[0] || undefined,
        facility_address: facilityAddress || undefined,
        agency_identifier: uid || undefined,
        detail_url: ofacDetailUrl(uid),
        document_url: ofacDetailUrl(uid),
        raw_source_url: OFAC_XML_URL,
        raw_json: entry,
        confidence,
        importance_score: confidence === "High" ? 95 : 70,
        notes:
          [
            akas.length ? `Aliases: ${akas.slice(0, 6).join(", ")}` : "",
            idSummary.length ? `Identifiers: ${idSummary.join("; ")}` : "",
            nationality.length ? `Nationality: ${nationality.join(", ")}` : "",
            citizenship.length ? `Citizenship: ${citizenship.join(", ")}` : "",
            dobs.length ? `DOB: ${dobs.slice(0, 3).join(", ")}` : "",
            pobs.length ? `POB: ${pobs.slice(0, 3).join(", ")}` : "",
            sanctionsExtra.length ? sanctionsExtra.slice(0, 3).join("; ") : "",
            remarks ? `Remarks: ${remarks}` : "",
          ]
            .filter(Boolean)
            .join(". ") || undefined,
        retrieved_at: retrievedAt,
        request_url: OFAC_XML_URL,
      };
    });

    return { ok: true, requestUrl: OFAC_XML_URL, raw: parsed, results };
  },
};
