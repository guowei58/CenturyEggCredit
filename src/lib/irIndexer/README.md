## IR Page Indexer

This feature lets users index an Investor Relations (IR) webpage URL, extract visible structure (headings + text blocks), discover and classify links, and enrich results with official SEC filing metadata from `data.sec.gov`.

### Architecture

- **Ingestion / crawl**: `src/lib/irIndexer/crawl/crawler.ts`
  - Uses **Playwright** rendering + DOM extraction.
  - Bounded crawl: `IR_INDEXER_MAX_PAGES` and `IR_INDEXER_MAX_DEPTH`.
  - Same-domain restriction optional.
- **Render + extract**: `src/lib/irIndexer/extract/renderAndExtract.ts`
  - Captures page title, meta description, headings, visible text blocks, links, iframe src, and some button “data-href” links.
- **Link classification**: `src/lib/irIndexer/classify/linkClassifier.ts`
  - Rule-based, easy to extend (extension, hostname, path/text heuristics).
- **SEC enrichment**: `src/lib/irIndexer/sec/secEnricher.ts`
  - Uses existing `src/lib/sec-edgar.ts` (required User-Agent, free endpoints).
  - Additive: merges in filings not already present from the IR crawl.
- **Storage**: `src/lib/irIndexer/store/fileDb.ts`
  - File-backed JSON “local DB” per ticker under `data/saved-tickers/{TICKER}/IR Indexer/db.json`.
  - Stores sources, pages, sections, assets, jobs.
- **API**:
  - `POST /api/ir/index`
  - `GET /api/ir/source/:id?ticker=...`
  - `GET /api/ir/source/:id/sections?ticker=...`
  - `GET /api/ir/source/:id/assets?ticker=...&type=pdf|sec_filing|...`
  - `POST /api/ir/source/:id/reindex`
- **UI**: `src/components/irIndexer/IrPageIndexer.tsx` (mounted in Overview tab)

### Configuration (env)

- `IR_INDEXER_MAX_PAGES` (default 12)
- `IR_INDEXER_MAX_DEPTH` (default 2)
- `IR_INDEXER_TIMEOUT_MS` (default 25000)
- `IR_INDEXER_USE_PLAYWRIGHT` (default true)
- `IR_INDEXER_SEC_ENRICH` (default true)
- `IR_INDEXER_SAME_DOMAIN_ONLY` (default true)

### Limitations (current)

- Extraction is intentionally conservative; tabs/accordions are only expanded best-effort.
- Section building is based on headings (`h1`–`h4`) and document order; imperfect pages may collapse into the root section.
- Crawl uses “IR-ish” path heuristics and is bounded; it does not attempt exhaustive site crawling.
- Job execution is currently kicked off from the index request (good for local/dev); a future improvement is a real background worker/queue.

