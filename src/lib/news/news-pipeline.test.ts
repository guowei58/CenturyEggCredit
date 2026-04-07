import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aggregateNews } from "./aggregator";
import { PRODUCTION_NEWS_PROVIDER_IDS } from "./constants";
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_TIMEOUT_MS,
  loadProviderConfigsFromEnv,
  resolveEffectiveConfigs,
} from "./config";
import { articlesAreDuplicates, dedupeAndMergeArticles } from "./dedupe";
import { attachNormalizedUrl, makeArticleId } from "./normalize";
import {
  __resetProviderSingletonsForTests,
  getProviderSingleton,
  MOCK_NEWS_REGISTRATION,
  NEWS_PROVIDER_REGISTRATIONS,
  type ProviderRegistration,
} from "./providerRegistry";
import { createAlphaVantageNewsProvider } from "./providers/alphaVantage";
import { createFinnhubNewsProvider } from "./providers/finnhub";
import { createMarketauxNewsProvider } from "./providers/marketaux";
import { buildNewsApiKeywordQuery } from "./providers/newsapi";
import { hostnameMatchesNewsApiAllowlist } from "./newsApiDomains";
import { MOCK_NEWS_API_KEY } from "./providers/mockNewsProvider";
import { rankArticles } from "./rank";
import type { NormalizedNewsArticle, ProviderConfig } from "./types";
import {
  normalizeTitleForMatch,
  normalizeUrlForMatch,
  titleSimilarity,
} from "./utils";

function articleBase(
  overrides: Partial<NormalizedNewsArticle> & Pick<NormalizedNewsArticle, "title" | "url">
): NormalizedNewsArticle {
  return {
    id: makeArticleId(overrides.url, overrides.title),
    sourceName: "Src",
    publishedAt: "2026-01-15T12:00:00.000Z",
    summary: null,
    imageUrl: null,
    tickers: [],
    companies: [],
    sentimentScore: null,
    sentimentLabel: null,
    providers: ["test"],
    ...overrides,
  };
}

describe("provider registry", () => {
  it("registers the same provider id set as production constants", () => {
    const regIds = new Set(NEWS_PROVIDER_REGISTRATIONS.map((r) => r.id));
    const constIds = new Set(PRODUCTION_NEWS_PROVIDER_IDS);
    expect(regIds).toEqual(constIds);
  });

  it("returns the same singleton for a registration", () => {
    __resetProviderSingletonsForTests();
    const reg = NEWS_PROVIDER_REGISTRATIONS[0]!;
    const a = getProviderSingleton(reg);
    const b = getProviderSingleton(reg);
    expect(a).toBe(b);
    __resetProviderSingletonsForTests();
  });
});

describe("NewsAPI helpers", () => {
  it("buildNewsApiKeywordQuery OR-joins company name and aliases", () => {
    expect(
      buildNewsApiKeywordQuery({
        ticker: "LUMN",
        companyName: "Lumen Technologies",
        aliases: ["CenturyLink"],
      })
    ).toBe('"Lumen Technologies" OR CenturyLink');
  });

  it("buildNewsApiKeywordQuery falls back to ticker when no name or aliases", () => {
    expect(buildNewsApiKeywordQuery({ ticker: "IBM" })).toBe("IBM");
  });

  it("hostnameMatchesNewsApiAllowlist accepts allowlisted hosts and subdomains", () => {
    expect(hostnameMatchesNewsApiAllowlist("www.reuters.com")).toBe(true);
    expect(hostnameMatchesNewsApiAllowlist("reuters.com")).toBe(true);
    expect(hostnameMatchesNewsApiAllowlist("news.bloomberg.com")).toBe(true);
    expect(hostnameMatchesNewsApiAllowlist("example.com")).toBe(false);
  });
});

describe("config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("marks a provider disabled when NEWS_PROVIDER_*_ENABLED is false", () => {
    vi.stubEnv("NEWS_PROVIDER_MARKETAUX_ENABLED", "false");
    const m = loadProviderConfigsFromEnv();
    expect(m.get("marketaux")?.enabled).toBe(false);
    expect(m.get("alpha_vantage")?.enabled).not.toBe(false);
  });

  it("applies request-level allowlist on top of globally enabled providers", () => {
    const m = new Map<string, ProviderConfig>();
    for (const id of PRODUCTION_NEWS_PROVIDER_IDS) {
      m.set(id, {
        id,
        enabled: true,
        priority: 1,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxResults: DEFAULT_MAX_RESULTS,
      });
    }
    const eff = resolveEffectiveConfigs(m, ["finnhub"]);
    expect([...eff.keys()].sort()).toEqual(["finnhub"]);
  });

  it("does not re-enable a globally disabled provider via request override", () => {
    const m = new Map<string, ProviderConfig>();
    m.set("marketaux", {
      id: "marketaux",
      enabled: false,
      priority: 1,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxResults: DEFAULT_MAX_RESULTS,
    });
    const eff = resolveEffectiveConfigs(m, ["marketaux"]);
    expect(eff.has("marketaux")).toBe(false);
  });
});

describe("url and title normalization", () => {
  it("strips tracking params from URLs for matching", () => {
    const a = normalizeUrlForMatch("https://Example.COM/path/?utm_source=x&foo=1");
    const b = normalizeUrlForMatch("https://example.com/path/?foo=1");
    expect(a).toBe(b);
  });

  it("normalizes titles for fuzzy comparison", () => {
    const a = normalizeTitleForMatch("M&A — BIG news!!");
    expect(a).toContain("m a");
    expect(titleSimilarity("Acme beats Q4 views", "Acme Beats Q4 Views")).toBeGreaterThan(0.85);
  });
});

describe("deduplication and merge", () => {
  it("detects duplicates by normalized URL / identical raw URL", () => {
    const rep = attachNormalizedUrl(
      articleBase({
        title: "Deal announced",
        url: "https://news.example.com/a?gclid=1",
        providers: ["p1"],
      })
    );
    const cand = attachNormalizedUrl(
      articleBase({
        title: "Different title but same normalized url",
        url: "https://news.example.com/a",
        providers: ["p2"],
      })
    );
    expect(articlesAreDuplicates(rep, cand)).toBe(true);
  });

  it("merges duplicate clusters and unions providers", () => {
    const t = "Same headline for merge";
    const iso = "2026-02-01T12:00:00.000Z";
    const a = attachNormalizedUrl(
      articleBase({
        title: t,
        url: "https://x.com/1",
        publishedAt: iso,
        providers: ["marketaux"],
        tickers: ["IBM"],
        summary: "short",
        providerIds: { marketaux: "m1" },
      })
    );
    const b = attachNormalizedUrl(
      articleBase({
        title: t,
        url: "http://x.com/1",
        publishedAt: iso,
        providers: ["finnhub"],
        tickers: ["IBM", "MSFT"],
        summary: "longer summary text for merge test",
        imageUrl: "https://img.example/i.png",
        providerIds: { finnhub: "f9" },
      })
    );
    const { merged } = dedupeAndMergeArticles([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.providers.sort()).toEqual(["finnhub", "marketaux"]);
    expect(merged[0]!.tickers.sort()).toEqual(["IBM", "MSFT"]);
    expect((merged[0]!.summary ?? "").length).toBeGreaterThan(10);
    expect(merged[0]!.imageUrl).toBe("https://img.example/i.png");
    expect(merged[0]!.providerIds).toMatchObject({ marketaux: "m1", finnhub: "f9" });
  });
});

describe("ranking", () => {
  it("orders by ticker relevance in relevance mode", () => {
    const withTicker = attachNormalizedUrl(
      articleBase({
        title: "Other story",
        url: "https://a.com/1",
        tickers: ["IBM"],
        publishedAt: "2026-01-01T00:00:00.000Z",
        providers: ["a"],
      })
    );
    const without = attachNormalizedUrl(
      articleBase({
        title: "IBM buried in later date",
        url: "https://a.com/2",
        tickers: [],
        publishedAt: "2026-03-01T00:00:00.000Z",
        providers: ["b"],
      })
    );
    const ranked = rankArticles([without, withTicker], { ticker: "IBM" }, "relevance");
    expect(ranked[0]!.tickers).toContain("IBM");
  });

  it("orders by published time in recent mode", () => {
    const older = attachNormalizedUrl(
      articleBase({
        title: "Old",
        url: "https://a.com/o",
        publishedAt: "2026-01-01T00:00:00.000Z",
        providers: ["a"],
      })
    );
    const newer = attachNormalizedUrl(
      articleBase({
        title: "New",
        url: "https://a.com/n",
        publishedAt: "2026-02-01T00:00:00.000Z",
        providers: ["b"],
      })
    );
    const ranked = rankArticles([older, newer], { ticker: "IBM" }, "recent");
    expect(ranked[0]!.title).toBe("New");
  });
});

describe("provider normalization (API → NormalizedNewsArticle)", () => {
  const runtime: import("./types").ProviderRuntimeContext = {
    config: {
      id: "p",
      enabled: true,
      priority: 1,
      timeoutMs: 10_000,
      maxResults: 50,
    },
    apiKey: "test-key",
  };

  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps Alpha Vantage NEWS_SENTIMENT feed items", async () => {
    const payload = {
      feed: [
        {
          title: "IBM outlook",
          url: "https://av.test/a",
          time_published: "20260301T100000",
          summary: "Summary line",
          source: "AV src",
          overall_sentiment_score: "0.2",
          overall_sentiment_label: "Somewhat-Bullish",
          ticker_sentiment: [
            { ticker: "IBM", ticker_sentiment_score: "0.35", ticker_sentiment_label: "Bullish" },
          ],
        },
      ],
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    } as Response);

    const p = createAlphaVantageNewsProvider();
    const res = await p.fetchNews({ ticker: "IBM" }, runtime);
    expect(res.success).toBe(true);
    expect(res.articles).toHaveLength(1);
    expect(res.articles[0]!.title).toBe("IBM outlook");
    expect(res.articles[0]!.tickers).toContain("IBM");
    expect(res.articles[0]!.sentimentLabel).toBeTruthy();
  });

  it("maps Finnhub company-news items", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          headline: "Headline",
          url: "https://fh.test/x",
          datetime: Math.floor(new Date("2026-02-10T15:00:00Z").getTime() / 1000),
          source: "FH",
          summary: "Sum",
          image: "",
          id: 42,
        },
      ],
    } as Response);

    const p = createFinnhubNewsProvider();
    const res = await p.fetchNews(
      { ticker: "IBM", from: "2026-01-01", to: "2026-03-01" },
      { ...runtime, config: { ...runtime.config, id: "finnhub" } }
    );
    expect(res.success).toBe(true);
    expect(res.articles[0]!.providers).toEqual(["finnhub"]);
    expect(res.articles[0]!.publishedAt).toBeTruthy();
  });

  it("maps Marketaux rows", async () => {
    const mxBody = JSON.stringify({
      data: [
        {
          uuid: "u1",
          title: "Mx story",
          url: "https://mx.test/z",
          published_at: "2026-02-01T12:00:00Z",
          source: "MX",
          description: "Desc",
          entities: [{ symbol: "IBM", name: "Intl", sentiment_score: 0.2 }],
        },
      ],
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => mxBody,
    } as Response);

    const p = createMarketauxNewsProvider();
    const res = await p.fetchNews({ ticker: "IBM" }, { ...runtime, config: { ...runtime.config, id: "marketaux" } });
    expect(res.success).toBe(true);
    expect(res.articles[0]!.providerIds?.marketaux).toBe("u1");
    expect(res.articles[0]!.companies.length).toBeGreaterThan(0);
  });
});

describe("aggregator resilience and extensibility", () => {
  beforeEach(() => {
    __resetProviderSingletonsForTests();
    vi.stubEnv("MOCK_NEWS_API_KEY", MOCK_NEWS_API_KEY);
  });

  afterEach(() => {
    __resetProviderSingletonsForTests();
    vi.unstubAllEnvs();
  });

  it("runs mock provider when registered and returns normalized articles", async () => {
    const out = await aggregateNews(
      { ticker: "ibm", companyName: "IBM Corp", limit: 50 },
      { registrations: [MOCK_NEWS_REGISTRATION] }
    );
    expect(out.activeProviders).toContain("mock");
    expect(out.articles.length).toBeGreaterThan(0);
    expect(out.articles.every((a) => a.providers.includes("mock"))).toBe(true);
  });

  it("continues when one provider fails", async () => {
    const failReg: ProviderRegistration = {
      id: "always_fails",
      displayName: "Fail",
      getApiKey: () => "k",
      create: () => ({
        id: "always_fails",
        name: "Fail",
        enabledByDefault: true,
        supportsTickerQuery: true,
        supportsCompanyQuery: false,
        async fetchNews() {
          return {
            providerId: "always_fails",
            success: false,
            articles: [],
            error: "injected failure",
          };
        },
      }),
    };

    const out = await aggregateNews(
      { ticker: "IBM", limit: 50 },
      { registrations: [MOCK_NEWS_REGISTRATION, failReg] }
    );
    expect(out.providerStats.always_fails?.success).toBe(false);
    expect(out.providerStats.mock?.success).toBe(true);
    expect(out.articles.length).toBeGreaterThan(0);
  });

  it("supports an extra provider only registered in one place (extensibility)", async () => {
    const extra: ProviderRegistration = {
      id: "plugin_x",
      displayName: "Plugin X",
      getApiKey: () => "key",
      create: () => ({
        id: "plugin_x",
        name: "Plugin X",
        enabledByDefault: true,
        supportsTickerQuery: true,
        supportsCompanyQuery: false,
        async fetchNews() {
          return {
            providerId: "plugin_x",
            success: true,
            articles: [
              attachNormalizedUrl({
                id: makeArticleId("https://plugin.test/1", "Extra story"),
                title: "Extra story",
                url: "https://plugin.test/1",
                sourceName: "Plugin",
                publishedAt: new Date().toISOString(),
                summary: null,
                imageUrl: null,
                tickers: ["IBM"],
                companies: [],
                sentimentScore: null,
                sentimentLabel: null,
                providers: ["plugin_x"],
                providerIds: { plugin_x: "1" },
              }),
            ],
            rawCount: 1,
          };
        },
      }),
    };

    const out = await aggregateNews({ ticker: "IBM", limit: 50 }, { registrations: [MOCK_NEWS_REGISTRATION, extra] });
    expect(out.activeProviders).toEqual(expect.arrayContaining(["mock", "plugin_x"]));
    expect(out.articles.some((a) => a.providers.includes("plugin_x"))).toBe(true);
  });

  it("skips disabled providers from env without throwing", async () => {
    __resetProviderSingletonsForTests();
    vi.stubEnv("NEWS_PROVIDER_MARKETAUX_ENABLED", "false");
    vi.stubEnv("MARKETAUX_API_KEY", "x");
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "x");
    vi.stubEnv("FINNHUB_API_KEY", "x");
    vi.stubEnv("NEWSAPI_KEY", "x");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [] as unknown,
      })) as typeof fetch
    );
    const out = await aggregateNews({ ticker: "IBM" });
    expect(out.disabledProviders).toContain("marketaux");
    expect(out.activeProviders.sort()).toEqual(["alpha_vantage", "finnhub", "newsapi"]);
    vi.unstubAllGlobals();
    __resetProviderSingletonsForTests();
  });
});
