#!/usr/bin/env python3
"""
Retrieve top chunks for a question using the embedding index built by ingest.py.
Prints a compact context packet (JSON) with summaries + full text for top hits.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

import numpy as np

from embeddings import encode_texts, load_index, load_model, top_k_similar


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Query local KB (embeddings + chunks.json).")
    p.add_argument("--kb-dir", required=True, help="Output directory from ingest.py")
    p.add_argument("--question", required=True, help="Natural language question")
    p.add_argument("--top-k", type=int, default=6, help="Number of chunks to retrieve")
    p.add_argument(
        "--out-json",
        default="",
        help="Optional path to write the context packet JSON (stdout still prints a summary)",
    )
    return p.parse_args()


def build_packet(
    question: str,
    records: List[Dict[str, Any]],
    matrix: np.ndarray,
    model,
    k: int,
) -> Dict[str, Any]:
    qv = encode_texts(model, [question])[0]
    hits = top_k_similar(qv, matrix, k=k)
    items: List[Dict[str, Any]] = []
    for rank, (row_idx, score) in enumerate(hits, start=1):
        rec = records[row_idx]
        items.append(
            {
                "rank": rank,
                "score": round(score, 5),
                "chunk_id": rec["chunk_id"],
                "summary": rec["summary"],
                "key_entities": rec["key_entities"],
                "numbers_dates": rec["numbers_dates"],
                "tags": rec["tags"],
                "text": rec["text"],
            }
        )
    return {
        "question": question,
        "top_k": k,
        "matches": items,
        "context_for_prompt": _format_prompt_block(items),
    }


def _format_prompt_block(items: List[Dict[str, Any]]) -> str:
    """Human-readable block you can paste into an LLM system/user message."""
    parts: List[str] = []
    for it in items:
        parts.append(
            f"### {it['chunk_id']} (score={it['score']})\n"
            f"Summary: {it['summary']}\n"
            f"Entities: {', '.join(it['key_entities'][:8])}\n"
            f"---\n{it['text']}\n"
        )
    return "\n".join(parts)


def main() -> None:
    args = parse_args()
    kb = Path(args.kb_dir).resolve()
    manifest_path = kb / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"Missing manifest.json in {kb}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    model_name = manifest.get("embedding_model", "sentence-transformers/all-MiniLM-L6-v2")

    chunks_path = kb / "chunks.json"
    records = json.loads(chunks_path.read_text(encoding="utf-8"))
    matrix, chunk_ids = load_index(kb)
    if len(records) != matrix.shape[0]:
        raise SystemExit("chunks.json length does not match embedding rows — re-run ingest.")
    if [r["chunk_id"] for r in records] != chunk_ids:
        raise SystemExit("chunk_id order mismatch — re-run ingest.")

    print(f"Loading {model_name!r}...")
    model = load_model(model_name)

    packet = build_packet(args.question, records, matrix, model, args.top_k)
    text = json.dumps(packet, ensure_ascii=False, indent=2)
    print(text)
    if args.out_json:
        Path(args.out_json).write_text(text, encoding="utf-8")
        print(f"\nWrote {args.out_json}", file=__import__("sys").stderr)


if __name__ == "__main__":
    main()
