"""Compare legacy (backwards) vs lineage (forward) presentation registries."""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field

from master_presentation_builder import (
    ConceptMapping,
    MasterRow,
    _normalize_label,
)
from row_mapper import map_all_facts
from workbook_loader import WorkbookInfo

logger = logging.getLogger(__name__)


@dataclass
class RegistryScore:
    name: str
    master_row_count: int = 0
    concept_map_count: int = 0
    mapped_facts: int = 0
    unresolved_facts: int = 0
    duplicate_label_rows: int = 0
    bottom_orphan_rows: int = 0
    auto_from_filing_rows: int = 0
    total_score: float = 0.0
    detail: dict = field(default_factory=dict)

    @property
    def map_coverage(self) -> float:
        total = self.mapped_facts + self.unresolved_facts
        return self.mapped_facts / total if total else 0.0


def _count_duplicate_label_rows(master_rows: list[MasterRow]) -> int:
    """Rows sharing the same (statement, normalized label, depth) — likely duplicates."""
    groups: dict[tuple[str, str, int], list[str]] = defaultdict(list)
    for r in master_rows:
        norm = _normalize_label(r.display_label or "")
        if not norm:
            continue
        groups[(r.statement_type, norm, r.depth)].append(r.canonical_row_id)
    return sum(len(v) - 1 for v in groups.values() if len(v) > 1)


def _count_bottom_orphan_rows(master_rows: list[MasterRow]) -> int:
    """Rows with display_order >= 9999 (Phase 4 fallback positioning)."""
    return sum(1 for r in master_rows if r.display_order >= 9999.0)


def _count_auto_from_filing(concept_map: list[ConceptMapping]) -> int:
    return sum(
        1
        for m in concept_map
        if m.mapping_status == "auto_from_filing"
    )


def score_registry(
    name: str,
    workbooks: list[WorkbookInfo],
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
) -> RegistryScore:
    mapped, unresolved = map_all_facts(workbooks, concept_map, master_rows)
    dup = _count_duplicate_label_rows(master_rows)
    bottom = _count_bottom_orphan_rows(master_rows)
    auto_filing = _count_auto_from_filing(concept_map)
    coverage = len(mapped) / (len(mapped) + len(unresolved)) if (mapped or unresolved) else 0.0

    # Higher is better. Coverage dominates; penalize duplicates and orphans.
    total = (
        coverage * 10_000.0
        + len(mapped) * 0.1
        - len(unresolved) * 2.0
        - dup * 75.0
        - bottom * 40.0
        - auto_filing * 25.0
        - len(master_rows) * 0.05
    )

    return RegistryScore(
        name=name,
        master_row_count=len(master_rows),
        concept_map_count=len(concept_map),
        mapped_facts=len(mapped),
        unresolved_facts=len(unresolved),
        duplicate_label_rows=dup,
        bottom_orphan_rows=bottom,
        auto_from_filing_rows=auto_filing,
        total_score=total,
        detail={
            "map_coverage": round(coverage, 6),
        },
    )


@dataclass
class RegistryChoice:
    master_rows: list[MasterRow]
    concept_map: list[ConceptMapping]
    winner: str
    legacy_score: RegistryScore
    lineage_score: RegistryScore
    reason: str


def choose_better_registry(
    workbooks: list[WorkbookInfo],
    legacy_rows: list[MasterRow],
    legacy_map: list[ConceptMapping],
    lineage_rows: list[MasterRow],
    lineage_map: list[ConceptMapping],
) -> RegistryChoice:
    """
    Score both registries on fact-mapping quality and structural cleanliness.
    Returns the winning ``(master_rows, concept_map)`` pair.
    """
    legacy_score = score_registry("legacy", workbooks, legacy_rows, legacy_map)
    lineage_score = score_registry("lineage", workbooks, lineage_rows, lineage_map)

    if lineage_score.total_score > legacy_score.total_score:
        winner = "lineage"
        reason = (
            f"Lineage wins (score {lineage_score.total_score:.1f} vs "
            f"{legacy_score.total_score:.1f}): "
            f"coverage {lineage_score.map_coverage:.4f} vs {legacy_score.map_coverage:.4f}, "
            f"dup labels {lineage_score.duplicate_label_rows} vs "
            f"{legacy_score.duplicate_label_rows}, "
            f"unresolved {lineage_score.unresolved_facts} vs "
            f"{legacy_score.unresolved_facts}"
        )
        rows, cmap = lineage_rows, lineage_map
    elif legacy_score.total_score > lineage_score.total_score:
        winner = "legacy"
        reason = (
            f"Legacy wins (score {legacy_score.total_score:.1f} vs "
            f"{lineage_score.total_score:.1f}): "
            f"coverage {legacy_score.map_coverage:.4f} vs {lineage_score.map_coverage:.4f}, "
            f"dup labels {legacy_score.duplicate_label_rows} vs "
            f"{lineage_score.duplicate_label_rows}, "
            f"unresolved {legacy_score.unresolved_facts} vs "
            f"{lineage_score.unresolved_facts}"
        )
        rows, cmap = legacy_rows, legacy_map
    else:
        # Tie-break: prefer fewer duplicate labels, then higher coverage.
        if lineage_score.duplicate_label_rows < legacy_score.duplicate_label_rows:
            winner = "lineage"
            rows, cmap = lineage_rows, lineage_map
            reason = "Tie score; lineage has fewer duplicate-label rows"
        elif legacy_score.duplicate_label_rows < lineage_score.duplicate_label_rows:
            winner = "legacy"
            rows, cmap = legacy_rows, legacy_map
            reason = "Tie score; legacy has fewer duplicate-label rows"
        elif lineage_score.map_coverage >= legacy_score.map_coverage:
            winner = "lineage"
            rows, cmap = lineage_rows, lineage_map
            reason = "Tie score; lineage coverage >= legacy"
        else:
            winner = "legacy"
            rows, cmap = legacy_rows, legacy_map
            reason = "Tie score; legacy coverage higher"

    logger.info("Registry comparison: %s", reason)
    return RegistryChoice(
        master_rows=rows,
        concept_map=cmap,
        winner=winner,
        legacy_score=legacy_score,
        lineage_score=lineage_score,
        reason=reason,
    )
