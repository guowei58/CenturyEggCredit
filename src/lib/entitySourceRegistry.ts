/**
 * Curated SOS / chartering search entry points — user runs searches manually; no scraping here.
 * Covers all U.S. states + DC with official (or primary) business entity search landing URLs.
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

function sosEntry(
  state: string,
  sourceName: string,
  sourceUrl: string,
  opts?: Partial<Pick<EntityRegistrySourceRow, "searchInstructions" | "hasFees" | "supportsAgentSearch" | "notes">>
): EntityRegistrySourceRow {
  return {
    state,
    sourceName,
    sourceUrl,
    searchInstructions: opts?.searchInstructions ?? "Search by legal entity name or charter / file number.",
    requiresLogin: false,
    hasFees: opts?.hasFees ?? false,
    supportsNameSearch: true,
    supportsEntityIdSearch: true,
    supportsAgentSearch: opts?.supportsAgentSearch ?? false,
    supportsOfficerSearch: false,
    supportsAddressSearch: false,
    supportsDocumentDownload: true,
    notes: opts?.notes ?? "Portal paths change occasionally — use entity name from Exhibit 21 / GLEIF.",
  };
}

export const ENTITY_SOS_REGISTRY: EntityRegistrySourceRow[] = [
  sosEntry(
    "AK",
    "Alaska Division of Corporations — Entity Search",
    "https://www.commerce.alaska.gov/cbp/main/search/entities"
  ),
  sosEntry(
    "AL",
    "Alabama Secretary of State — Business Entity Records (name search)",
    "https://arc-sos.state.al.us/CGI/CORPNAME.MBR/INPUT",
    {
      notes: "Alternate lookups (agent/officer) linked from the SOS Business Entity Records hub.",
    }
  ),
  sosEntry(
    "AR",
    "Arkansas Secretary of State — Corporation / LLC Search",
    "https://sos-corp-search.ark.org/corps"
  ),
  sosEntry(
    "AZ",
    "Arizona Corporation Commission — Entity Search",
    "https://ecorp.azcc.gov/EntitySearch/Index"
  ),
  sosEntry(
    "CA",
    "California Secretary of State — Business Search",
    "https://bizfileonline.sos.ca.gov/search/business",
    {
      searchInstructions: "Search by corporation or LLC name; capture entity number and status.",
      notes: "Online status and filings; some documents limited without account.",
    }
  ),
  sosEntry(
    "CO",
    "Colorado Secretary of State — Business Database Search",
    "https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do"
  ),
  sosEntry(
    "CT",
    "Connecticut Secretary of State — Business Inquiry",
    "https://service.ct.gov/business/s/onlinebusinesssearch?language=en_US"
  ),
  sosEntry(
    "DC",
    "DC DLCP — CorpOnline business entity search",
    "https://corponline.dlcp.dc.gov/homepage/business-search",
    {
      notes: "Business entities are filed with DLCP (CorpOnline), not a traditional Secretary of State.",
    }
  ),
  sosEntry(
    "DE",
    "Delaware Division of Corporations Entity Search",
    "https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx",
    {
      searchInstructions:
        "Search exact legal name first. Capture file number, entity name, formation date, registered agent, and status where available.",
      hasFees: true,
      notes: "Basic entity search is available online; certificates may require fees.",
    }
  ),
  sosEntry(
    "FL",
    "Florida Division of Corporations — Search",
    "https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquirytype=EntityName",
    {
      searchInstructions: "Sunbiz name search — document number, status, registered agent.",
      supportsAgentSearch: true,
      notes: "Some images require Sunbiz cart purchase.",
    }
  ),
  sosEntry(
    "GA",
    "Georgia SOS — Corporations Division Search",
    "https://ecorp.sos.ga.gov/BusinessSearch",
    {
      searchInstructions: "Search by business name or control number.",
      notes: "Online filings may require registered agent signup for some workflows.",
    }
  ),
  sosEntry(
    "HI",
    "Hawaii DCCA — Hawaii Business Express (business search)",
    "https://hbe.ehawaii.gov/documents"
  ),
  sosEntry(
    "IA",
    "Iowa Secretary of State — Business Entities Search",
    "https://sos.iowa.gov/search/business/search.aspx"
  ),
  sosEntry(
    "ID",
    "Idaho Secretary of State — Business Entity Search",
    "https://sosbiz.idaho.gov/search/business"
  ),
  sosEntry(
    "IL",
    "Illinois Secretary of State — Corporation LLC Search",
    "https://apps.ilsos.gov/CORP/Default.aspx",
    {
      notes: "Good standing certificates may be fee-based.",
    }
  ),
  sosEntry(
    "IN",
    "Indiana Secretary of State — INBiz Entity Search",
    "https://bsd.sos.in.gov/publicbusinesssearch"
  ),
  sosEntry(
    "KS",
    "Kansas Secretary of State — Business Entity Search",
    "https://www.kansas.gov/bess/flow/main"
  ),
  sosEntry(
    "KY",
    "Kentucky Secretary of State — Business Entity Search (SOSBES)",
    "https://sosbes.sos.ky.gov/BusSearchNProfile/Search.aspx"
  ),
  sosEntry(
    "LA",
    "Louisiana Secretary of State — Commercial Search",
    "https://coraweb.sos.la.gov/CommercialSearch/CommercialSearch.aspx",
    {
      notes: "Commercial entity search by name, charter number, or officer/agent.",
    }
  ),
  sosEntry(
    "MA",
    "Massachusetts Secretary of State — Corporations Division Search",
    "https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx"
  ),
  sosEntry(
    "MD",
    "Maryland Secretary of State — Business Entity Search",
    "https://egov.maryland.gov/BusinessExpress/EntitySearch"
  ),
  sosEntry(
    "ME",
    "Maine Secretary of State — Corporations Search (ICRS)",
    "https://apps3.web.maine.gov/nei-sos-icrs/ICRS?MainPage="
  ),
  sosEntry(
    "MI",
    "Michigan LARA — Business Entity Search",
    "https://cofs.lara.state.mi.us/SearchApi/Search/Search"
  ),
  sosEntry(
    "MN",
    "Minnesota Secretary of State — Business Filings Search",
    "https://mblsportal.sos.state.mn.us/Business/Search"
  ),
  sosEntry(
    "MO",
    "Missouri Secretary of State — Business Entity Search",
    "https://bsd.sos.mo.gov/BusinessEntity/BusinessEntity.aspx"
  ),
  sosEntry(
    "MS",
    "Mississippi Secretary of State — Business Search",
    "https://corp.sos.ms.gov/corp/portal/c/page/corpBusinessIdSearch/portal.aspx"
  ),
  sosEntry(
    "MT",
    "Montana Secretary of State — Business Search",
    "https://biz.sosmt.gov/search/business"
  ),
  sosEntry(
    "NC",
    "North Carolina Secretary of State — Business Registration Search",
    "https://www.sosnc.gov/online_services/search/by_title/_Business_Registration"
  ),
  sosEntry(
    "ND",
    "North Dakota Secretary of State — FirstStop Business Search",
    "https://firststop.sos.nd.gov/search/business"
  ),
  sosEntry(
    "NE",
    "Nebraska Secretary of State — Corporate & Business Search",
    "https://www.nebraska.gov/sos/corp/corpsearch.cgi?nav=search"
  ),
  sosEntry(
    "NH",
    "New Hampshire Secretary of State — QuickStart Business Lookup",
    "https://quickstart.sos.nh.gov/online/BusinessInquiry"
  ),
  sosEntry(
    "NJ",
    "New Jersey Division of Revenue — Business Name Search",
    "https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName"
  ),
  sosEntry(
    "NM",
    "New Mexico Secretary of State — Business Services (Corporations / BFS)",
    "https://www.sos.nm.gov/business-services/",
    {
      searchInstructions:
        "From Business Services, use Corporations online search (Business Filing System) or enterprise.sos.nm.gov when linked.",
      notes: "Direct BFS search URLs sometimes move; this landing page links to the current corporation search tool.",
    }
  ),
  sosEntry(
    "NV",
    "Nevada Secretary of State — SilverFlume Business Search",
    "https://www.nvsos.gov/sosentitysearch/",
    {
      notes: "Annual lists and charter documents often fee-based.",
    }
  ),
  sosEntry(
    "NY",
    "New York DOS — Corporation & Business Entity Search",
    "https://dos.ny.gov/corporation-and-business-entity-search",
    {
      notes: "Filings ordering may require DOS account/fees.",
    }
  ),
  sosEntry(
    "OH",
    "Ohio Secretary of State — Business Search",
    "https://businesssearch.ohiosos.gov/",
    {
      notes: "Some filings downloadable; certified copies typically fee.",
    }
  ),
  sosEntry(
    "OK",
    "Oklahoma Secretary of State — Entity Search",
    "https://www.sos.ok.gov/corp/corpInquiryFind.aspx"
  ),
  sosEntry(
    "OR",
    "Oregon Secretary of State — Find a Business",
    "https://sos.oregon.gov/business/Pages/find.aspx"
  ),
  sosEntry(
    "PA",
    "Pennsylvania SOS — Business Entity Search",
    "https://www.corporations.pa.gov/search/corpsearch",
    {
      notes: "PACast / certified copies often separate workflows.",
    }
  ),
  sosEntry(
    "RI",
    "Rhode Island Secretary of State — Corporate Database",
    "https://business.sos.ri.gov/CorpWeb/CorpSearch/CorpSearch.aspx"
  ),
  sosEntry(
    "SC",
    "South Carolina Secretary of State — Business Entities Online",
    "https://businessfilings.sc.gov/BusinessFiling/Entity/Search"
  ),
  sosEntry(
    "SD",
    "South Dakota Secretary of State — Business Services Search",
    "https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx"
  ),
  sosEntry(
    "TN",
    "Tennessee Secretary of State — Business Information Search",
    "https://tnbear.tn.gov/Ecommerce/FilingSearch.aspx"
  ),
  sosEntry(
    "TX",
    "Texas Secretary of State — SOSDirect (business entity records)",
    "https://www.sos.texas.gov/corp/sosda/index.shtml",
    {
      hasFees: true,
      notes:
        "Entity inquiries use SOSDirect (direct.sos.state.tx.us): temporary login or subscriber account; statutory fees apply per inquiry/order. Comptroller taxable entity search is a separate system.",
    }
  ),
  sosEntry(
    "UT",
    "Utah Division of Corporations — Entity Search",
    "https://secure.utah.gov/bes/action/index"
  ),
  sosEntry(
    "VA",
    "Virginia SCC — Clerk’s Information System Entity Search",
    "https://cis.scc.virginia.gov/EntitySearch/Index"
  ),
  sosEntry(
    "VT",
    "Vermont Secretary of State — Online Business Service Center",
    "https://bizfilings.vermont.gov/online/BusinessInquiry"
  ),
  sosEntry(
    "WA",
    "Washington Secretary of State — Corporations & Charities Search",
    "https://ccfs.sos.wa.gov/"
  ),
  sosEntry(
    "WI",
    "Wisconsin DFI — Corporate Records Search",
    "https://www.wdfi.org/apps/CorpSearch/Search.aspx"
  ),
  sosEntry(
    "WV",
    "West Virginia Secretary of State — Business Entity Search",
    "https://apps.wv.gov/SOS/BusinessEntitySearch/Default.aspx"
  ),
  sosEntry(
    "WY",
    "Wyoming Secretary of State — Business Entity Search",
    "https://wyobiz.wyo.gov/Business/FilingSearch.aspx"
  ),
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
