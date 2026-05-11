/**
 * What users do for bulk/portal sources and what company-relevant information may appear.
 * Shown in Other Regulatory Filings when the source is not a live in-app API search.
 */

export type RegulatoryAccessGuide = {
  /** Access, login, API-key, or download requirements */
  accessRequirements?: string[];
  /** Steps to find company-related filings or records */
  howToAccess: string[];
  /** What kinds of records / filings / data might relate to a company or issuer diligence */
  whatsInside: string[];
};

export const REGULATORY_ACCESS_GUIDES: Record<string, RegulatoryAccessGuide> = {
  epa_echo: {
    howToAccess: [
      "Use EPA’s ECHO facility and compliance search with facility name, address, or EPA IDs (FRS / registry IDs when known).",
      "Narrow by state, NAICS/SIC, or program (air, water, hazardous waste) if the portal allows.",
      "Open facility detail pages for inspections, violations, enforcement, and penalty summaries where published.",
    ],
    whatsInside: [
      "Permits and compliance status, inspections, violations, formal enforcement actions, penalties.",
      "Facility identifiers and program participation useful for cross-checking subsidiaries and plants.",
    ],
  },
  epa_envirofacts: {
    howToAccess: [
      "Search Envirofacts / FRS-oriented tools by facility name, location, or registry identifiers.",
      "Cross-link from a known facility to related environmental program records (air, water, waste, etc.).",
    ],
    whatsInside: [
      "Facility registry attributes, permit/program participation, releases and emissions where reported.",
      "Useful for tying a legal entity or site to environmental program footprints—not a single “company filing” like the SEC.",
    ],
  },
  cms_data: {
    howToAccess: [
      "Use data.cms.gov (and related CMS tools) to find datasets for NPI lookup, provider enrollment, hospital/provider compare, or quality programs.",
      "Search by legal business name, “doing business as,” city/state, or NPI when you have it.",
      "Download bulk CSV/API slices for offline matching against issuer subsidiaries or healthcare ops.",
    ],
    whatsInside: [
      "Provider or facility identifiers, enrollment/participation, addresses, sometimes quality or utilization summaries.",
      "Useful when the issuer or subs operate Medicare-enrolled providers, clinics, or hospitals—not typical corporate “filings.”",
    ],
  },
  phmsa: {
    accessRequirements: [
      "Public website access only; no API key is required for the public PHMSA data/statistics pages.",
      "Bulk ZIP downloads may need offline review in Excel/CSV tools once downloaded.",
    ],
    howToAccess: [
      "Use PHMSA’s incident, operator, and enforcement statistics pages and downloadable datasets.",
      "Filter by operator name, state, mode (pipeline vs hazmat), or incident attributes depending on the dataset.",
    ],
    whatsInside: [
      "Pipeline and hazardous materials incident records, enforcement summaries, operator identifiers.",
      "Company relevance when the issuer transports energy/products via regulated pipelines or hazmat operations.",
    ],
  },
  ferc: {
    accessRequirements: [
      "Public website access only for eLibrary and company-registration pages; no API key is required for manual review.",
      "Users typically need to search by company name, CID, docket number, or accession number rather than ticker.",
    ],
    howToAccess: [
      "Use FERC eLibrary search by participant name, docket number, or filing description keywords.",
      "Filter by date and filing type (application, tariff, order-related filings) as needed.",
      "Open dockets and submittals for orders, notices, and substantive pleadings.",
    ],
    whatsInside: [
      "Rate cases, pipeline/electric/gas applications, tariffs, compliance filings, orders affecting utilities and midstream.",
      "Highly relevant for energy/infrastructure issuers; documents are docketed filings rather than a single API row.",
    ],
  },
  eia: {
    accessRequirements: [
      "Public browsing is available on EIA’s site, but programmatic API access requires an EIA Open Data API key.",
      "Users need to identify the relevant market/commodity/geography first because EIA is dataset-centric rather than company-centric.",
    ],
    howToAccess: [
      "Obtain an EIA Open Data API key at eia.gov/opendata and query series by route (electricity, petroleum, natural gas, etc.).",
      "Use geography, sector, and fuel keywords—EIA is market/series oriented, not a company registry.",
      "For issuer context, map facilities or regions to relevant price/production/storage series.",
    ],
    whatsInside: [
      "Energy prices, production, stocks, generation, trade—macro and regional indicators.",
      "Rarely “filings” about one company; used for sector and commodity context (e.g., power/gas/oil exposure).",
    ],
  },
  sam_gov: {
    accessRequirements: [
      "Public site access is available, but some workflows require SAM.gov login, identity verification, or an API key for automation.",
      "Best results usually require legal entity name, UEI, CAGE, or other government-contractor identifiers.",
    ],
    howToAccess: [
      "Create/login to SAM.gov; use Entity registration / exclusions / contract opportunities search as applicable.",
      "Search by legal entity name, UEI, or CAGE when known; opportunities search by NAICS or keyword.",
      "Federal contracting often requires identity verification and API keys for programmatic access.",
    ],
    whatsInside: [
      "Entity registration status, exclusion/debarment, solicitation/opportunity metadata.",
      "Relevant for government contractors, subs with federal awards, or exclusion risk.",
    ],
  },
  fdic_bankfind: {
    howToAccess: [
      "Open FDIC BankFind Suite (banks.data.fdic.gov) and search institution or branch by name, city, state, or certificate number.",
      "Review institution history, locations, mergers, and failures where applicable.",
    ],
    whatsInside: [
      "Insured institution profiles, branch lists, charter/status changes, historical banks and failures.",
      "Directly relevant for banks and holding companies; less so for non-bank industrials unless they own a bank.",
    ],
  },
  cfpb_complaints: {
    howToAccess: [
      "Download CFPB consumer complaint database (bulk CSV) from consumerfinance.gov data research pages.",
      "Filter or join in Excel/SQL by company name (cfpb-normalized company field), product, issue, state, or date.",
      "Treat as aggregated complaints—not adjudicated findings.",
    ],
    whatsInside: [
      "Complaint narratives (where published), product/issue tags, company response public-facing fields, timestamps.",
      "Signals consumer friction or regulatory attention for financial services brands—not formal agency “filings.”",
    ],
  },
  finra: {
    accessRequirements: [
      "Public BrokerCheck access is available with no API key, but users need firm/individual names or CRD identifiers.",
    ],
    howToAccess: [
      "Use FINRA BrokerCheck / regulatory pages for broker-dealer and rep disclosures.",
      "Search firm CRD / name; review disclosures, arbitration summaries, and regulatory events as presented.",
      "No general substitute for issuer 10-K search—focused on broker-dealer ecosystem.",
    ],
    whatsInside: [
      "BD disclosures, representative records, selected regulatory actions tied to firms/individuals.",
      "Relevant when diligence touches broker-dealers, capital markets intermediaries, or named affiliates.",
    ],
  },
  cftc: {
    accessRequirements: [
      "Public website access only; no unified company API is available for these manual searches.",
      "Users often need party names, registrant names, docket references, or commodity context to navigate effectively.",
    ],
    howToAccess: [
      "Use CFTC.gov enforcement, registrant lookup, and market data sections as appropriate.",
      "Enforcement matters are often PDF dockets; market datasets may be downloads or interactive tables.",
      "Expect manual navigation rather than one consolidated company search.",
    ],
    whatsInside: [
      "Enforcement orders, consent decrees, registrant categories, commitments of traders and market statistics.",
      "Company relevance mainly via derivatives enforcement, registrant status, or commodity exposure analysis.",
    ],
  },
  osha: {
    howToAccess: [
      "Use OSHA establishment/inspection datasets (downloads) or OSHA ITA search tools where available.",
      "Match on employer name, NAICS, state, or establishment; verify weak name matches on addresses.",
    ],
    whatsInside: [
      "Inspections, citations, penalties, accident summaries tied to establishments.",
      "Useful for manufacturers, logistics, and industrial ops—not SEC-style issuer filings.",
    ],
  },
  msha: {
    accessRequirements: [
      "Public MSHA data downloads are available without an API key.",
      "Operator and mine matching is often manual and may require mine IDs, operator IDs, or subsidiary names.",
    ],
    howToAccess: [
      "Use MSHA Data Sources for mines, accidents, violations, and enforcement; download or query by mine ID/operator.",
      "Operator name searches need care (subsidiaries, mine names).",
    ],
    whatsInside: [
      "Mine/quarry identifiers, violations, accidents, assessments.",
      "Relevant for mining aggregates, cement, coal exposure—not general corporate charter filings.",
    ],
  },
  ofac: {
    howToAccess: [
      "Download OFAC SDN and consolidated lists (Treasury) on a schedule you can defend for compliance.",
      "Screen legal entities and aliases using your compliance tool or offline matching; fuzzy matching needs governance.",
      "No substitute for formal sanctions screening programs for regulated firms.",
    ],
    whatsInside: [
      "Blocked persons, entities, vessels, IDs, alternate names; consolidated sanctions references.",
      "Critical for counterparty/vendor screening—not corporate disclosure “filings.”",
    ],
  },
  itc: {
    accessRequirements: [
      "Public website access only; users typically need investigation numbers, party names, or product/patent keywords.",
    ],
    howToAccess: [
      "Use USITC investigation docket/search tools with investigation number, parties, or product/patent keywords.",
      "Review public complaints, orders, and opinions as posted per investigation.",
    ],
    whatsInside: [
      "Section 337 and trade remedy materials: parties, patents/products at issue, remedial orders.",
      "Relevant for tech/manufacturing trade disputes involving imports.",
    ],
  },
  copyright: {
    accessRequirements: [
      "Public catalog access is available without an API key.",
      "Recorded documents and chain-of-title review may require separate search paths and manual inspection of records.",
    ],
    howToAccess: [
      "Use the Copyright Office public catalog search (and related tools) by title, claimant, keyword, or registration number.",
      "Recorded documents may require separate search paths for transfers/security interests.",
    ],
    whatsInside: [
      "Registration records, dates, titles, claimants; recorded documents affecting copyright interests.",
      "Useful for media/software/brands; not issuer periodic reports.",
    ],
  },
  nhtsa: {
    accessRequirements: [
      "Public DOT/NHTSA data access is available without an API key for the public datasets and search pages used here.",
      "Users may need manufacturer names, campaign numbers, complaint IDs, or product names for better manual review.",
    ],
    howToAccess: [
      "Use NHTSA recalls, complaints, investigations, and manufacturer lookup pages or public DOT datasets.",
      "Search by manufacturer/company name, campaign number, product line, or issue keyword depending on the workflow.",
    ],
    whatsInside: [
      "Vehicle recalls, complaints, investigations, manufacturer context, and related safety actions.",
      "Most relevant for auto suppliers, OEMs, fleet operators, and businesses with vehicle/product safety exposure.",
    ],
  },
};

export function accessGuideForSource(sourceId: string): RegulatoryAccessGuide | null {
  return REGULATORY_ACCESS_GUIDES[sourceId] ?? null;
}
