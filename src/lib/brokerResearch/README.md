# Broker research discovery

Builds a **metadata index** of potentially relevant sell-side research links for a ticker using **programmatic web search** (Google Custom Search JSON API or SerpApi). It does **not** fetch report PDFs, bypass paywalls, or scrape Google HTML.

## Purpose

- Surface **who** may have published, **what** the title/snippet suggests, **when**, and **what type** of note it might be.
- Label **likely access** (public vs portal vs subscription).
- Act as a **discovery layer** when you do not have entitlements to every broker portal.

## Architecture

| Piece | Role |
|--------|------|
| `types.ts` | `BrokerDefinition`, `BrokerResearchResult`, API shapes |
| `brokers/registryEntries.ts` | All production broker definitions (domains, aliases, patterns) |
| `brokerRegistry.ts` | Accessors; `assertCatalogMatchesConstants()` guards id sync |
| `constants.ts` | `PRODUCTION_BROKER_IDS` (client-safe) |
| `config.ts` | Env-based enable flags, query/result limits |
| `queryBuilder.ts` | `site:`-scoped queries per broker + ticker/name/aliases/date hints |
| `classifier.ts` | Report-type + access-level heuristics from title/snippet/URL |
| `dedupe.ts` | URL + title/time clustering within the same broker |
| `rank.ts` | Relevance vs recent; demotes generic landing pages |
| `service.ts` | Orchestration: parallel brokers (`Promise.allSettled`), parallel queries per broker |
| `searchProvider/fromEnv.ts` | Delegates to `@/lib/ratings-link-search` (same env as Ratings tab) |

Optional stubs: `searchProvider/base.ts`, `brokers/base.ts`.

## Search providers

Controlled by existing env:

- `SEARCH_PROVIDER=google` → `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_CX`
- `SEARCH_PROVIDER=serpapi` → `SERPAPI_API_KEY`

No additional API keys are required for broker research beyond those.

## Broker registry

Each `BrokerDefinition` includes:

- `id`, `name`, `enabledByDefault`
- `domains` — used for `site:` queries and post-filtering of hits
- `aliases` / `searchPatterns` — optional query enrichment
- `urlHints` — optional classification signals

To **add a broker**:

1. Append to `brokers/registryEntries.ts`.
2. Add its `id` to `PRODUCTION_BROKER_IDS` in `constants.ts`.
3. Add a `BROKER_ID_TO_ENV_SUFFIX` entry in `config.ts` if you want `BROKER_RESEARCH_<SUFFIX>_ENABLED` support.

To **disable globally**: `BROKER_RESEARCH_<SUFFIX>_ENABLED=false` (see `BROKER_ID_TO_ENV_SUFFIX`).

To **narrow a single request**: JSON body `enabledBrokers: ["goldman", "jpmorgan"]` (still respects global disable).

## Query generation

For each active broker, the builder emits multiple queries capped by `BROKER_RESEARCH_MAX_QUERIES_PER_BROKER`, combining:

- `site:{primaryDomain}`
- Ticker and/or quoted company name and optional aliases
- Keyword blocks (research, initiation, upgrade, target price, earnings preview/recap, sector, portal, etc.)
- Optional `after:` / `before:` from request `from` / `to`

Only results whose URL hostname matches one of the broker’s domains (or subdomain) are kept.

## Classification

**Report type** — keyword/regex heuristics over title + snippet + URL (initiation, upgrade/downgrade, previews/recaps, sector/thematic, portal, insight, etc.; default `unknown`).

**Access level** — login/portal/subscription/public/unknown from URL paths and text cues (no live entitlement checks).

## Limitations (important)

- **Not a licensed research feed** — coverage is whatever the search engine returns.
- Many notes exist only behind **client portals** and may appear only as login or generic portal links.
- **False positives/negatives** are expected; rankings and filters are heuristics.
- **Rate limits** apply (Google CSE daily quota, SerpApi plan).
- **No full-text ingestion** and no circumvention of terms of service or paywalls.

## Tests

`npm run test` picks up `src/lib/brokerResearch/**/*.test.ts` (registry, config, queries, classification, dedupe, ranking, service with mock broker + failing broker).

## Mock broker (tests)

`brokers/mockBroker.ts` defines `MOCK_BROKER_DEFINITION` (domains `example.test`). It is **not** part of the production registry; tests inject it via `runBrokerResearch(..., { brokers: [MOCK_BROKER_DEFINITION], searchProvider })`.
