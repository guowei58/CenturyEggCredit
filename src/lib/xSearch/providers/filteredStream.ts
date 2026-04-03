import type { XPostProvider, XProviderResult, XSearchParams } from "../types";

/** Stub: filtered stream is for ongoing ingestion; not used for on-demand search. */
export function createFilteredStreamProvider(enabled: boolean): XPostProvider {
  return {
    id: "filtered_stream",
    enabled,
    async search(_params: XSearchParams): Promise<XProviderResult> {
      return {
        providerId: "filtered_stream",
        success: false,
        posts: [],
        error: "Filtered stream provider is ingestion-only and not implemented for search yet.",
      };
    },
  };
}

