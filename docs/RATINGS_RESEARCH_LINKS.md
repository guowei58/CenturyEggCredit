# Ratings / Research Links

## What it does

The **Research → Ratings Research Links** tab resolves your ticker (and optional company name) and runs **site-restricted web searches** against:

- `fitchratings.com`
- `moodys.com`
- `spglobal.com`

Only hits on those official domains are kept. The UI shows **titles, URLs, and search snippets** only — not full articles, no scraping of paywalled pages, and no claim that you have agency entitlements.

## Configuration

Set one of the supported search backends via `SEARCH_PROVIDER`:

| `SEARCH_PROVIDER` | Required variables |
|-------------------|--------------------|
| `google` (default) | `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_CX` |
| `serpapi` | `SERPAPI_API_KEY` |

Copy `.env.example` into `.env.local` and restart `next dev` / your deployment after changes.

### Google Programmable Search Engine

Create a **Programmable Search Engine** that searches the **entire web** (or at least does not block the agency domains), obtain the **CX** ID, and enable the **Custom Search JSON API** on your Google Cloud project for the API key.

### SerpApi

Use a SerpApi key with the Google engine. Results are filtered to agency domains in application code.

## Limitations

- **Not** a substitute for licensed feeds from Fitch, Moody’s, or S&P.
- Ranking, classification (`issuer_rating`, `issue_rating`, etc.), and “match scores” are **heuristics** — verify on the agency site.
- Many links require **login**, **subscription**, or **institutional** access; the app only opens the official URL.
- **Quota and cost** belong to your Google CSE / SerpApi account; the feature issues many queries per search.
- Snippet text comes from the **search provider**, not from OREO.

## Implementation map

- `src/lib/ratings-link-search/` — query build, domain filter, classify, rank, dedupe, providers, orchestration.
- `src/app/api/ratings-links/route.ts` — POST JSON `{ ticker, companyName?, aliases? }`.
- `src/components/company/RatingsResearchLinks.tsx` — tab UI.

## Tests

```bash
npm run test
```

Covers query construction, domain filtering, classification, deduplication, and ranking. Example rows for Hertz / Lumen / AMC live in `__fixtures__/mockSearchExamples.ts`.
