"""Raw line-item universe vs concept map (completeness diagnostics).

``coverage_pass.collect_all_raw_xbrl_line_items`` already defines the full set of
``(statement_type, concept)`` keys present in saved workbooks.  This module
exposes a cheap **gap check** for the compiler summary JSON so CI or manual
review can flag regressions.
"""
from __future__ import annotations

from coverage_pass import collect_all_raw_xbrl_line_items, _concept_lookup
from master_presentation_builder import ConceptMapping
from workbook_loader import WorkbookInfo


def universe_keys_not_in_concept_map(
    workbooks: list[WorkbookInfo],
    concept_map: list[ConceptMapping],
) -> list[dict]:
    """
    Returns a sorted list of ``{"statement_type", "concept"}`` for every raw
    workbook line key that has **no** ``(statement_type, raw_concept)`` entry
    in *concept_map*.

    After ``reconcile_final_statements_with_raw_xbrl`` this should normally be
    empty; non-empty output indicates a wiring bug or a skipped reconcile.
    """
    raw = collect_all_raw_xbrl_line_items(workbooks)
    cmap_keys = set(_concept_lookup(concept_map).keys())
    out: list[dict] = []
    for st, c in sorted(raw):
        if (st, c) not in cmap_keys:
            out.append({"statement_type": st, "concept": c})
    return out
