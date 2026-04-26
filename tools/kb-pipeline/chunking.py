"""
Token-window chunking (tiktoken cl100k_base): ~800–1200 tokens per window with overlap.
Maps each window back to approximate character ranges in the cleaned file via substring search.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import tiktoken


@dataclass
class ChunkSpan:
    chunk_id: str
    char_start: int
    char_end: int
    text: str
    token_count: int


def get_encoder(model_name: str = "cl100k_base"):
    return tiktoken.get_encoding(model_name)


def count_tokens(enc, text: str) -> int:
    return len(enc.encode(text))


def chunk_text(
    cleaned_text: str,
    source_stem: str,
    *,
    enc,
    min_tokens: int = 800,
    max_tokens: int = 1200,
    overlap_tokens: int = 100,
) -> List[ChunkSpan]:
    """
    Slide a window of size `max_tokens` (capped by min_tokens for the last piece only if tiny)
    with step `max_tokens - overlap_tokens`.
    """
    ids = enc.encode(cleaned_text)
    if not ids:
        return []

    target = min(max(max_tokens, min_tokens), len(ids))
    step = max(1, target - overlap_tokens)
    chunks: List[ChunkSpan] = []
    scan = 0
    i = 0
    win_idx = 0

    while i < len(ids):
        end = min(i + target, len(ids))
        piece_ids = ids[i:end]
        text = enc.decode(piece_ids)
        tc = len(piece_ids)

        anchor = text[: min(120, len(text))].strip() or text[:20]
        char_start = cleaned_text.find(anchor, scan)
        if char_start < 0:
            char_start = scan
        char_end = min(len(cleaned_text), char_start + max(len(text), 1))

        chunks.append(
            ChunkSpan(
                chunk_id=f"{source_stem}_{win_idx:05d}",
                char_start=char_start,
                char_end=char_end,
                text=text,
                token_count=tc,
            )
        )
        win_idx += 1
        scan = max(scan, char_start + max(1, (char_end - char_start) // 3))
        if end >= len(ids):
            break
        i += step

    return chunks
