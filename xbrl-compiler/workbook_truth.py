"""Workbook-as-truth: only headline filing periods populate consolidated cells.

Comparative columns on later 10-Q/10-K workbooks must not backfill standalone
quarter/FY slots when the period-primary workbook omits a line item.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, TypeVar

from consolidator import ConsolidatedData, _resolve_multi_concept
from headline_periods import headline_periods_for_workbook
from master_presentation_builder import ConceptMapping, MasterRow, _renumber_display_order
from row_mapper import MappedFact
from workbook_loader import WorkbookInfo, FactRecord

logger = logging.getLogger(__name__)

T = TypeVar("T")

DERIVED_SOURCE_METHODS = frozenset({
    "derived",
    "copied_from_fy_for_wacs",
    "copied_from_fy_for_bs",
})


def pick_headline_period_winner(
    items: list[T],
    period: str,
    file_headline_periods: dict[str, frozenset[str]],
    file_recency: dict[str, int],
    *,
    source_file: Callable[[T], str] = lambda x: x.source_file,  # type: ignore[attr-defined]
) -> T | None:
    """Return the highest-recency item whose source file *headlines* *period*."""
    pool = [
        x for x in items
        if period in file_headline_periods.get(source_file(x), frozenset())
    ]
    if not pool:
        return None
    return max(pool, key=lambda x: (file_recency.get(source_file(x), 0), source_file(x)))


def _concept_lookup(concept_map: list[ConceptMapping]) -> dict[tuple[str, str], str]:
    return {(m.statement_type, m.raw_concept): m.canonical_row_id for m in concept_map}


def build_workbook_truth_index(
    workbooks: list[WorkbookInfo],
    concept_map: list[ConceptMapping],
    master_rows: list[MasterRow],
    file_headline_periods: dict[str, frozenset[str]] | None = None,
) -> dict[tuple[str, str, str], float]:
    """
    Expected reported values: facts from workbooks that *headline* each period,
    aggregated within-file the same way as ``consolidate`` stage 1.
    """
    headlines = file_headline_periods or {
        wb.filename: headline_periods_for_workbook(wb) for wb in workbooks
    }
    cmap = _concept_lookup(concept_map)
    master_concept_map: dict[tuple[str, str], str] = {
        (r.statement_type, r.canonical_row_id): r.master_raw_concept for r in master_rows
    }

    # (st, canon, period, source_file) -> list[FactRecord]
    file_buckets: dict[tuple[str, str, str, str], list[FactRecord]] = defaultdict(list)
    for wb in workbooks:
        for sheet in wb.sheets:
            st = sheet.statement_type
            for fact in sheet.facts:
                if fact.value is None:
                    continue
                canon = cmap.get((st, str(fact.concept).strip()))
                if canon is None:
                    continue
                pl = fact.period.canonical
                if pl not in headlines.get(fact.source_file, frozenset()):
                    continue
                file_buckets[(st, canon, pl, fact.source_file)].append(fact)

    truth: dict[tuple[str, str, str], float] = {}
    # Group by (st, canon, pl) — one headline owner per period in practice
    cell_groups: dict[tuple[str, str, str], list[tuple[str, float]]] = defaultdict(list)

    for (st, canon, pl, src_file), facts in file_buckets.items():
        non_null = [f for f in facts if f.value is not None]
        if not non_null:
            continue
        raw_concepts = {f.concept for f in non_null}
        if len(raw_concepts) == 1:
            val = non_null[0].value
        else:
            mapped = [
                MappedFact(
                    st, canon, f.line_label, f.period, f.value,
                    f.source_file, f.source_sheet, f.source_column,
                    f.line_label, f.concept,
                )
                for f in non_null
            ]
            val, _ = _resolve_multi_concept(
                st, canon, pl, src_file, mapped,
                master_concept_map.get((st, canon)),
            )
        cell_groups[(st, canon, pl)].append((src_file, val))

    recency = {wb.filename: i for i, wb in enumerate(sorted(workbooks, key=lambda w: (w.latest_fy, w.filename)))}
    for (st, canon, pl), entries in cell_groups.items():
        winner_file, winner_val = max(entries, key=lambda e: (recency.get(e[0], 0), e[0]))
        truth[(st, canon, pl)] = winner_val

    return truth


@dataclass
class WorkbookTruthIssue:
    statement_type: str
    canonical_row_id: str
    period: str
    line_label: str
    issue: str  # extra_value | missing_value | value_mismatch | missing_line | extra_line
    compiled_value: float | None
    workbook_value: float | None
    source_file: str = ""


def validate_compiled_against_workbooks(
    consolidated: ConsolidatedData,
    truth: dict[tuple[str, str, str], float],
    master_rows: list[MasterRow],
    derived_cells: frozenset[tuple[str, str, str]],
    *,
    tol: float = 0.01,
) -> list[WorkbookTruthIssue]:
    """Compare consolidated reported cells to headline workbook truth."""
    labels = {(r.statement_type, r.canonical_row_id): r.display_label for r in master_rows}
    issues: list[WorkbookTruthIssue] = []

    seen_truth = set(truth.keys())
    for (st, crid, pl), wb_val in truth.items():
        compiled = consolidated.get(st, {}).get(crid, {}).get(pl)
        disp = labels.get((st, crid), crid)
        key = (st, crid, pl)
        if key in derived_cells:
            continue
        if compiled is None:
            issues.append(WorkbookTruthIssue(
                st, crid, pl, disp, "missing_value", None, wb_val,
            ))
        elif abs(float(compiled) - wb_val) > tol:
            issues.append(WorkbookTruthIssue(
                st, crid, pl, disp, "value_mismatch", float(compiled), wb_val,
            ))

    for st in consolidated:
        for crid, periods in consolidated[st].items():
            for pl, val in periods.items():
                if val is None:
                    continue
                key = (st, crid, pl)
                if key in derived_cells:
                    continue
                if key in seen_truth:
                    continue
                disp = labels.get((st, crid), crid)
                issues.append(WorkbookTruthIssue(
                    st, crid, pl, disp, "extra_value", float(val), None,
                ))

    return issues


def validate_workbook_lines(
    consolidated: ConsolidatedData,
    workbook_canons: dict[str, frozenset[str]],
    master_rows: list[MasterRow],
    derived_cells: frozenset[tuple[str, str, str]],
) -> list[WorkbookTruthIssue]:
    """Every workbook line must exist; no row may carry reported values off-workbook."""
    labels = {(r.statement_type, r.canonical_row_id): r.display_label for r in master_rows}
    issues: list[WorkbookTruthIssue] = []

    for st, canons in workbook_canons.items():
        stmt_rows = consolidated.get(st, {})
        for crid in canons:
            if crid not in stmt_rows:
                disp = labels.get((st, crid), crid)
                issues.append(WorkbookTruthIssue(
                    st, crid, "", disp, "missing_line", None, None,
                ))

    for st, rows in consolidated.items():
        wb_set = workbook_canons.get(st, frozenset())
        for crid, periods in rows.items():
            if crid in wb_set:
                continue
            reported_vals = [
                (pl, val)
                for pl, val in periods.items()
                if val is not None and (st, crid, pl) not in derived_cells
            ]
            if not reported_vals:
                continue
            disp = labels.get((st, crid), crid)
            pl0, val0 = reported_vals[0]
            issues.append(WorkbookTruthIssue(
                st, crid, pl0, disp, "extra_line", float(val0), None,
            ))

    return issues


def validate_workbook_truth(
    consolidated: ConsolidatedData,
    truth: dict[tuple[str, str, str], float],
    workbook_canons: dict[str, frozenset[str]],
    master_rows: list[MasterRow],
    derived_cells: frozenset[tuple[str, str, str]],
    *,
    tol: float = 0.01,
) -> list[WorkbookTruthIssue]:
    """Cell-level and line-level checks against headline workbook sources."""
    issues = validate_compiled_against_workbooks(
        consolidated, truth, master_rows, derived_cells, tol=tol,
    )
    issues.extend(validate_workbook_lines(
        consolidated, workbook_canons, master_rows, derived_cells,
    ))
    return issues


def _ensure_cell(consolidated: ConsolidatedData, st: str, crid: str, pl: str) -> None:
    if st not in consolidated:
        consolidated[st] = {}
    if crid not in consolidated[st]:
        consolidated[st][crid] = {}
    if pl not in consolidated[st][crid]:
        consolidated[st][crid][pl] = None


def _display_meta_for_canon(
    workbooks: list[WorkbookInfo],
    concept_map: list[ConceptMapping],
    statement_type: str,
    canon: str,
) -> tuple[str, int]:
    """Best line label and depth for a canonical row from workbook sheets."""
    cmap = _concept_lookup(concept_map)
    raw_candidates = [
        m.raw_concept
        for m in concept_map
        if m.statement_type == statement_type and m.canonical_row_id == canon
    ]
    if not raw_candidates:
        raw_candidates = [canon]
    for wb in workbooks:
        for sh in wb.sheets:
            if sh.statement_type != statement_type:
                continue
            for raw in raw_candidates:
                if raw in sh.concept_to_line:
                    label = sh.concept_to_line.get(raw) or canon
                    depth = sh.concept_to_depth.get(raw, 0)
                    return label, depth
    for wb in workbooks:
        for sh in wb.sheets:
            if sh.statement_type != statement_type:
                continue
            for fact in sh.facts:
                raw = str(fact.concept).strip()
                if cmap.get((statement_type, raw)) == canon:
                    return fact.line_label or canon, fact.depth
    return canon, 0


def ensure_workbook_lines_and_cells(
    consolidated: ConsolidatedData,
    truth: dict[tuple[str, str, str], float],
    workbook_canons: dict[str, frozenset[str]],
    master_rows: list[MasterRow],
    workbooks: list[WorkbookInfo],
    concept_map: list[ConceptMapping],
    derived_cells: frozenset[tuple[str, str, str]],
) -> tuple[int, int]:
    """
    Add missing workbook lines and fill empty reported cells from the truth index.
    Returns (rows_added, cells_filled).
    """
    existing_rows = {(r.statement_type, r.canonical_row_id) for r in master_rows}
    rows_added = 0
    cells_filled = 0

    for st, canons in workbook_canons.items():
        for crid in canons:
            if (st, crid) not in existing_rows:
                label, depth = _display_meta_for_canon(workbooks, concept_map, st, crid)
                max_order = max(
                    (float(r.display_order) for r in master_rows if r.statement_type == st),
                    default=0.0,
                )
                master_rows.append(MasterRow(
                    statement_type=st,
                    canonical_row_id=crid,
                    master_raw_concept=crid,
                    display_label=label,
                    display_order=max_order + 1.0,
                    depth=depth,
                ))
                existing_rows.add((st, crid))
                rows_added += 1
                _renumber_display_order(master_rows)
            if crid not in consolidated.get(st, {}):
                consolidated.setdefault(st, {})[crid] = {}
                rows_added += 1

    for (st, crid, pl), wb_val in truth.items():
        key = (st, crid, pl)
        if key in derived_cells:
            continue
        _ensure_cell(consolidated, st, crid, pl)
        if consolidated[st][crid].get(pl) is None:
            consolidated[st][crid][pl] = wb_val
            cells_filled += 1

    return rows_added, cells_filled


def clear_derived_cells(
    consolidated: ConsolidatedData,
    derived_cells: frozenset[tuple[str, str, str]],
) -> int:
    """Remove derived quarter values so derivation can run again after operand fixes."""
    cleared = 0
    for st, crid, pl in derived_cells:
        row = consolidated.get(st, {}).get(crid)
        if row is None:
            continue
        if row.get(pl) is not None:
            row[pl] = None
            cleared += 1
    return cleared


@dataclass
class WorkbookTruthPassResult:
    iterations: int
    cells_cleared: int
    cells_aligned: int
    rows_added: int
    cells_filled: int
    derived_cells_cleared: int
    post_truth_derived: int
    issues: list[WorkbookTruthIssue]


def run_workbook_truth_until_clean(
    consolidated: ConsolidatedData,
    workbooks: list[WorkbookInfo],
    concept_map: list[ConceptMapping],
    master_rows: list[MasterRow],
    file_headline_periods: dict[str, frozenset[str]],
    audit_entries: list,
    prior_derived_audit: list,
    derive_quarters_fn,
    *,
    max_iterations: int = 15,
    tol: float = 0.01,
) -> tuple[WorkbookTruthPassResult, list]:
    """
    Enforce workbook-as-truth in a loop: align reported cells, restore missing
    lines, re-derive quarters when operands change, validate until clean.
    """
    truth = build_workbook_truth_index(
        workbooks, concept_map, master_rows, file_headline_periods,
    )
    workbook_canons = {
        st: frozenset(canon)
        for st, canon in collect_workbook_canonical_concepts(workbooks, concept_map).items()
    }

    total_cleared = 0
    total_aligned = 0
    total_rows = 0
    total_filled = 0
    total_derived_cleared = 0
    post_truth_derived: list = []
    # Derived quarters from before this pass — cleared and replaced when operands change.
    protected_derived_audit: list = list(prior_derived_audit)

    def _protected_derived_keys() -> frozenset[tuple[str, str, str]]:
        return derived_cells_from_audit(protected_derived_audit + post_truth_derived)

    def _derive_for_truth(consolidated, master_rows, audit_entries):
        """Re-derive without FY sign harmonization — workbook FY is already authoritative."""
        return derive_quarters_fn(
            consolidated,
            master_rows,
            audit_entries,
            skip_fy_harmonization=True,
        )

    for iteration in range(1, max_iterations + 1):
        changed = False
        protected = _protected_derived_keys()

        rows_added, cells_filled = ensure_workbook_lines_and_cells(
            consolidated,
            truth,
            workbook_canons,
            master_rows,
            workbooks,
            concept_map,
            protected,
        )
        if rows_added:
            total_rows += rows_added
            changed = True
        if cells_filled:
            total_filled += cells_filled
            changed = True

        cleared, aligned = enforce_workbook_truth(
            consolidated, truth, protected,
        )
        if cleared:
            total_cleared += cleared
            changed = True
        if aligned:
            total_aligned += aligned
            changed = True

        if changed:
            to_clear = _protected_derived_keys()
            if to_clear:
                total_derived_cleared += clear_derived_cells(consolidated, to_clear)
            protected_derived_audit = []
            post_truth_derived = _derive_for_truth(
                consolidated, master_rows, audit_entries,
            )
            logger.info(
                "Workbook truth iteration %d: changed — re-derived %d quarters",
                iteration, len(post_truth_derived),
            )
            continue

        issues = validate_workbook_truth(
            consolidated,
            truth,
            workbook_canons,
            master_rows,
            _protected_derived_keys(),
            tol=tol,
        )
        if not issues:
            logger.info(
                "Workbook truth converged in %d iteration(s): "
                "cleared %d, aligned %d, +%d rows, +%d cells",
                iteration, total_cleared, total_aligned, total_rows, total_filled,
            )
            return WorkbookTruthPassResult(
                iterations=iteration,
                cells_cleared=total_cleared,
                cells_aligned=total_aligned,
                rows_added=total_rows,
                cells_filled=total_filled,
                derived_cells_cleared=total_derived_cleared,
                post_truth_derived=len(post_truth_derived),
                issues=[],
            ), post_truth_derived

        logger.warning(
            "Workbook truth iteration %d: %d issue(s) remain after enforce",
            iteration, len(issues),
        )
        for issue in issues[:10]:
            logger.warning(
                "  [%s] %s %s @ %s compiled=%s workbook=%s",
                issue.issue, issue.statement_type, issue.line_label,
                issue.period or "(line)", issue.compiled_value, issue.workbook_value,
            )

        # One more repair pass before giving up (missing lines / cells).
        rows_added2, cells_filled2 = ensure_workbook_lines_and_cells(
            consolidated,
            truth,
            workbook_canons,
            master_rows,
            workbooks,
            concept_map,
            _protected_derived_keys(),
        )
        if rows_added2 or cells_filled2:
            total_rows += rows_added2
            total_filled += cells_filled2
            to_clear = _protected_derived_keys()
            if to_clear:
                total_derived_cleared += clear_derived_cells(consolidated, to_clear)
            protected_derived_audit = []
            post_truth_derived = _derive_for_truth(
                consolidated, master_rows, audit_entries,
            )
            continue

        return WorkbookTruthPassResult(
            iterations=iteration,
            cells_cleared=total_cleared,
            cells_aligned=total_aligned,
            rows_added=total_rows,
            cells_filled=total_filled,
            derived_cells_cleared=total_derived_cleared,
            post_truth_derived=len(post_truth_derived),
            issues=issues,
        ), post_truth_derived

    issues = validate_workbook_truth(
        consolidated,
        truth,
        workbook_canons,
        master_rows,
        _protected_derived_keys(),
        tol=tol,
    )
    logger.error(
        "Workbook truth did not converge after %d iterations (%d issues)",
        max_iterations, len(issues),
    )
    return WorkbookTruthPassResult(
        iterations=max_iterations,
        cells_cleared=total_cleared,
        cells_aligned=total_aligned,
        rows_added=total_rows,
        cells_filled=total_filled,
        derived_cells_cleared=total_derived_cleared,
        post_truth_derived=len(post_truth_derived),
        issues=issues,
    ), post_truth_derived


def collect_workbook_canonical_concepts(
    workbooks: list[WorkbookInfo],
    concept_map: list[ConceptMapping],
) -> dict[str, set[str]]:
    """Every canonical row id that appears on any workbook sheet row list or fact."""
    cmap = _concept_lookup(concept_map)
    out: dict[str, set[str]] = defaultdict(set)
    for wb in workbooks:
        for sh in wb.sheets:
            st = sh.statement_type
            for raw in sh.row_order:
                c = str(raw).strip() if raw else ""
                if not c:
                    continue
                out[st].add(cmap.get((st, c), c))
            for fact in sh.facts:
                c = str(fact.concept).strip() if fact.concept else ""
                if not c:
                    continue
                out[st].add(cmap.get((st, c), c))
    return {st: set(canon) for st, canon in out.items()}


def derived_cells_from_audit(audit_entries) -> frozenset[tuple[str, str, str]]:
    return frozenset(
        (ae.statement_type, ae.canonical_row_id, ae.output_period)
        for ae in audit_entries
        if ae.source_method in DERIVED_SOURCE_METHODS
    )


def enforce_workbook_truth(
    consolidated: ConsolidatedData,
    truth: dict[tuple[str, str, str], float],
    derived_cells: frozenset[tuple[str, str, str]],
) -> tuple[int, int]:
    """
    Drop compiled values not present on the period-primary workbook; align
    reported cells to headline workbook truth. Returns (cells_cleared, cells_set).
    """
    cleared = 0
    set_count = 0

    for st in list(consolidated.keys()):
        for crid in list(consolidated[st].keys()):
            for pl in list(consolidated[st][crid].keys()):
                key = (st, crid, pl)
                if key in derived_cells:
                    continue
                cur = consolidated[st][crid].get(pl)
                expected = truth.get(key)
                if expected is None:
                    if cur is not None:
                        consolidated[st][crid][pl] = None
                        cleared += 1
                elif cur is None:
                    consolidated[st][crid][pl] = expected
                    set_count += 1
                elif abs(float(cur) - expected) > 0.01:
                    consolidated[st][crid][pl] = expected
                    set_count += 1

    if cleared or set_count:
        logger.info(
            "Workbook truth enforce: cleared %d extra cells, aligned %d cells",
            cleared, set_count,
        )
    return cleared, set_count
