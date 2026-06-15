"""Cash flow statement face bounds — truncate supplemental tail rows.

The consolidated statement of cash flows ends at the period **net change in cash**
line (operating + investing + financing [+ FX]). Rows after that (beginning/end
cash rollforwards, supplemental cash paid, non-cash disclosures, etc.) are not
part of the face statement and are excluded from the compiler canonical registry.
"""
from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from workbook_loader import FactRecord

logger = logging.getLogger(__name__)

_CF_NET_CHANGE_CONCEPT_RE = re.compile(
    r"(?:^|:|/)"
    r"(?:CashAndCashEquivalents|CashCashEquivalents(?:RestrictedCashAndRestrictedCashEquivalents)?)"
    r"PeriodIncreaseDecrease"
    r"(?:IncludingExchangeRateEffect)?"
    r"$",
    re.I,
)

_CF_NET_CHANGE_LABEL_RES: list[re.Pattern[str]] = [
    re.compile(
        r"\bnet\s+(?:\(?\s*(?:increase|decrease)\s*\)?\s*)+in\s+cash\b",
        re.I,
    ),
    re.compile(
        r"\b(?:increase|decrease)\s+in\s+cash\b",
        re.I,
    ),
    re.compile(r"^net\s+change\s+in\s+cash\b", re.I),
    re.compile(r"^change\s+in\s+cash\b", re.I),
]

_CF_NET_CHANGE_LABEL_EXCLUDE_RES: list[re.Pattern[str]] = [
    re.compile(r"\boperating\b", re.I),
    re.compile(r"\binvesting\b", re.I),
    re.compile(r"\bfinancing\b", re.I),
    re.compile(r"\bbeginning\s+of\s+(?:the\s+)?period\b", re.I),
    re.compile(r"\bend\s+of\s+(?:the\s+)?period\b", re.I),
    re.compile(r"\bat\s+beginning\b", re.I),
    re.compile(r"\bat\s+end\b", re.I),
]


def _extract_local_name(concept: str) -> str:
    if "://" in concept:
        return concept.rsplit("/", 1)[1]
    if ":" in concept:
        return concept.rsplit(":", 1)[1]
    if "/" in concept:
        return concept.rsplit("/", 1)[1]
    return concept


def is_cf_net_change_in_cash_row(concept: str, label: str) -> bool:
    """True when this row is the period net change in cash (end of face CF)."""
    local = _extract_local_name(concept or "")
    if local and _CF_NET_CHANGE_CONCEPT_RE.search(local):
        return True

    slug = (concept or "").lower()
    if slug.startswith("html:") and "net-increase" in slug and "cash" in slug:
        if not any(x in slug for x in ("operating", "investing", "financing")):
            return True

    text = re.sub(r"\s+", " ", (label or "").strip())
    if not text:
        return False
    if any(p.search(text) for p in _CF_NET_CHANGE_LABEL_EXCLUDE_RES):
        return False
    return any(p.search(text) for p in _CF_NET_CHANGE_LABEL_RES)


def find_cf_face_end_index(
    row_order: list[str],
    concept_to_line: dict[str, str],
) -> int | None:
    """
    Index in ``row_order`` of the last face CF row (net change in cash), inclusive.

    Uses the **first** net-change row. Some 10-Q workbooks repeat the net-change
    line after a supplemental tail (page-break continuation); anchoring on the
    last match would keep dividends, interest paid, etc. in the canonical sheet.
    Returns ``None`` when no net-change anchor is found (sheet left untruncated).
    """
    for i, concept in enumerate(row_order):
        if not concept:
            continue
        label = concept_to_line.get(concept, "")
        if is_cf_net_change_in_cash_row(concept, label):
            return i
    return None


def truncate_cash_flow_sheet(
    row_order: list[str],
    concept_to_line: dict[str, str],
    concept_to_depth: dict[str, int],
    facts: list[FactRecord],
) -> tuple[list[str], dict[str, str], dict[str, int], list[FactRecord], int]:
    """
    Drop supplemental CF rows after the net change in cash line.

    Returns ``(row_order, concept_to_line, concept_to_depth, facts, dropped_row_count)``.
    """
    end_idx = find_cf_face_end_index(row_order, concept_to_line)
    if end_idx is None:
        return row_order, concept_to_line, concept_to_depth, facts, 0

    if end_idx >= len(row_order) - 1:
        return row_order, concept_to_line, concept_to_depth, facts, 0

    kept_order = row_order[: end_idx + 1]
    kept_set = set(kept_order)
    dropped = len(row_order) - len(kept_order)

    new_c2line = {k: v for k, v in concept_to_line.items() if k in kept_set}
    new_c2depth = {k: v for k, v in concept_to_depth.items() if k in kept_set}
    new_facts = [f for f in facts if f.concept in kept_set]

    return kept_order, new_c2line, new_c2depth, new_facts, dropped
