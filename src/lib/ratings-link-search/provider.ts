import { createGoogleCseProvider } from "./googleCseProvider";
import { createSerpApiProvider } from "./serpApiProvider";
import type { RatingsSearchProvider } from "./types";

export type ProviderConfigError = { code: "missing_env"; message: string };

export function getSearchProviderFromEnv():
  | { ok: true; provider: RatingsSearchProvider }
  | { ok: false; error: ProviderConfigError } {
  const which = (process.env.SEARCH_PROVIDER ?? "google").toLowerCase().trim();

  if (which === "serpapi") {
    const key = process.env.SERPAPI_API_KEY?.trim();
    if (!key) {
      return {
        ok: false,
        error: {
          code: "missing_env",
          message: "SerpApi selected (SEARCH_PROVIDER=serpapi) but SERPAPI_API_KEY is not set.",
        },
      };
    }
    return { ok: true, provider: createSerpApiProvider(key) };
  }

  const apiKey = process.env.GOOGLE_CSE_API_KEY?.trim();
  const cx = process.env.GOOGLE_CSE_CX?.trim();
  if (!apiKey || !cx) {
    return {
      ok: false,
      error: {
        code: "missing_env",
        message:
          "Google Programmable Search requires GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX (or set SEARCH_PROVIDER=serpapi with SERPAPI_API_KEY).",
      },
    };
  }
  return { ok: true, provider: createGoogleCseProvider(apiKey, cx) };
}
