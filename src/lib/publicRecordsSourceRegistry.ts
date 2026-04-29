import type { PublicRecordCategory, PublicRecordJurisdictionType } from "@/generated/prisma/client";

/** MVP catalog entry — merged at runtime with user-added sources. IDs must remain stable. */
export type PublicRecordRegistryEntry = {
  id: string;
  category: PublicRecordCategory;
  jurisdictionType: PublicRecordJurisdictionType;
  jurisdictionName: string;
  state?: string;
  county?: string;
  city?: string;
  agencyName?: string;
  sourceName: string;
  sourceUrl: string;
  searchInstructions: string;
  searchUseCase?: string;
  requiresLogin: boolean;
  hasFees: boolean;
  supportsNameSearch: boolean;
  supportsAddressSearch: boolean;
  supportsParcelSearch: boolean;
  supportsInstrumentSearch: boolean;
  supportsPdfDownload: boolean;
};

export const PUBLIC_RECORDS_REGISTRY: PublicRecordRegistryEntry[] = [
  {
    id: "tx-sos-entity",
    category: "entity_sos",
    jurisdictionType: "state",
    jurisdictionName: "Texas",
    state: "TX",
    agencyName: "Texas Secretary of State",
    sourceName: "Texas SOS — Entity search / filings",
    sourceUrl: "https://direct.sos.state.tx.us/",
    searchInstructions:
      "Search by entity name or file number. Review status, registered agent, assumed names, amendments, and charter filings.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsAddressSearch: false,
    supportsParcelSearch: false,
    supportsInstrumentSearch: true,
    supportsPdfDownload: true,
  },
  {
    id: "tx-sosdirect-ucc",
    category: "ucc_secured_debt",
    jurisdictionType: "state",
    jurisdictionName: "Texas",
    state: "TX",
    agencyName: "Texas Secretary of State (SOSDirect)",
    sourceName: "Texas UCC / SOSDirect",
    sourceUrl: "https://www.sos.state.tx.us/index.shtml",
    searchInstructions:
      "SOSDirect requires subscription login for UCC searches. Search debtor / secured party and pull financing statements and amendments.",
    searchUseCase: "UCC-1, UCC-3 amendment, continuation, termination, assignment.",
    requiresLogin: true,
    hasFees: true,
    supportsNameSearch: true,
    supportsAddressSearch: false,
    supportsParcelSearch: false,
    supportsInstrumentSearch: true,
    supportsPdfDownload: true,
  },
  {
    id: "travis-county-opr",
    category: "real_estate_recorder",
    jurisdictionType: "county",
    jurisdictionName: "Travis County, Texas",
    state: "TX",
    county: "Travis",
    sourceName: "Travis County Clerk — Official Public Records",
    sourceUrl: "https://travis.tx.publicsearch.us/",
    searchInstructions:
      "Search by party name, instrument type, or reception number. Cross-check legal descriptions with assessor parcel.",
    requiresLogin: false,
    hasFees: true,
    supportsNameSearch: true,
    supportsAddressSearch: true,
    supportsParcelSearch: false,
    supportsInstrumentSearch: true,
    supportsPdfDownload: true,
  },
  {
    id: "travis-cad",
    category: "property_tax_assessor",
    jurisdictionType: "county",
    jurisdictionName: "Travis County, Texas",
    state: "TX",
    county: "Travis",
    agencyName: "Travis Central Appraisal District",
    sourceName: "Travis CAD — Property search",
    sourceUrl: "https://www.traviscad.org/",
    searchInstructions: "Search by owner name, address, or geo ID; verify assessed value and exemption flags.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsAddressSearch: true,
    supportsParcelSearch: true,
    supportsInstrumentSearch: false,
    supportsPdfDownload: false,
  },
  {
    id: "travis-tax-office",
    category: "property_tax_assessor",
    jurisdictionType: "county",
    jurisdictionName: "Travis County, Texas",
    state: "TX",
    county: "Travis",
    sourceName: "Travis County Tax Office — Collections / payments",
    sourceUrl: "https://www.traviscountytax.com/",
    searchInstructions: "Verify tax account status, delinquency, and payment history using CAD geo ID where linked.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsAddressSearch: true,
    supportsParcelSearch: true,
    supportsInstrumentSearch: false,
    supportsPdfDownload: false,
  },
  {
    id: "austin-dev-services",
    category: "permits_zoning_co",
    jurisdictionType: "city",
    jurisdictionName: "Austin, Texas",
    state: "TX",
    city: "Austin",
    agencyName: "City of Austin Development Services",
    sourceName: "Austin — Permits & development",
    sourceUrl: "https://www.austintexas.gov/page/development-services",
    searchInstructions:
      "Use Austin permit / development portals for building permits, COs, site plans, and code cases (exact portal paths change—follow site navigation).",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsAddressSearch: true,
    supportsParcelSearch: false,
    supportsInstrumentSearch: false,
    supportsPdfDownload: false,
  },
  {
    id: "tceq-compliance",
    category: "environmental_compliance",
    jurisdictionType: "state",
    jurisdictionName: "Texas",
    state: "TX",
    agencyName: "Texas Commission on Environmental Quality",
    sourceName: "TCEQ — Permits & compliance search",
    sourceUrl: "https://www.tceq.texas.gov/",
    searchInstructions:
      "Use TCEQ tools for permits, enforcement, violations, and remediation records tied to facility / RN / permit ID.",
    requiresLogin: false,
    hasFees: false,
    supportsNameSearch: true,
    supportsAddressSearch: true,
    supportsParcelSearch: false,
    supportsInstrumentSearch: false,
    supportsPdfDownload: true,
  },
  {
    id: "de-corporations",
    category: "entity_sos",
    jurisdictionType: "state",
    jurisdictionName: "Delaware",
    state: "DE",
    agencyName: "Delaware Division of Corporations",
    sourceName: "Delaware — Entity search",
    sourceUrl: "https://icis.corp.delaware.gov/Ecorp/EntitySearch/NameSearch.aspx",
    searchInstructions: "Search entity name and retrieve charter details; many filings require certified copies via paid services.",
    requiresLogin: false,
    hasFees: true,
    supportsNameSearch: true,
    supportsAddressSearch: false,
    supportsParcelSearch: false,
    supportsInstrumentSearch: true,
    supportsPdfDownload: true,
  },
  {
    id: "ny-dos-ucc",
    category: "ucc_secured_debt",
    jurisdictionType: "state",
    jurisdictionName: "New York",
    state: "NY",
    agencyName: "NY Department of State",
    sourceName: "New York — UCC / secured transaction records",
    sourceUrl: "https://www.dos.ny.gov/coog/",
    searchInstructions: "Use DOS online systems for UCC debtor / secured party searches per NY filing rules.",
    requiresLogin: false,
    hasFees: true,
    supportsNameSearch: true,
    supportsAddressSearch: false,
    supportsParcelSearch: false,
    supportsInstrumentSearch: true,
    supportsPdfDownload: true,
  },
  {
    id: "ca-sos-biz",
    category: "ucc_secured_debt",
    jurisdictionType: "state",
    jurisdictionName: "California",
    state: "CA",
    agencyName: "California Secretary of State",
    sourceName: "California SOS — Business / UCC tools",
    sourceUrl: "https://bizfileonline.sos.ca.gov/",
    searchInstructions: "Use BizFile for business entities and UCC-related filings available online.",
    requiresLogin: false,
    hasFees: true,
    supportsNameSearch: true,
    supportsAddressSearch: false,
    supportsParcelSearch: false,
    supportsInstrumentSearch: true,
    supportsPdfDownload: true,
  },
];

export function getRegistryEntry(id: string): PublicRecordRegistryEntry | undefined {
  return PUBLIC_RECORDS_REGISTRY.find((e) => e.id === id);
}

export function registrySourceKey(id: string): string {
  return `registry:${id}`;
}

export function parseRegistrySourceKey(key: string): string | null {
  if (!key.startsWith("registry:")) return null;
  return key.slice("registry:".length) || null;
}
