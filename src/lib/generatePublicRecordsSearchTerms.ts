import type { PublicRecordCategory } from "@/generated/prisma/client";

const SUFFIX_PATTERN =
  /\s*,?\s*(Inc\.?|LLC|L\.L\.C\.|Corp\.?|Corporation|Company|Co\.|LP|L\.P\.|Ltd\.?|PLC|PLLC)\s*$/i;

export type SearchTermProfileInput = {
  companyName?: string;
  ticker?: string;
  legalNames?: string[];
  formerNames?: string[];
  dbaNames?: string[];
  subsidiaryNames?: string[];
  borrowerNames?: string[];
  guarantorNames?: string[];
  issuerNames?: string[];
  parentCompanyNames?: string[];
  operatingCompanyNames?: string[];
  restrictedSubsidiaryNames?: string[];
  unrestrictedSubsidiaryNames?: string[];
  addresses?: string[];
  parcelNumbers?: string[];
};

export type GeneratedPublicRecordSearchTerms = {
  entityNameVariants: string[];
  categoryTerms: Record<PublicRecordCategory, string[]>;
  allTermsFlat: string[];
};

function dedupeOrdered(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function stripSuffix(name: string): string {
  return name.replace(SUFFIX_PATTERN, "").trim();
}

function stripPunctuation(name: string): string {
  return name.replace(/[^\p{L}\p{N}\s,&.-]/gu, "").replace(/\s+/g, " ").trim();
}

function variantsForName(name: string): string[] {
  const n = name.trim();
  if (!n) return [];
  const noPunct = stripPunctuation(n);
  const noSuffix = stripSuffix(noPunct);
  const noSuffixOrig = stripSuffix(n);
  return dedupeOrdered([n, noPunct, noSuffix, noSuffixOrig].filter(Boolean));
}

function collectNames(input: SearchTermProfileInput): string[] {
  const buckets = [
    input.companyName,
    input.ticker,
    ...(input.legalNames ?? []),
    ...(input.formerNames ?? []),
    ...(input.dbaNames ?? []),
    ...(input.subsidiaryNames ?? []),
    ...(input.borrowerNames ?? []),
    ...(input.guarantorNames ?? []),
    ...(input.issuerNames ?? []),
    ...(input.parentCompanyNames ?? []),
    ...(input.operatingCompanyNames ?? []),
    ...(input.restrictedSubsidiaryNames ?? []),
    ...(input.unrestrictedSubsidiaryNames ?? []),
  ];
  const variants: string[] = [];
  for (const b of buckets) {
    if (!b?.trim()) continue;
    variants.push(...variantsForName(b));
  }
  return dedupeOrdered(variants);
}

const CATEGORY_HINTS: Record<PublicRecordCategory, string[]> = {
  entity_sos: [],
  ucc_secured_debt: [
    "UCC-1",
    "Financing Statement",
    "UCC-3",
    "Amendment",
    "Continuation",
    "Termination",
    "Assignment",
    "Secured Party",
    "Fixture Filing",
  ],
  tax_liens_releases: [
    "Federal Tax Lien",
    "Notice of Federal Tax Lien",
    "NFTL",
    "IRS",
    "Internal Revenue Service",
    "United States of America",
    "Department of the Treasury",
    "Certificate of Release of Federal Tax Lien",
    "Release of Federal Tax Lien",
    "Form 668-Z",
    "Certificate of Withdrawal",
    "Certificate of Discharge",
    "Certificate of Subordination",
    "State Tax Lien",
    "Tax Warrant",
    "Franchise Tax Lien",
    "Sales Tax Lien",
    "Payroll Tax Lien",
  ],
  real_estate_recorder: [
    "Deed",
    "Mortgage",
    "Deed of Trust",
    "Assignment",
    "Release",
    "Easement",
    "Mechanic's Lien",
    "Judgment Lien",
    "Restriction",
    "Covenant",
    "Plat",
    "Memorandum of Lease",
  ],
  property_tax_assessor: ["delinquent", "tax account", "geo id", "parcel", "ownership"],
  permits_zoning_co: [
    "Building Permit",
    "Certificate of Occupancy",
    "Demolition Permit",
    "Site Plan",
    "Zoning",
    "Variance",
    "Code Violation",
    "Stop Work Order",
  ],
  environmental_compliance: [
    "Notice of Violation",
    "Enforcement",
    "Penalty",
    "Permit",
    "Air Permit",
    "Water Permit",
    "Stormwater",
    "Waste",
    "Spill",
    "Remediation",
    "Underground Storage Tank",
  ],
  courts_judgments: [
    "Complaint",
    "Judgment",
    "Collection",
    "Mechanic's Lien Foreclosure",
    "Receivership",
    "Eviction",
    "Contract Dispute",
    "Employment",
    "Consumer Protection",
  ],
  licenses_regulatory: [
    "License",
    "Permit",
    "Registration",
    "Disciplinary Action",
    "Suspension",
    "Consent Order",
    "Revocation",
  ],
  economic_incentives: [
    "Tax Abatement",
    "PILOT",
    "TIF",
    "Development Agreement",
    "Incentive Agreement",
    "Job Creation Grant",
    "Clawback",
  ],
  procurement_contracts: ["Contract", "Award", "RFP", "Bid", "Purchase Order", "Vendor Payment", "Termination"],
  gis_facility_mapping: ["parcel map", "zoning layer", "floodplain", "easement", "environmental overlay", "footprint"],
  other: [],
};

export function generatePublicRecordsSearchTerms(input: SearchTermProfileInput): GeneratedPublicRecordSearchTerms {
  const entityNameVariants = collectNames(input);
  const addresses = dedupeOrdered(input.addresses ?? []);
  const parcels = dedupeOrdered(input.parcelNumbers ?? []);

  const categoryTerms = {} as Record<PublicRecordCategory, string[]>;
  (Object.keys(CATEGORY_HINTS) as PublicRecordCategory[]).forEach((cat) => {
    categoryTerms[cat] = dedupeOrdered([
      ...entityNameVariants,
      ...addresses,
      ...(cat === "gis_facility_mapping" || cat === "property_tax_assessor" ? parcels : []),
      ...CATEGORY_HINTS[cat],
    ]);
  });

  const allTermsFlat = dedupeOrdered([
    ...entityNameVariants,
    ...addresses,
    ...parcels,
    ...Object.values(categoryTerms).flat(),
  ]);

  return { entityNameVariants, categoryTerms, allTermsFlat };
}
