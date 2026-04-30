/**
 * Curated SOS / chartering search entry points — user runs searches manually; no scraping here.
 */

export type EntityRegistrySourceRow = {
  state: string;
  sourceName: string;
  sourceUrl: string;
  searchInstructions: string;
  requiresLogin: boolean;
  hasFees: boolean;
  supportsNameSearch: boolean;
  supportsEntityIdSearch: boolean;
  supportsAgentSearch: boolean;
  supportsOfficerSearch: boolean;
  supportsAddressSearch: boolean;
  supportsDocumentDownload: boolean;
  notes: string;
};

export const ENTITY_SOS_REGISTRY: EntityRegistrySourceRow[] = [
  {
    state: "DE",
    sourceName: "Delaware Division of Corporations Entity Search",
    sourceUrl: "https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx",
    searchInstructions:
      "Search exact legal name first. Capture file number, entity name, formation date, registered agent, and status where available.",
    requiresLogin: false,
    hasFees: true,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: false,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: "Basic entity search is available online; certificates may require fees.",
  },
  {
    state: "TX",
    sourceName: "Texas SOS — Taxable Entity Search",
    sourceUrl: "https://direct.sos.state.tx.us/search.aspx",
    searchInstructions: "Business organization search by entity name or file number.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: false,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: "Some historical images may redirect to paid SOSDirect filings.",
  },
  {
    state: "CA",
    sourceName: "California Secretary of State — Business Search",
    sourceUrl: "https://bizfileonline.sos.ca.gov/search/business",
    searchInstructions: "Search by corporation or LLC name; capture entity number and status.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: false,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: "Online status and filings; some documents limited without account.",
  },
  {
    state: "NY",
    sourceName: "New York DOS — Corporation & Business Entity Search",
    sourceUrl: "https://dos.ny.gov/corporation-and-business-entity-search",
    searchInstructions: "Search by entity name or DOS ID; review status and jurisdiction.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: false,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: "Filings ordering may require DOS account/fees.",
  },
  {
    state: "NV",
    sourceName: "Nevada Secretary of State — SilverFlume Business Search",
    sourceUrl: "https://www.nvsos.gov/sosentitysearch/",
    searchInstructions: "SilverFlume NV business search — capture NV entity ID and status.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: false,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: "Annual lists and charter documents often fee-based.",
  },
  {
    state: "FL",
    sourceName: "Florida Division of Corporations — Search",
    sourceUrl: "https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquirytype=EntityName",
    searchInstructions: "Sunbiz name search — document number, status, registered agent.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: true,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: "Some images require Sunbiz cart purchase.",
  },
  {
    state: "IL",
    sourceName: "Illinois Secretary of State — Corporation LLC Search",
    sourceUrl: "https://apps.ilsos.gov/CORP/Default.aspx",
    searchInstructions: "Search by name or file number.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: false,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: "Good standing certificates may be fee-based.",
  },
  {
    state: "OH",
    sourceName: "Ohio SOS — Business Search",
    sourceUrl: "https://bizfilingsportal.sos.state.oh.us/search",
    searchInstructions: "Ohio business entity search by name or charter number.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: false,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: "Some filings downloadable; certified copies typically fee.",
  },
  {
    state: "PA",
    sourceName: "Pennsylvania SOS — Business Entity Search",
    sourceUrl: "https://www.corporations.pa.gov/search/corpsearch",
    searchInstructions: "Search by entity name or entity number.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: false,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: "PACast / certified copies often separate workflows.",
  },
  {
    state: "GA",
    sourceName: "Georgia SOS — Corporations Division Search",
    sourceUrl: "https://ecorp.sos.ga.gov/BusinessSearch",
    searchInstructions: "Search by business name or control number.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: false,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: "Online filings may require registered agent signup for some workflows.",
  },
];

export function getEntitySourceRowsForStates(states: string[], customRows: EntityRegistrySourceRow[] = []): EntityRegistrySourceRow[] {
  const norm = (s: string) => s.trim().toUpperCase();
  const want = new Set(states.map(norm).filter(Boolean));
  const base = ENTITY_SOS_REGISTRY.filter((r) => want.has(norm(r.state)));
  const merged = [...base];
  const seen = new Set(base.map((r) => `${norm(r.state)}|${r.sourceUrl}`));
  for (const c of customRows) {
    const key = `${norm(c.state)}|${c.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return merged;
}
