import {
  DEFAULT_FINAL_LIMIT,
  DEFAULT_MAX_RESULTS,
  DEFAULT_TIMEOUT_MS,
  loadProviderConfigsFromEnv,
  resolveEffectiveConfigs,
} from "./config";
import { dedupeAndMergeArticles } from "./dedupe";
import { NEWS_PROVIDER_REGISTRATIONS, getProviderSingleton, type ProviderRegistration } from "./providerRegistry";
import { rankArticles } from "./rank";
import type {
  NewsAggregationResponse,
  NewsQueryParams,
  NormalizedNewsArticle,
  ProviderConfig,
} from "./types";

function stripInternalFields(a: NormalizedNewsArticle): NormalizedNewsArticle {
  const copy = { ...a };
  delete (copy as { _bestProviderPriority?: number })._bestProviderPriority;
  return copy;
}

function tagPriority(article: NormalizedNewsArticle, priority: number): NormalizedNewsArticle {
  return {
    ...article,
    _bestProviderPriority: Math.min(article._bestProviderPriority ?? 999, priority),
  };
}

export type AggregateNewsOptions = {
  registrations?: ProviderRegistration[];
  sortMode?: "relevance" | "recent";
};

export async function aggregateNews(
  params: NewsQueryParams,
  options?: AggregateNewsOptions
): Promise<NewsAggregationResponse> {
  const ticker = params.ticker?.trim().toUpperCase();
  if (!ticker) {
    throw new Error("ticker is required");
  }

  const registrations = options?.registrations ?? NEWS_PROVIDER_REGISTRATIONS;
  const sortMode = options?.sortMode ?? "relevance";
  const envConfigs = loadProviderConfigsFromEnv();
  const configMap = new Map<string, ProviderConfig>(envConfigs);
  for (const reg of registrations) {
    if (!configMap.has(reg.id)) {
      configMap.set(reg.id, {
        id: reg.id,
        enabled: true,
        priority: 50,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxResults: DEFAULT_MAX_RESULTS,
      });
    }
  }
  const effective = resolveEffectiveConfigs(configMap, params.enabledProviders);

  const disabledProviders: string[] = [];
  const providerStats: NewsAggregationResponse["providerStats"] = {};
  const allArticles: NormalizedNewsArticle[] = [];

  type WorkUnit = { reg: ProviderRegistration; cfg: NonNullable<ReturnType<typeof effective.get>>; key: string };
  const work: WorkUnit[] = [];

  for (const reg of registrations) {
    const cfg = effective.get(reg.id);
    if (!cfg) {
      disabledProviders.push(reg.id);
      providerStats[reg.id] = { success: false, count: 0, error: "Disabled by env or request filter" };
      continue;
    }
    const key = reg.getApiKey() ?? "";
    if (!key) {
      disabledProviders.push(reg.id);
      providerStats[reg.id] = { success: false, count: 0, error: "Missing API key" };
      continue;
    }
    work.push({ reg, cfg, key });
  }

  const activeProviders = work.map((w) => w.reg.id);

  const tasks = work.map(({ reg, cfg, key }) => {
    const instance = getProviderSingleton(reg);
    const runtime = { config: cfg, apiKey: key };
    return instance.fetchNews({ ...params, ticker }, runtime).then((result) => ({ reg, result, cfg }));
  });

  const settled = await Promise.allSettled(tasks);

  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]!;
    const w = work[i]!;
    if (s.status === "rejected") {
      const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      providerStats[w.reg.id] = { success: false, count: 0, error: msg };
      continue;
    }
    const { reg, result, cfg } = s.value;
    if (result.success) {
      providerStats[reg.id] = { success: true, count: result.articles.length };
      for (const a of result.articles) {
        allArticles.push(tagPriority(a, cfg.priority));
      }
    } else {
      providerStats[reg.id] = {
        success: false,
        count: 0,
        error: result.error ?? "Unknown provider error",
      };
    }
  }

  const totalBeforeDedupe = allArticles.length;
  const { merged, totalAfter } = dedupeAndMergeArticles(allArticles);
  const ranked = rankArticles(merged, { ...params, ticker }, sortMode);
  const finalCap = Math.min(
    DEFAULT_FINAL_LIMIT,
    params.limit != null && params.limit > 0 ? Math.floor(params.limit) : DEFAULT_FINAL_LIMIT
  );
  const articles = ranked.slice(0, finalCap).map(stripInternalFields);

  return {
    ticker,
    companyName: params.companyName?.trim() || undefined,
    activeProviders,
    disabledProviders,
    providerStats,
    totalBeforeDedupe,
    totalAfterDedupe: totalAfter,
    articles,
  };
}
