import type { XPostProvider, XProviderResult, XSearchParams } from "../types";

/** Stub: full archive requires extra access. Implemented later without rewriting service. */
export function createFullArchiveSearchProvider(enabled: boolean): XPostProvider {
  return {
    id: "full_archive",
    enabled,
    async search(_params: XSearchParams): Promise<XProviderResult> {
      return {
        providerId: "full_archive",
        success: false,
        posts: [],
        error: "Full archive provider not implemented in this build (requires access + endpoint wiring).",
      };
    },
  };
}

