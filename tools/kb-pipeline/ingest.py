#!/usr/bin/env python3
"""
Ingest one large text file: clean → chunk → enrich → embed → save JSON + numpy index.

The source file is never modified; a cleaned copy is written under the output directory.
"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from cleaning import clean_document
from chunking import chunk_text, get_encoder
from embeddings import DEFAULT_MODEL, encode_texts, load_model, save_index
from enrich import enrich_chunk


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build retrieval KB from one large file (local, JSON + embeddings).")
    p.add_argument("--input", required=True, help="Path to source text file (UTF-8). Not modified.")
    p.add_argument(
        "--out-dir",
        required=True,
        help="Output directory (created). Contains cleaned/, chunks.json, index/, manifest.json",
    )
    p.add_argument("--min-tokens", type=int, default=800)
    p.add_argument("--max-tokens", type=int, default=1200)
    p.add_argument("--overlap-tokens", type=int, default=100)
    p.add_argument("--embedding-model", default=DEFAULT_MODEL, help="sentence-transformers model id")
    p.add_argument(
        "--copy-source",
        action="store_true",
        help="Also copy the original file into out-dir/source_mirror/ for a self-contained bundle",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    src = Path(args.input).resolve()
    if not src.is_file():
        raise SystemExit(f"Input not found: {src}")

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    cleaned_dir = out_dir / "cleaned"
    cleaned_dir.mkdir(exist_ok=True)

    raw = src.read_text(encoding="utf-8", errors="replace")
    cleaned = clean_document(raw)
    stem = src.stem
    cleaned_path = cleaned_dir / f"{stem}.cleaned.txt"
    cleaned_path.write_text(cleaned, encoding="utf-8")

    if args.copy_source:
        mirror = out_dir / "source_mirror" / src.name
        mirror.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, mirror)

    enc = get_encoder()
    spans = chunk_text(
        cleaned,
        stem,
        enc=enc,
        min_tokens=args.min_tokens,
        max_tokens=args.max_tokens,
        overlap_tokens=args.overlap_tokens,
    )
    if not spans:
        raise SystemExit("No chunks produced (empty file after cleaning?).")

    records: List[Dict[str, Any]] = []
    texts_for_emb: List[str] = []
    for sp in spans:
        meta = enrich_chunk(sp.text)
        rec = {
            "chunk_id": sp.chunk_id,
            "source_file": src.name,
            "char_range": [sp.char_start, sp.char_end],
            "token_count": sp.token_count,
            "summary": meta["summary"],
            "key_entities": meta["key_entities"],
            "numbers_dates": meta["numbers_dates"],
            "tags": meta["tags"],
            "text": sp.text,
        }
        records.append(rec)
        texts_for_emb.append(sp.text)

    chunks_path = out_dir / "chunks.json"
    chunks_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    # Also write one JSON per chunk for easy inspection
    per_dir = out_dir / "chunks_per_file"
    per_dir.mkdir(exist_ok=True)
    for rec in records:
        safe = rec["chunk_id"].replace("/", "_")
        (per_dir / f"{safe}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Loading embedding model {args.embedding_model!r} (first run may download weights)...")
    model = load_model(args.embedding_model)
    emb = encode_texts(model, texts_for_emb)
    chunk_ids = [r["chunk_id"] for r in records]
    save_index(out_dir, emb, chunk_ids)

    manifest = {
        "source_path": str(src),
        "source_file_name": src.name,
        "cleaned_path": f"cleaned/{stem}.cleaned.txt",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "embedding_model": args.embedding_model,
        "params": {
            "min_tokens": args.min_tokens,
            "max_tokens": args.max_tokens,
            "overlap_tokens": args.overlap_tokens,
        },
        "num_chunks": len(records),
        "embedding_dim": int(emb.shape[1]) if len(emb) else 0,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Done. Chunks: {len(records)} → {chunks_path}")
    print(f"Embeddings: {out_dir / 'index' / 'embeddings.npy'} ({emb.shape})")


if __name__ == "__main__":
    main()
