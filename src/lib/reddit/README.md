# Reddit research (official API)

This module powers the **Research → Reddit** tab: multi-query, sitewide + targeted subreddit search, deduplication, conservative relevance scoring, and file-backed caching.

## What it does

- Accepts **ticker** and/or **company name**, optional **aliases**, optional **subreddit list**, **time range**, and **sort** (Reddit search API).
- Builds many **query variants** (ticker, quoted phrases, company + finance keywords).
- Calls **`oauth.reddit.com`** `search.json` only (no HTML scraping as the primary path).
- Merges hits, **dedupes** by Reddit post id, **ranks** with a precision-leaning score, and assigns **high / medium / low** confidence.
- Persists runs under `data/reddit/db.json` with a configurable **TTL** cache fingerprint.

## What it does not do

- Guarantee completeness of Reddit (API limits, indexing, removed posts).
- Stream or backfill full history.
- Fetch top comments by default (possible future enhancement).

## Authentication

Use a Reddit **script** OAuth application:

1. Create an app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) (type **script**).
2. Set **server-side** env vars (see root `.env.example`):

   - `REDDIT_CLIENT_ID`
   - `REDDIT_CLIENT_SECRET`
   - `REDDIT_USERNAME` — the Reddit account that owns the app
   - `REDDIT_PASSWORD`
   - `REDDIT_USER_AGENT` — unique descriptive string (app name, version, contact)

3. Tokens are obtained with the **password** grant and cached in memory for the server process. A **401** clears the token cache.

**Note:** Reddit may restrict password grants for some new applications or accounts. If OAuth fails, check Reddit’s current API policy and app type.

## Query generation

`queryGenerator.ts` normalizes input, dedupes aliases, detects **ambiguous tickers** (via `isAmbiguousTicker` in `xSearch/utils`), caps variant count (`REDDIT_MAX_QUERY_VARIANTS`), and prepends company-heavy queries when the ticker is ambiguous.

## Scoring and confidence

`scoring.ts` adds points for ticker/company/alias matches (title stronger than body), finance/credit keywords, high-signal subreddits, engagement (score/comments), and multiple matched queries. It penalizes ambiguous tickers without company evidence and light meme patterns.

Buckets:

- **high** — strong title/body signals and score
- **medium** — partial evidence
- **low** — weak or noisy

Posts below an internal threshold are **dropped** before results are returned (precision over recall).

## Subreddit defaults

Defaults are loaded from `REDDIT_DEFAULT_SUBREDDITS` or `config.ts`. The UI can send a custom list; **sitewide-only** or **subreddit-only** modes narrow behavior.

## HTTP API (Next.js)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/reddit/search` | Run search (`forceRefresh` bypasses cache) |
| `GET` | `/api/reddit/search/[id]` | Search metadata + summary |
| `GET` | `/api/reddit/search/[id]/results` | Stored results |
| `POST` | `/api/reddit/search/[id]/rerun` | Same parameters, fresh run (`forceRefresh`) |
| `GET` | `/api/reddit/subreddits` | Default subreddit list |

## Local testing

```bash
npm test
```

Tests live in `reddit.test.ts` (normalization, scoring, dedupe, fingerprint).

For live API runs, set Reddit credentials in `.env.local` and use the Reddit tab or `POST /api/reddit/search` with a JSON body matching `RedditSearchRequest`.
