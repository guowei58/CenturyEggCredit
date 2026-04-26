import { getApiKeyEnv } from "./config";
import { PRODUCTION_NEWS_PROVIDER_IDS } from "./constants";
import { createMajorOutletRssNewsProvider } from "./providers/majorOutletRss";
import { createMockNewsProvider, MOCK_NEWS_API_KEY } from "./providers/mockNewsProvider";
import type { NewsProvider } from "./types";

export type ProviderRegistration = {
  id: string;
  displayName: string;
  getApiKey: () => string | undefined;
  create: () => NewsProvider;
};

const singletons = new Map<string, NewsProvider>();

export function getProviderSingleton(reg: ProviderRegistration): NewsProvider {
  let p = singletons.get(reg.id);
  if (!p) {
    p = reg.create();
    singletons.set(reg.id, p);
  }
  return p;
}

/** Reset table — use in tests only. */
export function __resetProviderSingletonsForTests(): void {
  singletons.clear();
}

/**
 * All production providers. Add a new file in ./providers, implement NewsProvider, append one entry here.
 */
export const NEWS_PROVIDER_REGISTRATIONS: ProviderRegistration[] = [
  {
    id: "major_outlet_rss",
    displayName: "Major outlet RSS",
    getApiKey: () => getApiKeyEnv("major_outlet_rss"),
    create: createMajorOutletRssNewsProvider,
  },
];

/** Optional mock — not wired in production aggregator unless explicitly passed via options.registrations. */
export const MOCK_NEWS_REGISTRATION: ProviderRegistration = {
  id: "mock",
  displayName: "Mock (tests)",
  getApiKey: () => {
    const v = process.env.MOCK_NEWS_API_KEY?.trim();
    return v === MOCK_NEWS_API_KEY ? v : undefined;
  },
  create: createMockNewsProvider,
};

export function getRegisteredProductionProviderIds(): string[] {
  return [...PRODUCTION_NEWS_PROVIDER_IDS];
}
