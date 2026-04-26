"""
Heuristic cleaning for large plain-text / HTML-ish documents.
Does not modify the source file; operates on a string in memory.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import List


def normalize_whitespace(text: str) -> str:
    """Collapse excessive blank lines and trim lines."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_paragraphs(text: str) -> List[str]:
    parts = re.split(r"\n\s*\n", text)
    return [p.strip() for p in parts if p.strip()]


def dedupe_paragraphs(paragraphs: List[str]) -> List[str]:
    """Remove exact duplicate paragraphs while preserving order."""
    seen: set[str] = set()
    out: List[str] = []
    for p in paragraphs:
        key = p.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def drop_repeated_lines(text: str, min_len: int = 40, min_occurrences: int = 6) -> str:
    """
    Lines that appear many times (e.g. page headers/footers) are kept once,
    then stripped from other positions. Simple boilerplate reducer.
    """
    lines = text.split("\n")
    counts = Counter()
    for line in lines:
        s = line.strip()
        if len(s) >= min_len:
            counts[s] += 1
    boiler = {line for line, c in counts.items() if c >= min_occurrences}
    if not boiler:
        return text
    kept_once: set[str] = set()
    out_lines: List[str] = []
    for line in lines:
        s = line.strip()
        if s in boiler:
            if s in kept_once:
                continue
            kept_once.add(s)
        out_lines.append(line)
    return "\n".join(out_lines)


def clean_document(raw: str) -> str:
    """Full cleaning pipeline."""
    t = normalize_whitespace(raw)
    t = drop_repeated_lines(t)
    paras = dedupe_paragraphs(split_paragraphs(t))
    return "\n\n".join(paras)
