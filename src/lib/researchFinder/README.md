## The Cap Stack Rumor Mill (Research Finder)

Best-effort discovery of **publicly accessible** pages and metadata across:
- Octus (`octus.com`)
- CreditSights (`creditsights.com`, `know.creditsights.com`)
- 9fin (`9fin.com`, `public-content.9fin.com`)
- Debtwire (`debtwire.com`, `info.debtwire.com`, `ionanalytics.com`)
- WSJ Pro Bankruptcy (best-effort metadata only; often gated)

### What it does
- Builds provider-scoped search queries (site-restricted) from ticker, company name, and aliases.
- Uses the app’s existing web-search provider wiring (Google CSE JSON API or SerpApi).
- **Also** runs the same queries against **Google News RSS** (no API key), resolves publisher URLs when possible, and **merges** with search hits (deduped by URL) so coverage overlaps less with organic search alone.
- Visits candidate URLs and extracts **public** page metadata only (title, canonical, meta description, h1, date hints).
- Scores, confidence-buckets, deduplicates, and returns results with provenance.
- Stores searches/results to `data/research-finder/db.json` for debugging and reuse.

### What it does NOT do
- No paywall bypassing or login automation.
- No scraping of hidden/gated body content.
- No claims of completeness.

### Disclaimer (shown in UI)
“Best-effort public research discovery only. Results may be incomplete and do not represent the full research library of any provider. Some sources, including WSJ Pro Bankruptcy, may be partially or largely subscription-gated.”

### Configuration (env)
- `RESEARCH_FINDER_MAX_QUERIES_PER_PROVIDER`
- `RESEARCH_FINDER_MAX_CANDIDATES_PER_PROVIDER`
- `RESEARCH_FINDER_MAX_EXTRACTED_PER_PROVIDER`
- `RESEARCH_FINDER_TIMEOUT_MS`
- `RESEARCH_FINDER_CACHE_TTL_MS`
- `RESEARCH_FINDER_RSS_ENABLED` (default `true`) — Google News RSS complement
- `RESEARCH_FINDER_RSS_MAX_ITEMS_PER_QUERY`
- `RESEARCH_FINDER_RSS_WHEN` (e.g. `90d` — passed as Google News `when:`)
- `RESEARCH_FINDER_RSS_RESOLVE_TIMEOUT_MS` — HTTP follow for `news.google` redirect resolution

### Search provider config
Uses the existing environment variables:
- `SEARCH_PROVIDER=google|serpapi`
- `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_CX`
- `SERPAPI_API_KEY`

