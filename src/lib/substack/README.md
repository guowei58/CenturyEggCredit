## Substack Search (Discovery + Indexing)

Coverage-first discovery and indexing of **public** Substack posts mentioning a ticker/company.

### Design

Two layers:

1. **Discovery layer (SerpApi)**
   - Runs Google queries via SerpApi to find Substack posts and publications.
   - Detects `.substack.com` subdomains and **some** custom-domain Substacks conservatively.
2. **Indexing layer (RSS)**
   - Saves discovered publications into a local registry (`data/substack/db.json`).
   - Ingests each publication’s RSS feed (when available) and stores normalized post metadata.

SerpApi is used for *discovery*, not as the long-term source of truth. RSS ingestion builds the durable local corpus over time.

### Storage

File-backed JSON DB:
- `data/substack/db.json`
  - `publications[]`
  - `posts[]`

### API

- `POST /api/substack/search`
  - DB-first results + optional live discovery; merges, dedupes, ranks.
- `POST /api/substack/discover`
  - Discovery-only; updates the publication registry.
- `POST /api/substack/ingest`
  - RSS-ingest for known publications (bounded).
- `GET /api/substack/publications`
  - Lists registry publications (pagination + optional status filter).

### Env

Requires:
- `SERPAPI_API_KEY` (for discovery)

Optional tuning:
- `SUBSTACK_DISCOVERY_ENABLED=true`
- `SUBSTACK_RSS_INGEST_ENABLED=true`
- `SUBSTACK_MAX_DISCOVERY_RESULTS=50`
- `SUBSTACK_MAX_PUBLICATIONS_PER_RUN=20`
- `SUBSTACK_MAX_POSTS_PER_FEED=100`
- `SUBSTACK_REQUEST_TIMEOUT_MS=12000`

### Limitations (by design)

- SerpApi coverage depends on search engine indexing (not complete).
- Custom-domain Substacks are harder to detect; detection is conservative to avoid false positives.
- RSS improves coverage only after a publication is discovered.
- No paywall bypassing; only public metadata is stored.

### Extending discovery sources

Discovery is abstracted behind a provider interface (`DiscoveryProvider`). SerpApi is the first provider; additional sources can be added without rewriting the indexing layer.

