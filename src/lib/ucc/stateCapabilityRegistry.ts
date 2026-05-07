/**
 * UCC state capability registry — single configurable source for automation buckets.
 * Update entries here (or split into JSON import later). Do not scatter assumptions across the app.
 */

export type UccAutomationBucketKey =
  | "bulk_data"
  | "bulk_data_or_paid_subscription"
  | "database_download_or_public_search"
  | "paid_bulk_csv"
  | "paid_bulk_data"
  | "api_or_public_portal_candidate"
  | "public_portal_candidate"
  | "public_vendor_portal_candidate"
  | "manual_authorized_searcher"
  | "unknown_needs_configuration";

export type UccAdapterStatus = "not_started" | "in_progress" | "working" | "blocked" | "manual_only";

export type UccAutomationAllowed = "yes" | "no" | "unknown";

export type StateCapabilityRecord = {
  state: string;
  state_name: string;
  bucket: UccAutomationBucketKey;
  priority: "high" | "medium" | "low";
  official_search_url: string;
  bulk_data_url: string;
  api_url: string;
  requires_login: boolean;
  requires_payment: boolean;
  requires_subscription: boolean;
  captcha_likely: boolean;
  automation_allowed: UccAutomationAllowed;
  supports_debtor_search: boolean;
  supports_secured_party_search: boolean;
  supports_images: "yes" | "no" | "unknown";
  data_format: string;
  adapter_status: UccAdapterStatus;
  notes: string;
};

function baseUnknown(state: string, stateName: string): StateCapabilityRecord {
  return {
    state,
    state_name: stateName,
    bucket: "unknown_needs_configuration",
    priority: "low",
    official_search_url: "",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: false,
    requires_subscription: false,
    captcha_likely: false,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: false,
    supports_images: "unknown",
    data_format: "manual",
    adapter_status: "not_started",
    notes: "No validated adapter in this deployment. Manual tasks until capability is verified.",
  };
}

/** Pseudo-state for entities without a confident US formation footprint. */
export const UNKNOWN_JURISDICTION_CODE = "UN";

const US_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

/** Curated overrides — expand as adapters are verified. */
export const UCC_STATE_CAPABILITY_OVERRIDES: Partial<Record<string, StateCapabilityRecord>> = {
  TX: {
    state: "TX",
    state_name: "Texas",
    bucket: "bulk_data",
    priority: "high",
    official_search_url: "https://www.sos.texas.gov/",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: true,
    requires_subscription: true,
    captcha_likely: false,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "json/csv/bulk_download",
    adapter_status: "not_started",
    notes: "Texas publishes bulk UCC datasets subject to fees/terms — configure credentials before automated ingest.",
  },
  MN: {
    state: "MN",
    state_name: "Minnesota",
    bucket: "bulk_data_or_paid_subscription",
    priority: "medium",
    official_search_url: "https://www.sos.state.mn.us/",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: true,
    requires_subscription: true,
    captcha_likely: false,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "csv/xml",
    adapter_status: "not_started",
    notes: "Often subscription/paid bulk — verify current SOS offering.",
  },
  ID: {
    state: "ID",
    state_name: "Idaho",
    bucket: "bulk_data_or_paid_subscription",
    priority: "medium",
    official_search_url: "https://sos.idaho.gov/",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: true,
    requires_subscription: false,
    captcha_likely: false,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "csv",
    adapter_status: "not_started",
    notes: "Paid/bulk options vary — confirm before automation.",
  },
  WV: {
    state: "WV",
    state_name: "West Virginia",
    bucket: "bulk_data",
    priority: "medium",
    official_search_url: "https://apps.sos.wv.gov/",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: false,
    requires_subscription: false,
    captcha_likely: false,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "bulk_download",
    adapter_status: "not_started",
    notes: "Structured/bulk access candidate — validate terms.",
  },
  TN: {
    state: "TN",
    state_name: "Tennessee",
    bucket: "database_download_or_public_search",
    priority: "medium",
    official_search_url: "https://tnbear.tn.gov/",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: false,
    requires_subscription: false,
    captcha_likely: true,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "html/database_download",
    adapter_status: "not_started",
    notes: "Portal vs downloadable DB — test CAPTCHA/rate limits before automation.",
  },
  CA: {
    state: "CA",
    state_name: "California",
    bucket: "api_or_public_portal_candidate",
    priority: "high",
    official_search_url: "https://bizfileonline.sos.ca.gov/",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: false,
    requires_subscription: false,
    captcha_likely: true,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "html/api_candidate",
    adapter_status: "not_started",
    notes: "Treat as portal/API candidate — no bypass of CAPTCHA or bot controls.",
  },
  SC: {
    state: "SC",
    state_name: "South Carolina",
    bucket: "paid_bulk_csv",
    priority: "medium",
    official_search_url: "https://businessfilings.sc.gov/",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: true,
    requires_subscription: false,
    captcha_likely: false,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "csv",
    adapter_status: "not_started",
    notes: "Paid CSV history common — confirm current SOS package.",
  },
  KY: {
    state: "KY",
    state_name: "Kentucky",
    bucket: "paid_bulk_data",
    priority: "medium",
    official_search_url: "https://web.sos.ky.gov/",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: true,
    requires_subscription: false,
    captcha_likely: false,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "csv/xml",
    adapter_status: "not_started",
    notes: "Paid bulk datasets — configure subscription before ingest.",
  },
  VA: {
    state: "VA",
    state_name: "Virginia",
    bucket: "public_portal_candidate",
    priority: "medium",
    official_search_url: "https://www.scc.virginia.gov/",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: false,
    requires_subscription: false,
    captcha_likely: true,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "html",
    adapter_status: "not_started",
    notes: "Portal automation candidate subject to terms + CAPTCHA.",
  },
  FL: {
    state: "FL",
    state_name: "Florida",
    bucket: "public_vendor_portal_candidate",
    priority: "medium",
    official_search_url: "https://www.sunbiz.org/",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: false,
    requires_subscription: false,
    captcha_likely: true,
    automation_allowed: "unknown",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "html",
    adapter_status: "not_started",
    notes: "Often vendor-assisted search UX — verify debtor-search availability without violating terms.",
  },
  DE: {
    state: "DE",
    state_name: "Delaware",
    bucket: "manual_authorized_searcher",
    priority: "high",
    official_search_url: "https://corp.delaware.gov/",
    bulk_data_url: "",
    api_url: "",
    requires_login: true,
    requires_payment: true,
    requires_subscription: false,
    captcha_likely: false,
    automation_allowed: "no",
    supports_debtor_search: true,
    supports_secured_party_search: true,
    supports_images: "unknown",
    data_format: "authorized_searcher_order",
    adapter_status: "manual_only",
    notes: "Delaware UCC debtor searches typically require authorized searcher / certified workflow — do not scrape.",
  },
  UN: {
    state: "UN",
    state_name: "Unknown jurisdiction",
    bucket: "unknown_needs_configuration",
    priority: "low",
    official_search_url: "",
    bulk_data_url: "",
    api_url: "",
    requires_login: false,
    requires_payment: false,
    requires_subscription: false,
    captcha_likely: false,
    automation_allowed: "unknown",
    supports_debtor_search: false,
    supports_secured_party_search: false,
    supports_images: "unknown",
    data_format: "manual",
    adapter_status: "blocked",
    notes: "Resolve charter / SOS jurisdiction before UCC searches.",
  },
};

export function getStateCapability(stateAbbr: string): StateCapabilityRecord {
  const st = stateAbbr.trim().toUpperCase();
  const nm = US_NAMES[st] ?? (st === UNKNOWN_JURISDICTION_CODE ? "Unknown" : st);
  return UCC_STATE_CAPABILITY_OVERRIDES[st] ?? baseUnknown(st, nm);
}

/** Display bucket (A/B/C/D) for UI. */
export function automationBucketLetter(bucket: UccAutomationBucketKey): "A" | "B" | "C" | "D" {
  switch (bucket) {
    case "bulk_data":
    case "bulk_data_or_paid_subscription":
    case "paid_bulk_csv":
    case "paid_bulk_data":
    case "database_download_or_public_search":
      return "A";
    case "api_or_public_portal_candidate":
    case "public_portal_candidate":
    case "public_vendor_portal_candidate":
      return "B";
    case "manual_authorized_searcher":
      return "C";
    default:
      return "D";
  }
}

export function portalUrlForCapability(cap: StateCapabilityRecord): string {
  if (cap.state === UNKNOWN_JURISDICTION_CODE) return "https://www.nass.org/business-services/ucc-search";
  if (cap.official_search_url.trim()) return cap.official_search_url.trim();
  return `https://www.nass.org/business-services/ucc-search#${encodeURIComponent(cap.state)}`;
}

/** Conservative workflow label until real adapters report running/completed. */
export function resolveEntityWorkflowSearchStatus(cap: StateCapabilityRecord): string {
  if (cap.state === UNKNOWN_JURISDICTION_CODE) return "Blocked";
  if (cap.adapter_status === "manual_only") return "Manual Required";
  if (cap.adapter_status === "blocked") return "Error";
  if (cap.bucket === "manual_authorized_searcher") return "Manual Required";
  if (cap.requires_payment || cap.requires_subscription) return "Payment Required";
  if (cap.requires_login) return "Login Required";
  if (cap.captcha_likely && cap.bucket !== "bulk_data") return "Manual Required";
  if (
    cap.bucket === "bulk_data" ||
    cap.bucket === "bulk_data_or_paid_subscription" ||
    cap.bucket === "paid_bulk_csv" ||
    cap.bucket === "paid_bulk_data"
  ) {
    if (cap.adapter_status === "working") return "Ready";
    return "Subscription Required";
  }
  if (cap.bucket === "database_download_or_public_search") {
    return cap.adapter_status === "working" ? "Ready" : "Adapter Not Configured";
  }
  if (
    cap.bucket === "api_or_public_portal_candidate" ||
    cap.bucket === "public_portal_candidate" ||
    cap.bucket === "public_vendor_portal_candidate"
  ) {
    return cap.adapter_status === "working" ? "Ready" : "Adapter Not Configured";
  }
  return "Adapter Not Configured";
}

export function recommendedSearchMethodLabel(cap: StateCapabilityRecord): string {
  const letter = automationBucketLetter(cap.bucket);
  if (letter === "A") return cap.requires_subscription ? "Bulk data / subscription" : "Bulk JSON / official dataset";
  if (letter === "B") return "Public portal / browser automation candidate";
  if (letter === "C") return "Manual / authorized searcher";
  return "Manual queue until adapter configured";
}
