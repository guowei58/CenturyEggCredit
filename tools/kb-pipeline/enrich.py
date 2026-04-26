"""
Lightweight metadata extraction without calling cloud LLMs.
Summaries = extractive; entities/numbers/tags = heuristics + regex.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Dict, List

# Common English stopwords (small list for tag extraction)
_STOP = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "as",
    "by",
    "with",
    "from",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "not",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "we",
    "our",
    "they",
    "their",
    "than",
    "then",
}


def extractive_summary(text: str, max_chars: int = 280) -> str:
    """First 1–2 sentences or trimmed paragraph."""
    t = " ".join(text.split())
    for sep in (". ", "? ", "! "):
        if sep in t[:800]:
            parts = re.split(r"(?<=[.!?])\s+", t)
            one = parts[0].strip()
            if len(one) <= max_chars:
                return one + ("." if not one.endswith((".", "?", "!")) else "")
    return (t[: max_chars - 3] + "...") if len(t) > max_chars else t


_DATE_PATTERNS = [
    r"\b\d{4}-\d{2}-\d{2}\b",
    r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b",
    r"\bQ[1-4]\s*['']?\d{2,4}\b",
    r"\bFY\s*['']?\d{2,4}\b",
    r"\b\d{1,2}/\d{1,2}/\d{2,4}\b",
]

_NUM_PATTERNS = [
    r"\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b",  # 1,234,567
    r"\$\s*\d+(?:\.\d+)?(?:\s*(?:million|billion|M|B))?\b",
    r"\b\d+(?:\.\d+)?\s*%\b",
]


def extract_numbers_and_dates(text: str, limit: int = 24) -> List[str]:
    found: List[str] = []
    seen = set()
    for pattern in _DATE_PATTERNS + _NUM_PATTERNS:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            s = m.group(0).strip()
            if s not in seen:
                seen.add(s)
                found.append(s)
            if len(found) >= limit:
                return found
    return found


def extract_entities(text: str, limit: int = 16) -> List[str]:
    """
    Cheap 'entity' candidates: repeated Title Case phrases and ALLCAPS tokens (2–5 chars excluded).
    """
    candidates: List[str] = []
    for m in re.finditer(r"\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4})\b", text):
        w = m.group(0).strip()
        if len(w) > 2 and w.lower() not in _STOP:
            candidates.append(w)
    for m in re.finditer(r"\b[A-Z]{2,12}\b", text):
        candidates.append(m.group(0))
    # dedupe preserve order
    seen = set()
    out: List[str] = []
    for c in candidates:
        k = c.casefold()
        if k in seen:
            continue
        seen.add(k)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def extract_tags(text: str, limit: int = 12) -> List[str]:
    words = [w for w in re.findall(r"[A-Za-z]{4,}", text.lower()) if w not in _STOP]
    ctr = Counter(words)
    return [w for w, _ in ctr.most_common(limit)]


def enrich_chunk(text: str) -> Dict[str, Any]:
    return {
        "summary": extractive_summary(text),
        "key_entities": extract_entities(text),
        "numbers_dates": extract_numbers_and_dates(text),
        "tags": extract_tags(text),
    }
