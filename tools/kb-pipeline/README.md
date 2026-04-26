# Local knowledge-base pipeline (ingest → JSON → embeddings → query)

Turn **one very large text file** into a **retrieval-ready** bundle: cleaned text, chunked records with lightweight metadata, JSON you can inspect, and a **local embedding index** for similarity search.

The **original file is never modified** (read-only). All derived artifacts live under your chosen output directory.

## Requirements

- Python **3.10+** recommended  
- A GPU is optional; `sentence-transformers` runs on CPU.

## Setup

```bash
cd tools/kb-pipeline
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate

pip install -r requirements.txt
```

First run downloads the embedding model weights (~90MB for the default model).

## 1. Ingestion

```bash
python ingest.py --input path/to/large_document.txt --out-dir ./kb_out
```

Optional flags:

| Flag | Default | Meaning |
|------|---------|---------|
| `--min-tokens` | 800 | Soft lower target (window sizing) |
| `--max-tokens` | 1200 | Token window size (`tiktoken` `cl100k_base`) |
| `--overlap-tokens` | 100 | Overlap between consecutive windows |
| `--embedding-model` | `sentence-transformers/all-MiniLM-L6-v2` | Local embedding model |
| `--copy-source` | off | Also copy the original file into `out-dir/source_mirror/` |

### What gets created (`out-dir/`)

| Path | Purpose |
|------|---------|
| `manifest.json` | Run metadata (paths, params, chunk count, embedding model) |
| `cleaned/<stem>.cleaned.txt` | **Cleaned** text (dedupe paragraphs, drop repeated boilerplate lines, whitespace) |
| `chunks.json` | **All chunk records** (array) |
| `chunks_per_file/<chunk_id>.json` | **One JSON per chunk** for easy browsing |
| `index/embeddings.npy` | Float32 matrix `(num_chunks, dim)` — **L2-normalized** rows |
| `index/chunk_ids.json` | Chunk ids in **the same row order** as `embeddings.npy` |

### Chunk JSON schema (each element of `chunks.json`)

```json
{
  "chunk_id": "myfile_00000",
  "source_file": "large_document.txt",
  "char_range": [0, 8420],
  "token_count": 998,
  "summary": "Extractive summary …",
  "key_entities": ["SEC", "Company Name"],
  "numbers_dates": ["2024-03-15", "12.5%"],
  "tags": ["revenue", "covenant", "…"],
  "text": "Original chunk text …"
}
```

Summaries / entities / tags are **heuristic** (regex + simple NLP), not GPT — good for inspection and light retrieval; swap later if you want LLM enrichment.

## 2. Query / retrieval

```bash
python query.py --kb-dir ./kb_out --question "What are the liquidity covenants?" --top-k 6
```

Optional: write the full JSON packet to disk:

```bash
python query.py --kb-dir ./kb_out --question "…" --out-json packet.json
```

The printed JSON includes:

- `matches`: top chunks with **summary**, metadata, **full text**, and similarity **score**
- `context_for_prompt`: a single string you can paste into another LLM as retrieved context

## Design notes

- **Chunking**: sliding **token windows** over the cleaned document (`tiktoken`), not paragraph semantics — predictable size; good baseline before you add smarter splitters.
- **Cleaning**: conservative heuristics only; tune `cleaning.py` for your doc type (HTML, SEC filings, etc.).
- **Embeddings**: cosine similarity = dot product because vectors are normalized.

## Troubleshooting

- **CUDA / torch**: If install fails, follow [PyTorch install instructions](https://pytorch.org/) for your platform, then `pip install sentence-transformers`.
- **Huge files**: Ingestion is single-pass in memory; for multi-GB files, split upstream or extend the script to stream.
