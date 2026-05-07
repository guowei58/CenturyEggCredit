import { mapExhibitJurisdictionToOpenCorporates } from "@/config/opencorporatesJurisdictionMap";
import { ENTITY_SOS_REGISTRY } from "@/lib/entitySourceRegistry";

/** Exhibit domicile → US postal code when it maps to an OpenCorporates `us_xx` jurisdiction. */
function exhibitJurisdictionToUsState(exhibitJurisdiction: string): string | null {
  const mapped = mapExhibitJurisdictionToOpenCorporates(exhibitJurisdiction);
  if (mapped.kind !== "mapped") return null;
  const oc = mapped.ocCode.toLowerCase();
  const m = /^us_([a-z]{2})$/.exec(oc);
  if (!m) return null;
  return m[1]!.toUpperCase();
}

function pickEntitySearchName(row: { matchedName?: unknown; exhibitLegalName?: unknown }): string {
  const m = String(row.matchedName ?? "").trim();
  if (m && m !== "—") return m;
  return String(row.exhibitLegalName ?? "").trim();
}

export type StateSosLinkKind = "prefilled" | "portal";

export function buildStateSosSearchUrl(row: {
  exhibitJurisdiction?: unknown;
  matchedName?: unknown;
  exhibitLegalName?: unknown;
}): { href: string; kind: StateSosLinkKind; label: string } | null {
  const exhibit = String(row.exhibitJurisdiction ?? "").trim();
  const state = exhibitJurisdictionToUsState(exhibit);
  if (!state) return null;

  const entry = ENTITY_SOS_REGISTRY.find((r) => r.state === state);
  const name = pickEntitySearchName(row);

  const enc = encodeURIComponent(name);

  /** Florida Sunbiz — entity name is a path segment (documented URL pattern). */
  if (state === "FL" && name) {
    return {
      href: `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/EntityName/${enc}/Page1`,
      kind: "prefilled",
      label: "Florida Sunbiz — entity name search",
    };
  }

  /** Delaware ICIS — `entityName` query is accepted by the site (bookmark-style prefill). */
  if (state === "DE" && name) {
    return {
      href: `https://icis.corp.delaware.gov/Ecorp/EntitySearch/NameSearch.aspx?entityName=${enc}`,
      kind: "prefilled",
      label: "Delaware Division of Corporations — general information name search",
    };
  }

  if (!entry) return null;

  /** No searchable name or non-prefill state: official SOS portal from the curated registry. */
  return {
    href: entry.sourceUrl,
    kind: "portal",
    label: name
      ? `${entry.sourceName} — open search and paste: ${name}`
      : `${entry.sourceName} — open entity search`,
  };
}
