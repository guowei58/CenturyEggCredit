/**
 * How each regulatory source is reached in practice — drives UI badges and grouping.
 * “live_api” = this repo has a server adapter that calls an official HTTP API.
 */
export type RegulatoryConnectionBucket =
  | "live_api"
  | "official_api_needs_key"
  | "bulk_download"
  | "portal_manual";

/** Bucket label for UI */
export const CONNECTION_BUCKET_LABEL: Record<RegulatoryConnectionBucket, string> = {
  live_api: "Live API",
  official_api_needs_key: "Official API (env key)",
  bulk_download: "Bulk / download",
  portal_manual: "Portal / manual",
};

export const SOURCE_CONNECTION_BUCKET: Record<string, RegulatoryConnectionBucket> = {
  enforcements: "live_api",
  litigation: "official_api_needs_key",
  epa_echo: "live_api",
  epa_envirofacts: "live_api",
  fda_openfda: "live_api",
  cms_data: "live_api",
  nhtsa: "live_api",
  phmsa: "portal_manual",
  ferc: "portal_manual",
  occ_institution_data: "live_api",
  ffiec_cdr: "bulk_download",
  eia: "official_api_needs_key",
  sam_gov: "official_api_needs_key",
  usaspending: "live_api",
  fdic_bankfind: "live_api",
  cfpb_complaints: "live_api",
  finra: "portal_manual",
  cftc: "portal_manual",
  federal_register: "live_api",
  regulations_gov: "live_api",
  ecfr: "live_api",
  osha: "live_api",
  msha: "bulk_download",
  fec: "official_api_needs_key",
  ofac: "live_api",
  itc: "portal_manual",
  copyright: "portal_manual",
};

export function connectionBucketForSource(sourceId: string): RegulatoryConnectionBucket {
  return SOURCE_CONNECTION_BUCKET[sourceId] ?? "portal_manual";
}

/** User-facing grouping: API vs manual/self-serve sources */
export type RegulatoryUiBucket = "api_enabled" | "manual_access";

export const UI_BUCKET_LABEL: Record<RegulatoryUiBucket, string> = {
  api_enabled: "API enabled",
  manual_access: "Manual / bulk access",
};

export const UI_BUCKET_ORDER: RegulatoryUiBucket[] = ["api_enabled", "manual_access"];

export function uiBucketForConnectionBucket(bucket: RegulatoryConnectionBucket): RegulatoryUiBucket {
  if (bucket === "live_api" || bucket === "official_api_needs_key") return "api_enabled";
  return "manual_access";
}

export function uiBucketForSource(sourceId: string): RegulatoryUiBucket {
  return uiBucketForConnectionBucket(connectionBucketForSource(sourceId));
}

/** Group source IDs by bucket for docs/UI summaries */
export function sourcesGroupedByBucket(): Record<RegulatoryConnectionBucket, string[]> {
  const out: Record<RegulatoryConnectionBucket, string[]> = {
    live_api: [],
    official_api_needs_key: [],
    bulk_download: [],
    portal_manual: [],
  };
  for (const [id, bucket] of Object.entries(SOURCE_CONNECTION_BUCKET)) {
    out[bucket].push(id);
  }
  return out;
}
