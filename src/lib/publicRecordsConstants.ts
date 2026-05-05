import type { PublicRecordCategory } from "@/generated/prisma/client";

export const PUBLIC_RECORD_CATEGORY_LABELS: Record<PublicRecordCategory, string> = {
  entity_sos: "Entity Universe & Affiliate Discovery",
  ucc_secured_debt: "UCC / Secured Debt",
  tax_liens_releases: "Tax Liens & Releases",
  real_estate_recorder: "Real Estate / County Recorder",
  property_tax_assessor: "Property Tax / Assessor",
  permits_zoning_co: "Permits / Zoning / Certificates of Occupancy",
  environmental_compliance: "Environmental / Compliance",
  courts_judgments: "Courts / Judgments",
  licenses_regulatory: "Licenses / Regulatory",
  economic_incentives: "Economic Incentives",
  procurement_contracts: "Procurement / Local Contracts",
  gis_facility_mapping: "GIS / Facility Mapping",
  other: "Other",
};

export const PUBLIC_RECORD_CATEGORY_DESCRIPTIONS: Record<PublicRecordCategory, string> = {
  entity_sos:
    "Build a credit-relevant entity universe using Exhibit 21, credit documents, UCC debtor searches, Secretary of State name-family searches, and address-cluster diligence—evidence capture first, not automated scraping.",
  ucc_secured_debt:
    "Search UCC financing statements, amendments, continuations, terminations, secured parties, collateral descriptions, and fixture filings.",
  tax_liens_releases:
    "Search federal, state, and local tax lien notices, releases, withdrawals, subordinations, discharges, tax warrants, and related recorded documents.",
  real_estate_recorder:
    "Search deeds, mortgages, deeds of trust, releases, assignments, easements, restrictions, mechanic’s liens, judgment liens, plats, and local recorded documents.",
  property_tax_assessor:
    "Search property ownership, parcel records, assessed values, property tax accounts, payment history, and delinquent taxes.",
  permits_zoning_co:
    "Search building permits, demolition permits, site plans, zoning cases, variances, code violations, stop-work orders, and certificates of occupancy.",
  environmental_compliance:
    "Search environmental permits, inspections, violations, enforcement actions, penalties, spill reports, underground storage tanks, and remediation records.",
  courts_judgments:
    "Search lawsuits, judgments, collections, mechanic’s lien foreclosures, receiverships, contract disputes, employment claims, and other state/local court matters.",
  licenses_regulatory:
    "Search operating licenses, professional licenses, facility licenses, permits, registrations, disciplinary actions, suspensions, revocations, and consent orders.",
  economic_incentives:
    "Search tax abatements, PILOT agreements, TIF agreements, development agreements, industrial revenue bonds, job grants, clawbacks, and local incentive packages.",
  procurement_contracts:
    "Search public contracts, awarded bids, RFPs, purchase orders, vendor payments, board approvals, contract amendments, and terminations.",
  gis_facility_mapping:
    "Search parcel maps, zoning layers, floodplains, easements, utility maps, environmental overlays, building footprints, and facility locations.",
  other: "Additional sources not categorized above.",
};

export const PUBLIC_RECORD_CATEGORIES_ORDER: PublicRecordCategory[] = [
  "entity_sos",
  "ucc_secured_debt",
  "tax_liens_releases",
  "real_estate_recorder",
  "property_tax_assessor",
  "permits_zoning_co",
  "environmental_compliance",
  "courts_judgments",
  "licenses_regulatory",
  "economic_incentives",
  "procurement_contracts",
  "gis_facility_mapping",
];

export const REGISTRY_DISCLAIMER =
  "This source registry is not exhaustive. Filing offices, portals, and search paths vary by jurisdiction and record type; some sources require login, fees, or manual requests.";

export const TAX_LIEN_DISCLAIMER =
  "Federal tax liens and releases are typically filed in state or local recording offices. A release is usually recorded in the same office as the original lien notice. Match releases using debtor name, jurisdiction, filing date, and recording/instrument number.";

export const UCC_DISCLAIMER =
  "UCC filings may identify secured parties and collateral descriptions, but they do not by themselves prove the current debt balance or lien priority. Review underlying credit documents and any amendments, continuations, assignments, and terminations.";

export const REAL_ESTATE_DISCLAIMER =
  "Recorded real estate documents may reveal ownership, mortgages, deeds of trust, easements, mechanic’s liens, releases, assignments, and restrictions. Always cross-check parcel records, recorder records, and tax records.";
