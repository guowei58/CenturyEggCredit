# News aggregation

Provider-based pipeline that pulls normalized articles from multiple news APIs, merges duplicates, ranks results, and exposes them through `POST /api/news`. API keys stay on the server; the browser only talks to your Next route.

## Architecture

- **`types.ts`** — `NewsProvider`, `NormalizedNewsArticle`, query/response shapes.
- **`config.ts`** — Loads per-provider settings from environment (`NEWS_PROVIDER_*`), merges with request-level `enabledProviders` via `resolveEffectiveConfigs`.
- **`providerRegistry.ts`** — Single place production providers are registered (`NEWS_PROVIDER_REGISTRATIONS`). Optional test mock: `MOCK_NEWS_REGISTRATION`.
- **`providers/*.ts`** — Each file implements one API client and maps responses into `NormalizedNewsArticle` only.
- **`aggregator.ts`** — Resolves active providers, runs fetches with `Promise.allSettled`, dedupes, ranks, caps the list.
- **`dedupe.ts` / `rank.ts` / `normalize.ts` / `utils.ts`** — Cross-provider dedupe, scoring, URL/title normalization.
- **`constants.ts`** — `PRODUCTION_NEWS_PROVIDER_IDS` (safe for client components; no env reads).

## Registering a new provider

1. Add `src/lib/news/providers/yourSource.ts` implementing `NewsProvider` (`fetchNews` returns `ProviderFetchResult` with normalized articles only).
2. Append a `ProviderRegistration` to `NEWS_PROVIDER_REGISTRATIONS` in `providerRegistry.ts`.
3. Add the provider id to `PRODUCTION_NEWS_PROVIDER_IDS` in `constants.ts`.
4. Extend `loadProviderConfigsFromEnv` in `config.ts`: include the id in the iteration (or refactor to a shared id list) and map `envKey()` / `getApiKeyEnv()` for your source.
5. Add optional env vars (`YOUR_SOURCE_API_KEY`, `NEWS_PROVIDER_YOUR_SOURCE_ENABLED`, `PRIORITY`, `TIMEOUT_MS`, `MAX_RESULTS`).

Registrations that are **not** present in the env config map receive a default `{ enabled: true, priority: 50, … }` so test-only or plugin providers can run without editing `loadProviderConfigsFromEnv`; production sources should still be listed in config for explicit operator control.

## Enabling and disabling providers

- **Global:** `NEWS_PROVIDER_MARKETAUX_ENABLED`, `NEWS_PROVIDER_ALPHA_VANTAGE_ENABLED`, `NEWS_PROVIDER_FINNHUB_ENABLED` (`true` / `false`).
- **Priority / limits:** `NEWS_PROVIDER_<NAME>_PRIORITY`, `_TIMEOUT_MS`, `_MAX_RESULTS`.
- **Request:** JSON body may include `enabledProviders: ["marketaux","finnhub"]`. Globally disabled providers never run.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `MARKETAUX_API_KEY` | Marketaux token |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage key (`NEWS_SENTIMENT`) |
| `FINNHUB_API_KEY` | Finnhub token |
| `MOCK_NEWS_API_KEY` | Set to `__mock__` only when using `MOCK_NEWS_REGISTRATION` in tests |
| `NEWS_PROVIDER_*` | Per-provider enabled flag, priority, timeout, max results |

See `.env.example` for the full list.

## API request / response

**`POST /api/news`**

```json
{
  "ticker": "IBM",
  "companyName": "International Business Machines",
  "from": "2026-01-01",
  "to": "2026-03-27",
  "limit": 100,
  "enabledProviders": ["marketaux", "finnhub"],
  "sortMode": "relevance"
}
```

Response includes `activeProviders`, `disabledProviders`, `providerStats`, dedupe counts, and `articles` (`NormalizedNewsArticle[]`). Partial provider failures do not fail the whole request.

## Frontend

Components live under `src/components/news/` (`NewsFeed`, `NewsCard`, `NewsFilters`, `ProviderStatus`). Import provider ids from `constants.ts` in client code; do not import `providerRegistry` in the browser bundle.

## Known limitations

- **Rate limits:** Alpha Vantage free tier is strict; Finnhub and Marketaux enforce their own quotas.
- **Overlap:** The same story often appears from multiple vendors; dedupe reduces clutter but heuristics are imperfect.
- **Coverage / latency:** Some tickers return sparse results; timeouts are per-provider (`NEWS_PROVIDER_*_TIMEOUT_MS`).

## Tests

`npm run test` runs `src/lib/news/**/*.test.ts`, including registry, config, normalization, dedupe, ranking, provider JSON mapping (mocked `fetch`), aggregator resilience, and a mock “plugin” registration.
