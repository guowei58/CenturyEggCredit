import { createSerperProvider } from "./serperProvider";
import type { RatingsSearchProvider } from "./types";

export type ProviderConfigError = { code: "missing_env"; message: string };

export function getSearchProviderFromEnv():
  | { ok: true; provider: RatingsSearchProvider }
  | { ok: false; error: ProviderConfigError } {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) {
    return {
      ok: false,
      error: {
        code: "missing_env",
        message:
          "Web search uses Serper (https://serper.dev). Set SERPER_API_KEY in .env.local for Ratings links, Broker Research, Research Finder, and Substack discovery.",
      },
    };
  }
  return { ok: true, provider: createSerperProvider(key) };
}
