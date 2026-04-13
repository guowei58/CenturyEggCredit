"""Map raw facts to canonical row IDs using the concept-to-row map."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from period_parser import Period
from workbook_loader import WorkbookInfo, FactRecord
from master_presentation_builder import MasterRow, ConceptMapping

logger = logging.getLogger(__name__)


@dataclass
class MappedFact:
    """A fact that has been resolved to a canonical row."""
    statement_type: str
    canonical_row_id: str
    display_label: str
    period: Period
    value: float | None
    source_file: str
    source_sheet: str
    source_column: str
    raw_line_label: str
    raw_concept: str
    source_method: str = "reported"
    depth: int = 0


@dataclass
class UnresolvedRow:
    source_file: str
    source_sheet: str
    line_label: str
    concept: str
    period_label: str
    value: float | None
    reason: str
    statement_type: str = ""  # income_statement | balance_sheet | cash_flow


def _build_lookup(
    concept_map: list[ConceptMapping],
) -> dict[tuple[str, str], str]:
    """(statement_type, raw_concept) → canonical_row_id."""
    return {(m.statement_type, m.raw_concept): m.canonical_row_id for m in concept_map}


def _build_label_lookup(master_rows: list[MasterRow]) -> dict[tuple[str, str], str]:
    """(statement_type, canonical_row_id) → display_label."""
    return {(r.statement_type, r.canonical_row_id): r.display_label for r in master_rows}


def map_all_facts(
    workbooks: list[WorkbookInfo],
    concept_map: list[ConceptMapping],
    master_rows: list[MasterRow],
) -> tuple[list[MappedFact], list[UnresolvedRow]]:
    """
    Map every FactRecord to its canonical_row_id using the concept map.
    Unmapped or blank-concept facts go to unresolved.
    """
    lookup = _build_lookup(concept_map)
    labels = _build_label_lookup(master_rows)

    mapped: list[MappedFact] = []
    unresolved: list[UnresolvedRow] = []

    for wb in workbooks:
        for sheet in wb.sheets:
            for fact in sheet.facts:
                if not fact.concept or not fact.concept.strip():
                    unresolved.append(UnresolvedRow(
                        source_file=fact.source_file,
                        source_sheet=fact.source_sheet,
                        line_label=fact.line_label,
                        concept="",
                        period_label=fact.period.canonical,
                        value=fact.value,
                        reason="Blank Concept",
                        statement_type=fact.statement_type,
                    ))
                    continue

                key = (fact.statement_type, fact.concept)
                canon = lookup.get(key)
                if canon is None:
                    unresolved.append(UnresolvedRow(
                        source_file=fact.source_file,
                        source_sheet=fact.source_sheet,
                        line_label=fact.line_label,
                        concept=fact.concept,
                        period_label=fact.period.canonical,
                        value=fact.value,
                        reason="Concept not in concept_to_row_map",
                        statement_type=fact.statement_type,
                    ))
                    continue

                display = labels.get((fact.statement_type, canon), fact.line_label)
                mapped.append(MappedFact(
                    statement_type=fact.statement_type,
                    canonical_row_id=canon,
                    display_label=display,
                    period=fact.period,
                    value=fact.value,
                    source_file=fact.source_file,
                    source_sheet=fact.source_sheet,
                    source_column=fact.source_column,
                    raw_line_label=fact.line_label,
                    raw_concept=fact.concept,
                    depth=fact.depth,
                ))

    logger.info("Mapped %d facts, %d unresolved", len(mapped), len(unresolved))
    return mapped, unresolved
