"""Post-consolidation coverage pass.

1. **Mapped gaps** — Repair from ``mapped_facts`` where consolidated dropped a value.

2. **Explicit workbook scan** — Build ``(statement_type, raw_concept)`` groups from
   *every* numeric fact in the loaded workbooks.  For any concept **not** in
   ``concept_map``, add a ``MasterRow`` + ``ConceptMapping`` (status
   ``explicit_workbook_line``) and merge values (anchor positioning matches
   ``auto_from_filing``).

3. **Unresolved queue** — Same as (2) for facts that ``map_all_facts`` already
   listed as unresolved.

4. **Workbook fact gap fill** — For every mapped fact in the scan, if
   ``consolidated[stmt][canon][period]`` is still empty, fill from the most
   recent filing (``coverage_workbook_fill``).

**Final raw reconcile** (``reconcile_final_statements_with_raw_xbrl``) is invoked
from ``main`` after the first derive-quarters pass: it unions every raw line
from ``row_order`` and facts against the built statements and repairs gaps.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass

from consolidator import ConsolidatedData, AuditEntry
from master_presentation_builder import (
    ConceptMapping,
    MasterRow,
    _renumber_display_order,
)
from period_parser import parse_period
from row_mapper import MappedFact, UnresolvedRow
from workbook_loader import WorkbookInfo, FactRecord

logger = logging.getLogger(__name__)


@dataclass
class CoveragePassResult:
    repaired_mapped_cells: int = 0
    integrated_unresolved_rows: int = 0
    integrated_unresolved_cells: int = 0
    explicit_workbook_rows: int = 0
    explicit_workbook_cells: int = 0
    workbook_fact_gap_fills: int = 0
    row_order_registry_rows: int = 0


@dataclass
class FinalRawReconcileResult:
    """Second-pass scan: every raw XBRL line vs final master rows + consolidated."""

    raw_keys_scanned: int = 0
    rows_added: int = 0
    maps_repaired: int = 0
    orphan_master_rows_recovered: int = 0
    cells_added: int = 0

    @property
    def changed(self) -> bool:
        return (
            self.rows_added
            + self.maps_repaired
            + self.orphan_master_rows_recovered
            + self.cells_added
        ) > 0


def _ensure_cell(data: ConsolidatedData, st: str, crid: str, pl: str) -> None:
    if st not in data:
        data[st] = {}
    if crid not in data[st]:
        data[st][crid] = {}
    if pl not in data[st][crid]:
        data[st][crid][pl] = None


def _concept_lookup(concept_map: list[ConceptMapping]) -> dict[tuple[str, str], str]:
    return {(m.statement_type, m.raw_concept): m.canonical_row_id for m in concept_map}


def _find_anchor_canon(
    statement_type: str,
    concept: str,
    workbooks: list[WorkbookInfo],
    cmap: dict[tuple[str, str], str],
) -> str | None:
    """Nearest preceding row in sheet order that has a concept_map entry."""
    for wb in workbooks:
        for sheet in wb.sheets:
            if sheet.statement_type != statement_type:
                continue
            if concept not in sheet.row_order:
                continue
            idx = sheet.row_order.index(concept)
            for j in range(idx - 1, -1, -1):
                prev = sheet.row_order[j]
                if not prev:
                    continue
                key = (statement_type, prev)
                if key in cmap:
                    return cmap[key]
            return None
    return None


def _order_of(master_rows: list[MasterRow]) -> dict[tuple[str, str], float]:
    return {(r.statement_type, r.canonical_row_id): float(r.display_order) for r in master_rows}


def _meta_for_concept(
    workbooks: list[WorkbookInfo],
    statement_type: str,
    concept: str,
) -> tuple[str, int]:
    """Best line label and depth for *concept* from any sheet."""
    label, depth = concept, 0
    for wb in workbooks:
        for sh in wb.sheets:
            if sh.statement_type != statement_type:
                continue
            if concept in sh.concept_to_line:
                label = sh.concept_to_line.get(concept, label) or label
                depth = sh.concept_to_depth.get(concept, depth)
                return label, depth
    return label, depth


def _group_facts_by_statement_concept(
    workbooks: list[WorkbookInfo],
) -> dict[tuple[str, str], list[FactRecord]]:
    """All non-empty numeric facts keyed by (statement_type, raw concept)."""
    groups: dict[tuple[str, str], list[FactRecord]] = defaultdict(list)
    for wb in workbooks:
        for sheet in wb.sheets:
            st = sheet.statement_type
            for fact in sheet.facts:
                if not fact.concept or not str(fact.concept).strip():
                    continue
                if fact.value is None:
                    continue
                key = (st, str(fact.concept).strip())
                groups[key].append(fact)
    return groups


def collect_all_raw_xbrl_line_items(
    workbooks: list[WorkbookInfo],
) -> set[tuple[str, str]]:
    """
    Union of every distinct ``(statement_type, concept)`` that appears in the
    loaded Excel/XBRL workbooks — from **row_order** and from **facts** (even
    when the fact value is empty after parsing).
    """
    keys: set[tuple[str, str]] = set()
    for wb in workbooks:
        for sh in wb.sheets:
            st = sh.statement_type
            for c in sh.row_order:
                s = str(c).strip() if c else ""
                if s:
                    keys.add((st, s))
            for fact in sh.facts:
                s = str(fact.concept).strip() if fact.concept else ""
                if s:
                    keys.add((st, s))
    return keys


def _prune_unresolved_after_map(
    unresolved: list[UnresolvedRow],
    concept_map: list[ConceptMapping],
) -> list[UnresolvedRow]:
    """Drop unresolved rows whose concept is now in the map (integrated elsewhere)."""
    cmap = _concept_lookup(concept_map)
    out: list[UnresolvedRow] = []
    for u in unresolved:
        if (
            u.reason == "Concept not in concept_to_row_map"
            and u.concept
            and u.statement_type
            and (u.statement_type, u.concept.strip()) in cmap
        ):
            continue
        out.append(u)
    return out


def register_row_order_concepts_not_in_map(
    workbooks: list[WorkbookInfo],
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
) -> int:
    """
    Register every ``(statement, concept)`` that appears in a sheet's
    ``row_order``, even when **no numeric facts** were loaded for that concept.

    ``load_workbook_data`` can drop whole period columns as *sparse*, so a line
    may exist on the Excel grid but contribute zero ``FactRecord``\\s.  Those
    tags never appear in the fact-group scan, so they were previously omitted
    from ``concept_map`` and disappeared from consolidated output and the UI.
    """
    cmap = _concept_lookup(concept_map)
    existing_keys = {(r.statement_type, r.canonical_row_id) for r in master_rows}
    anchor_counters: dict[tuple[str, str | None], int] = {}
    new_rows = 0

    seen_pairs: set[tuple[str, str]] = set()
    pending: list[tuple[str, str]] = []
    for wb in workbooks:
        for sh in wb.sheets:
            st = sh.statement_type
            for concept in sh.row_order:
                c = str(concept).strip() if concept else ""
                if not c:
                    continue
                key = (st, c)
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                if key in cmap:
                    continue
                pending.append(key)

    for (st, concept) in sorted(pending):
        canon = concept

        if (st, canon) in existing_keys:
            concept_map.append(
                ConceptMapping(
                    statement_type=st,
                    raw_concept=concept,
                    canonical_row_id=canon,
                    mapping_status="row_order_registry",
                    notes="Coverage — workbook row_order line already in master_rows",
                )
            )
            cmap[(st, concept)] = canon
            continue

        anchor = _find_anchor_canon(st, concept, workbooks, cmap)
        anchor_key = (st, anchor)
        seq = anchor_counters.get(anchor_key, 0)
        anchor_counters[anchor_key] = seq + 1
        oo = _order_of(master_rows)

        if anchor is not None and (st, anchor) in oo:
            new_order = oo[(st, anchor)] + 0.001 * (seq + 1)
        elif anchor is not None:
            new_order = 9999.0 + seq
        else:
            new_order = -1.0 + 0.001 * seq

        label, depth = _meta_for_concept(workbooks, st, concept)
        src = next(
            (
                wb.filename
                for wb in workbooks
                for sh in wb.sheets
                if sh.statement_type == st and concept in sh.row_order
            ),
            "?",
        )
        master_rows.append(
            MasterRow(
                statement_type=st,
                canonical_row_id=canon,
                master_raw_concept=canon,
                display_label=label,
                display_order=new_order,
                depth=depth,
            )
        )
        concept_map.append(
            ConceptMapping(
                statement_type=st,
                raw_concept=concept,
                canonical_row_id=canon,
                mapping_status="row_order_registry",
                notes=f"Row-order registry — no facts loaded for this concept — source {src}",
            )
        )
        cmap[(st, concept)] = canon
        existing_keys.add((st, canon))
        new_rows += 1
        _renumber_display_order(master_rows)

    if new_rows:
        logger.info(
            "Coverage: row_order registry added %d master rows (concepts with no loaded facts)",
            new_rows,
        )
    return new_rows


def integrate_workbook_concepts_not_in_map(
    groups: dict[tuple[str, str], list[FactRecord]],
    workbooks: list[WorkbookInfo],
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    consolidated: ConsolidatedData,
    file_recency: dict[str, int],
    audit_entries: list[AuditEntry],
) -> tuple[int, int]:
    """
    For every (statement, raw concept) that appears in a workbook but has **no**
    concept_map entry, add a positioned ``MasterRow`` + mapping and merge values.

    This is the authoritative “do not drop line items” scan (in addition to the
    unresolved queue from ``map_all_facts``).
    """
    cmap = _concept_lookup(concept_map)
    existing_keys = {(r.statement_type, r.canonical_row_id) for r in master_rows}
    anchor_counters: dict[tuple[str, str | None], int] = {}

    missing = [(st, c) for (st, c) in groups if (st, c) not in cmap]
    if not missing:
        return 0, 0

    new_rows = 0
    new_cells = 0

    for (st, concept) in sorted(missing):
        facts = groups[(st, concept)]
        canon = concept

        if (st, canon) not in existing_keys:
            anchor = _find_anchor_canon(st, concept, workbooks, cmap)
            anchor_key = (st, anchor)
            seq = anchor_counters.get(anchor_key, 0)
            anchor_counters[anchor_key] = seq + 1
            oo = _order_of(master_rows)

            if anchor is not None and (st, anchor) in oo:
                new_order = oo[(st, anchor)] + 0.001 * (seq + 1)
            elif anchor is not None:
                new_order = 9999.0 + seq
            else:
                new_order = -1.0 + 0.001 * seq

            label, depth = _meta_for_concept(workbooks, st, concept)
            src = facts[0].source_file
            master_rows.append(
                MasterRow(
                    statement_type=st,
                    canonical_row_id=canon,
                    master_raw_concept=canon,
                    display_label=label,
                    display_order=new_order,
                    depth=depth,
                )
            )
            concept_map.append(
                ConceptMapping(
                    statement_type=st,
                    raw_concept=concept,
                    canonical_row_id=canon,
                    mapping_status="explicit_workbook_line",
                    notes=f"Explicit coverage — workbook had facts but no map entry — source {src}",
                )
            )
            cmap[(st, concept)] = canon
            existing_keys.add((st, canon))
            new_rows += 1
            _renumber_display_order(master_rows)

        # Merge periods (most recent file wins per cell)
        by_pl: dict[str, list[FactRecord]] = defaultdict(list)
        for f in facts:
            by_pl[f.period.canonical].append(f)

        label_map = {(r.statement_type, r.canonical_row_id): r.display_label for r in master_rows}
        disp = label_map.get((st, canon), canon)

        for pl, flist in by_pl.items():
            winner = max(
                flist,
                key=lambda f: (file_recency.get(f.source_file, 0), f.source_file),
            )
            _ensure_cell(consolidated, st, canon, pl)
            cur = consolidated[st][canon].get(pl)
            if cur is not None:
                continue
            consolidated[st][canon][pl] = winner.value
            new_cells += 1
            audit_entries.append(
                AuditEntry(
                    statement_type=st,
                    canonical_row_id=canon,
                    master_display_label=disp,
                    output_period=pl,
                    value=winner.value,
                    source_file=winner.source_file,
                    source_sheet=winner.source_sheet,
                    source_column=winner.source_column,
                    raw_line_label=winner.line_label,
                    raw_concept=winner.concept,
                    source_method="explicit_workbook_line",
                    derivation_formula="Explicit workbook coverage — line item not in concept map",
                )
            )

    return new_rows, new_cells


def reconcile_final_statements_with_raw_xbrl(
    workbooks: list[WorkbookInfo],
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    consolidated: ConsolidatedData,
    file_recency: dict[str, int],
    audit_entries: list[AuditEntry],
) -> FinalRawReconcileResult:
    """
    After the main statement build, compare **all** raw line identifiers from the
    workbooks against ``master_rows`` + ``concept_map`` + ``consolidated``.

    Repairs:

    * Raw key with **no** ``concept_map`` entry → add identity mapping and
      ``MasterRow`` when missing; merge any numeric facts into *consolidated*.
    * ``concept_map`` points to a canonical id with **no** ``MasterRow`` → add
      the missing ``MasterRow`` (orphaned mapping).
    * Facts present but empty consolidated cells → fill (most-recent file wins).

    This is a last line of defence against gaps left by earlier phases.
    """
    res = FinalRawReconcileResult()
    raw_keys = collect_all_raw_xbrl_line_items(workbooks)
    res.raw_keys_scanned = len(raw_keys)
    if not raw_keys:
        return res

    cmap = _concept_lookup(concept_map)
    existing_keys = {(r.statement_type, r.canonical_row_id) for r in master_rows}
    groups = _group_facts_by_statement_concept(workbooks)
    anchor_counters: dict[tuple[str, str | None], int] = {}

    def _append_master_row_for_canon(
        st: str,
        canon: str,
        raw_for_anchor: str,
        note: str,
    ) -> None:
        nonlocal existing_keys
        anchor = _find_anchor_canon(st, raw_for_anchor, workbooks, cmap)
        anchor_key = (st, anchor)
        seq = anchor_counters.get(anchor_key, 0)
        anchor_counters[anchor_key] = seq + 1
        oo = _order_of(master_rows)
        if anchor is not None and (st, anchor) in oo:
            new_order = oo[(st, anchor)] + 0.001 * (seq + 1)
        elif anchor is not None:
            new_order = 9999.0 + seq
        else:
            new_order = -1.0 + 0.001 * seq
        label, depth = _meta_for_concept(workbooks, st, canon)
        src = next(
            (
                wb.filename
                for wb in workbooks
                for sh in wb.sheets
                if sh.statement_type == st and raw_for_anchor in sh.row_order
            ),
            "?",
        )
        master_rows.append(
            MasterRow(
                statement_type=st,
                canonical_row_id=canon,
                master_raw_concept=canon,
                display_label=label,
                display_order=new_order,
                depth=depth,
            )
        )
        existing_keys.add((st, canon))
        _renumber_display_order(master_rows)
        logger.info(
            "Final raw reconcile: added MasterRow %s / %s — %s (source hint %s)",
            st,
            canon,
            note,
            src,
        )

    for (st, raw) in sorted(raw_keys):
        canon = cmap.get((st, raw))

        if canon is None:
            canon = raw
            if (st, canon) in existing_keys:
                concept_map.append(
                    ConceptMapping(
                        statement_type=st,
                        raw_concept=raw,
                        canonical_row_id=canon,
                        mapping_status="final_raw_reconcile",
                        notes="Reconciliation — master row existed without concept_map entry",
                    )
                )
                cmap[(st, raw)] = canon
                res.maps_repaired += 1
            else:
                _append_master_row_for_canon(
                    st, canon, raw, "missing row + map for raw XBRL line",
                )
                concept_map.append(
                    ConceptMapping(
                        statement_type=st,
                        raw_concept=raw,
                        canonical_row_id=canon,
                        mapping_status="final_raw_reconcile",
                        notes="Reconciliation — raw line missing from statements after build",
                    )
                )
                cmap[(st, raw)] = canon
                res.rows_added += 1
        else:
            if (st, canon) not in existing_keys:
                _append_master_row_for_canon(
                    st, canon, raw, "orphaned concept_map without MasterRow",
                )
                res.orphan_master_rows_recovered += 1

        facts = groups.get((st, raw), [])
        if not facts:
            continue

        by_pl: dict[str, list[FactRecord]] = defaultdict(list)
        for f in facts:
            by_pl[f.period.canonical].append(f)

        label_map = {(r.statement_type, r.canonical_row_id): r.display_label for r in master_rows}
        disp = label_map.get((st, canon), canon)

        for pl, flist in by_pl.items():
            winner = max(
                flist,
                key=lambda f: (file_recency.get(f.source_file, 0), f.source_file),
            )
            _ensure_cell(consolidated, st, canon, pl)
            cur = consolidated[st][canon].get(pl)
            if cur is not None:
                continue
            consolidated[st][canon][pl] = winner.value
            res.cells_added += 1
            audit_entries.append(
                AuditEntry(
                    statement_type=st,
                    canonical_row_id=canon,
                    master_display_label=disp,
                    output_period=pl,
                    value=winner.value,
                    source_file=winner.source_file,
                    source_sheet=winner.source_sheet,
                    source_column=winner.source_column,
                    raw_line_label=winner.line_label,
                    raw_concept=winner.concept,
                    source_method="final_raw_reconcile",
                    derivation_formula="Final pass — raw XBRL line vs built statements",
                )
            )

    if res.changed:
        logger.info(
            "Final raw reconcile complete: +%d rows, +%d map repairs, +%d orphan rows, +%d cells",
            res.rows_added,
            res.maps_repaired,
            res.orphan_master_rows_recovered,
            res.cells_added,
        )
    return res


def fill_consolidated_gaps_from_workbook_groups(
    groups: dict[tuple[str, str], list[FactRecord]],
    concept_map: list[ConceptMapping],
    consolidated: ConsolidatedData,
    file_recency: dict[str, int],
    master_rows: list[MasterRow],
    audit_entries: list[AuditEntry],
) -> int:
    """
    For every fact whose (statement, raw concept) **is** mapped, ensure the
    consolidated cell for that canonical row + period exists (most recent file wins).
    Fills only where the current value is None.
    """
    cmap = _concept_lookup(concept_map)
    label_map: dict[tuple[str, str], str] = {
        (r.statement_type, r.canonical_row_id): r.display_label for r in master_rows
    }

    buckets: dict[tuple[str, str, str], list[FactRecord]] = defaultdict(list)
    for (st, raw_c), flist in groups.items():
        canon = cmap.get((st, raw_c))
        if canon is None:
            continue
        for f in flist:
            buckets[(st, canon, f.period.canonical)].append(f)

    fills = 0
    for (st, crid, pl), flist in buckets.items():
        winner = max(
            flist,
            key=lambda f: (file_recency.get(f.source_file, 0), f.source_file),
        )
        _ensure_cell(consolidated, st, crid, pl)
        cur = consolidated[st][crid].get(pl)
        if cur is not None or winner.value is None:
            continue
        consolidated[st][crid][pl] = winner.value
        disp = label_map.get((st, crid), crid)
        audit_entries.append(
            AuditEntry(
                statement_type=st,
                canonical_row_id=crid,
                master_display_label=disp,
                output_period=pl,
                value=winner.value,
                source_file=winner.source_file,
                source_sheet=winner.source_sheet,
                source_column=winner.source_column,
                raw_line_label=winner.line_label,
                raw_concept=winner.concept,
                source_method="coverage_workbook_fill",
                derivation_formula="Filled empty consolidated cell from workbook fact scan",
            )
        )
        fills += 1
    return fills


def repair_mapped_gaps(
    consolidated: ConsolidatedData,
    mapped_facts: list[MappedFact],
    file_recency: dict[str, int],
    master_rows: list[MasterRow],
    audit_entries: list[AuditEntry],
) -> int:
    """Fill missing consolidated cells from mapped facts.  Returns repair count."""
    label_map: dict[tuple[str, str], str] = {
        (r.statement_type, r.canonical_row_id): r.display_label for r in master_rows
    }
    buckets: dict[tuple[str, str, str], list[MappedFact]] = defaultdict(list)
    for mf in mapped_facts:
        if mf.value is None:
            continue
        buckets[(mf.statement_type, mf.canonical_row_id, mf.period.canonical)].append(mf)

    repairs = 0
    for (st, crid, pl), facts in buckets.items():
        winner = max(
            facts,
            key=lambda f: (file_recency.get(f.source_file, 0), f.source_file),
        )
        _ensure_cell(consolidated, st, crid, pl)
        cur = consolidated[st][crid].get(pl)
        if cur is None and winner.value is not None:
            consolidated[st][crid][pl] = winner.value
            disp = label_map.get((st, crid), crid)
            audit_entries.append(
                AuditEntry(
                    statement_type=st,
                    canonical_row_id=crid,
                    master_display_label=disp,
                    output_period=pl,
                    value=winner.value,
                    source_file=winner.source_file,
                    source_sheet=winner.source_sheet,
                    source_column=winner.source_column,
                    raw_line_label=winner.raw_line_label,
                    raw_concept=winner.raw_concept,
                    source_method="coverage_repair",
                    derivation_formula="Filled missing consolidated cell from mapped facts",
                )
            )
            repairs += 1
    return repairs


def integrate_unresolved_facts(
    workbooks: list[WorkbookInfo],
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    consolidated: ConsolidatedData,
    file_recency: dict[str, int],
    unresolved: list[UnresolvedRow],
    audit_entries: list[AuditEntry],
) -> tuple[list[UnresolvedRow], int, int]:
    """
    Add unresolved concepts as positioned rows and merge their values.

    Returns (remaining_unresolved, new_row_count, new_cell_count).
    """
    cmap = _concept_lookup(concept_map)
    existing_keys = {(r.statement_type, r.canonical_row_id) for r in master_rows}

    # Group integratable unresolved facts
    pending: dict[tuple[str, str], list[UnresolvedRow]] = defaultdict(list)
    remaining: list[UnresolvedRow] = []

    for u in unresolved:
        if not u.concept or not u.concept.strip():
            remaining.append(u)
            continue
        if u.reason != "Concept not in concept_to_row_map":
            remaining.append(u)
            continue
        st = u.statement_type
        if not st:
            remaining.append(u)
            continue
        p = parse_period(u.period_label)
        if p is None:
            remaining.append(u)
            continue
        if u.value is None:
            remaining.append(u)
            continue
        pending[(st, u.concept)].append(u)

    if not pending:
        return remaining, 0, 0

    new_rows = 0
    new_cells = 0
    anchor_counters: dict[tuple[str, str | None], int] = {}

    # Stable order: by statement then concept string
    for (st, concept) in sorted(pending.keys()):
        facts = pending[(st, concept)]
        canon = concept  # identity row — raw XBRL concept as canonical id

        if (st, canon) in existing_keys:
            # Row already exists from builder; only merge values
            pass
        else:
            anchor = _find_anchor_canon(st, concept, workbooks, cmap)
            anchor_key = (st, anchor)
            seq = anchor_counters.get(anchor_key, 0)
            anchor_counters[anchor_key] = seq + 1
            oo = _order_of(master_rows)

            if anchor is not None and (st, anchor) in oo:
                new_order = oo[(st, anchor)] + 0.001 * (seq + 1)
            elif anchor is not None:
                new_order = 9999.0 + seq
            else:
                new_order = -1.0 + 0.001 * seq

            label, depth = _meta_for_concept(workbooks, st, concept)
            src = facts[0].source_file
            master_rows.append(
                MasterRow(
                    statement_type=st,
                    canonical_row_id=canon,
                    master_raw_concept=canon,
                    display_label=label,
                    display_order=new_order,
                    depth=depth,
                )
            )
            concept_map.append(
                ConceptMapping(
                    statement_type=st,
                    raw_concept=concept,
                    canonical_row_id=canon,
                    mapping_status="coverage_integrated",
                    notes=f"Coverage pass — positioned after {anchor!r} — source {src}",
                )
            )
            cmap[(st, concept)] = canon
            existing_keys.add((st, canon))
            new_rows += 1
            _renumber_display_order(master_rows)

        # Merge values (most recent file wins), per period
        by_period: dict[str, list[UnresolvedRow]] = defaultdict(list)
        for u in facts:
            pp = parse_period(u.period_label)
            if pp is None or u.value is None:
                continue
            by_period[pp.canonical].append(u)

        label_map = {(r.statement_type, r.canonical_row_id): r.display_label for r in master_rows}
        disp = label_map.get((st, canon), canon)

        for pl, ufacts in by_period.items():
            winner = max(
                ufacts,
                key=lambda u: (file_recency.get(u.source_file, 0), u.source_file),
            )
            _ensure_cell(consolidated, st, canon, pl)
            cur = consolidated[st][canon].get(pl)
            if cur is not None:
                continue
            consolidated[st][canon][pl] = winner.value
            new_cells += 1
            audit_entries.append(
                AuditEntry(
                    statement_type=st,
                    canonical_row_id=canon,
                    master_display_label=disp,
                    output_period=pl,
                    value=winner.value,
                    source_file=winner.source_file,
                    source_sheet=winner.source_sheet,
                    source_column=winner.period_label,
                    raw_line_label=winner.line_label,
                    raw_concept=winner.concept,
                    source_method="coverage_integrated",
                    derivation_formula="Integrated from unresolved queue by coverage pass",
                )
            )

    return remaining, new_rows, new_cells


def apply_coverage_pass(
    workbooks: list[WorkbookInfo],
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    consolidated: ConsolidatedData,
    file_recency: dict[str, int],
    mapped_facts: list[MappedFact],
    unresolved: list[UnresolvedRow],
    audit_entries: list[AuditEntry],
) -> tuple[list[UnresolvedRow], CoveragePassResult]:
    """
    Mutates *consolidated*, *master_rows*, *concept_map*, and *audit_entries* in place.
    Returns updated unresolved list and stats.

    Order:
      1. Repair cells from ``mapped_facts`` where consolidated dropped a value.
      2. **Row-order registry** — every concept on a statement sheet's row list
         gets a map entry even if sparse-column filtering removed all facts.
      3. **Explicit workbook scan** — every (statement, raw concept) with numeric
         facts must appear in the map; add missing rows + values.
      4. Integrate legacy ``unresolved`` queue (same positioning rules).
      5. **Final workbook fill** — for every mapped fact in the workbooks, ensure
         the consolidated (canon, period) cell is populated if still empty.
    """
    res = CoveragePassResult()
    groups = _group_facts_by_statement_concept(workbooks)

    res.repaired_mapped_cells = repair_mapped_gaps(
        consolidated, mapped_facts, file_recency, master_rows, audit_entries
    )
    if res.repaired_mapped_cells:
        logger.info("Coverage: repaired %d mapped gaps", res.repaired_mapped_cells)

    res.row_order_registry_rows = register_row_order_concepts_not_in_map(
        workbooks, master_rows, concept_map
    )

    er, ec = integrate_workbook_concepts_not_in_map(
        groups, workbooks, master_rows, concept_map, consolidated, file_recency, audit_entries
    )
    res.explicit_workbook_rows = er
    res.explicit_workbook_cells = ec
    if er or ec:
        logger.info(
            "Coverage: explicit workbook scan added %d rows, %d cells",
            er,
            ec,
        )

    unresolved = _prune_unresolved_after_map(unresolved, concept_map)

    new_unresolved, rrows, rcells = integrate_unresolved_facts(
        workbooks,
        master_rows,
        concept_map,
        consolidated,
        file_recency,
        unresolved,
        audit_entries,
    )
    res.integrated_unresolved_rows = rrows
    res.integrated_unresolved_cells = rcells
    new_unresolved = _prune_unresolved_after_map(new_unresolved, concept_map)
    if rrows or rcells:
        logger.info(
            "Coverage: integrated %d unresolved rows, %d cells",
            rrows,
            rcells,
        )

    res.workbook_fact_gap_fills = fill_consolidated_gaps_from_workbook_groups(
        groups, concept_map, consolidated, file_recency, master_rows, audit_entries
    )
    if res.workbook_fact_gap_fills:
        logger.info(
            "Coverage: workbook fact scan filled %d empty cells",
            res.workbook_fact_gap_fills,
        )

    return new_unresolved, res
