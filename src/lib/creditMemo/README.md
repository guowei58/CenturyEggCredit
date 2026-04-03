# AI Credit Memo (local research folder)

End-to-end pipeline: **resolve ticker folder** → **ingest & chunk** → **word-budget outline** → **LLM memo** with **source-grounded** rules.

## Configuration (server-only)

| Variable | Purpose |
|----------|---------|
| `RESEARCH_ROOT_DIR` | Absolute path to the parent directory containing per-ticker folders (e.g. `C:\Research\tickers`). If unset, only `data/saved-tickers/{TICKER}/` is used as a candidate. |
| `CREDIT_MEMO_MAX_CONTEXT_CHARS` | Cap on evidence sent to the LLM (~280k default) |
| `CREDIT_MEMO_MAX_OUTPUT_TOKENS` | LLM completion cap |
| `CREDIT_MEMO_MAX_FILES` | Max files per ingest |
| `CREDIT_MEMO_MAX_FILE_BYTES` | Skip/exceed files larger than this |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Required for memo generation |
| `ANTHROPIC_CREDIT_MEMO_MODEL` / `OPENAI_CREDIT_MEMO_MODEL` | Optional overrides |

## Folder resolution

1. If `RESEARCH_ROOT_DIR` is set: list **immediate subdirectories**, score names against the ticker (exact, prefix `HTZ - …`, normalized contains, etc.).
2. Always consider **`data/saved-tickers/{TICKER}`** as an extra candidate (score 88 if research root exists, else 100).
3. Dedupe by absolute path. Ambiguous close scores return `ok: false` with a **candidate list** for the UI.

Paths accepted for ingest must lie under `RESEARCH_ROOT_DIR` **or** under the app’s saved-ticker directory for that ticker (`pathGuard.ts`).

## Ingestion & parsing

- Recursively walks the chosen folder (hidden dirs skipped).
- Text extraction reuses **`ticker-file-text-extract`** (PDF, Office, CSV, etc.) — same limits as AI Chat / OREO.
- Files are **classified** heuristically from path/name (`fileClassifier.ts`).
- Long extracts are **chunked** (~12k chars, paragraph boundaries) with chunk index for traceability.
- Spreadsheet files also get a **table preview** row (text extract slice) for the UI.

## Memo planning

`memoPlanner.ts` maps target pages → total word budget, then weights **13 sections** (executive summary through appendix). Weights adjust slightly when many debt docs, models, or filings are present.

## Generation

- **System prompt**: `src/data/credit-memo-llm-prompt.ts` — no fabrication, cite paths, flag gaps/conflicts.
- **User prompt**: outline + file inventory + capped **source pack** with `<<<BEGIN SOURCE: path>>>…<<<END SOURCE>>>`.
- Output: Markdown; jobs persisted under `data/credit-memo/state.json`.

## API

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/credit-memo/resolve` | `{ "ticker": "HTZ" }` |
| POST | `/api/credit-memo/project` | `{ "ticker", "folderPath", "resolutionMeta?" }` — runs full ingest |
| GET | `/api/credit-memo/project/[id]` | Load persisted project |
| POST | `/api/credit-memo/project/[id]/memo` | `{ targetWords, memoTitle?, provider? }` (legacy: `targetPages` × 500) |
| GET | `/api/credit-memo/memo/[jobId]` | Fetch saved job |
| GET | `/api/credit-memo/memo/[jobId]/export?format=md` or `html` | Download |

## Limitations

- **No OCR** beyond what `pdf-parse` / parsers already provide; scanned PDFs may be thin.
- **Spreadsheet structure** is flattened to text in the LLM pack; cell-level citations depend on extract quality.
- **Facts** are only as good as folder contents; the model may still err — review the memo.
- **DOCX export** is not implemented (Markdown + HTML download).

## Tests

`npm test` — includes `src/lib/creditMemo/**/*.test.ts`.
