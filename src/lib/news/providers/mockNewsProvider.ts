import { attachNormalizedUrl, makeArticleId } from "../normalize";
import type { NewsProvider, NewsQueryParams, ProviderFetchResult, ProviderRuntimeContext } from "../types";
import { errResult, okResult } from "./base";

/** Set `MOCK_NEWS_API_KEY=__mock__` (this value) in tests to activate. */
export const MOCK_NEWS_API_KEY = "__mock__";

/**
 * Test-only provider: deterministic in-memory articles; no network.
 */
export function createMockNewsProvider(): NewsProvider {
  return {
    id: "mock",
    name: "Mock News (tests)",
    enabledByDefault: false,
    supportsTickerQuery: true,
    supportsCompanyQuery: true,
    async fetchNews(params: NewsQueryParams, runtime: ProviderRuntimeContext): Promise<ProviderFetchResult> {
      if (runtime.apiKey !== MOCK_NEWS_API_KEY) {
        return errResult("mock", "Mock provider not activated for this run");
      }
      const tk = params.ticker.trim().toUpperCase();
      const articles = [
        attachNormalizedUrl({
          id: makeArticleId(`https://mock.test/${tk}/a`, `${tk} announces facility amendment`),
          title: `${tk} announces facility amendment`,
          url: `https://mock.test/${tk}/a`,
          sourceName: "Mock Times",
          publishedAt: new Date().toISOString(),
          summary: "Borrower amends revolving credit agreement.",
          imageUrl: null,
          tickers: [tk],
          companies: params.companyName ? [params.companyName] : [],
          sentimentScore: null,
          sentimentLabel: null,
          providers: ["mock"],
          providerIds: { mock: "mock-a" },
        }),
        attachNormalizedUrl({
          id: makeArticleId(`https://mock.test/${tk}/b`, `Sector wrap: peers and ${tk}`),
          title: `Sector wrap: peers and ${tk}`,
          url: `https://mock.test/${tk}/b`,
          sourceName: "Mock Wire",
          publishedAt: new Date(Date.now() - 86400_000).toISOString(),
          summary: "Industry note mentions ticker.",
          imageUrl: null,
          tickers: [tk],
          companies: [],
          sentimentScore: 0.1,
          sentimentLabel: "neutral",
          providers: ["mock"],
          providerIds: { mock: "mock-b" },
        }),
      ];
      return okResult("mock", articles, 2);
    },
  };
}
