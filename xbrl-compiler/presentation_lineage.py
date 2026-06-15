"""Forward presentation lineage — quarter-by-quarter evolution of face lines.

Walks workbooks **oldest headline period → newest**, tracking how labels and XBRL
concepts evolve. Merges tag renames onto one canonical row; keeps separate rows
when the same filing shows the same QName on multiple face lines (``@R`` slots).

Produces the same ``(master_rows, concept_map)`` shape as ``build_master_presentation``.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field

from headline_periods import headline_periods_for_workbook
from master_presentation_builder import (
    ConceptMapping,
    MasterRow,
    _extract_local_name,
    _labels_similar_for_merge,
    _normalize_label,
    _renumber_display_order,
)
from period_parser import parse_period
from workbook_loader import WorkbookInfo

logger = logging.getLogger(__name__)


def _headline_sort_key(wb: WorkbookInfo) -> tuple[int, int]:
    headlines = headline_periods_for_workbook(wb)
    keys: list[tuple[int, int]] = []
    for label in headlines:
        p = parse_period(label)
        if p is not None:
            keys.append(p.sort_key)
    return max(keys) if keys else (0, 0)


def workbooks_for_forward_walk(all_workbooks: list[WorkbookInfo]) -> list[WorkbookInfo]:
    """Each workbook once, ordered oldest primary headline → newest."""
    return sorted(all_workbooks, key=_headline_sort_key)


def _concept_local_norm(concept: str) -> str:
    loc = _extract_local_name(concept)
    return re.sub(r"[^a-zA-Z0-9]", "", loc).lower()


def _prefix_alias(concept_a: str, concept_b: str) -> bool:
    na, nb = _concept_local_norm(concept_a), _concept_local_norm(concept_b)
    if na == nb:
        return True
    shorter, longer = (na, nb) if len(na) <= len(nb) else (nb, na)
    return len(shorter) >= 10 and longer.startswith(shorter)


@dataclass
class _StmtState:
    rows: dict[str, MasterRow] = field(default_factory=dict)
    concept_to_canon: dict[tuple[str, str], str] = field(default_factory=dict)
    norm_label_to_canons: dict[tuple[str, str], list[str]] = field(default_factory=dict)
    maps: list[ConceptMapping] = field(default_factory=list)
    order_seq: float = 0.0

    def row_list(self) -> list[MasterRow]:
        return sorted(self.rows.values(), key=lambda r: r.display_order)


@dataclass
class LineageBuildStats:
    workbooks_walked: int = 0
    concept_mappings: int = 0
    new_rows: int = 0
    label_aliases: int = 0
    prefix_aliases: int = 0
    fuzzy_aliases: int = 0


def _duplicate_label_groups(sheet) -> dict[tuple[str, str, int], list[str]]:
    """Concepts in one sheet that share normalized label + depth (co-occurring duplicates)."""
    groups: dict[tuple[str, str, int], list[str]] = defaultdict(list)
    st = sheet.statement_type
    for concept in sheet.row_order:
        if not concept:
            continue
        label = sheet.concept_to_line.get(concept, "")
        norm = _normalize_label(label)
        if not norm:
            continue
        depth = sheet.concept_to_depth.get(concept, 0)
        groups[(st, norm, depth)].append(concept)
    return {k: v for k, v in groups.items() if len(v) > 1}


def _register_norm_label(state: _StmtState, st: str, norm: str, canon: str) -> None:
    key = (st, norm)
    lst = state.norm_label_to_canons.setdefault(key, [])
    if canon not in lst:
        lst.append(canon)


def _add_mapping(
    state: _StmtState,
    st: str,
    raw_concept: str,
    canon: str,
    status: str,
    notes: str,
    stats: LineageBuildStats,
) -> None:
    key = (st, raw_concept)
    if key in state.concept_to_canon:
        return
    state.concept_to_canon[key] = canon
    state.maps.append(
        ConceptMapping(
            statement_type=st,
            raw_concept=raw_concept,
            canonical_row_id=canon,
            mapping_status=status,
            notes=notes,
        )
    )
    stats.concept_mappings += 1
    if status == "lineage_label_alias":
        stats.label_aliases += 1
    elif status == "lineage_prefix_alias":
        stats.prefix_aliases += 1
    elif status == "lineage_fuzzy_label":
        stats.fuzzy_aliases += 1


def _insert_order_after_anchor(state: _StmtState, anchor: str | None) -> float:
    if anchor and anchor in state.rows:
        base = state.rows[anchor].display_order
        state.order_seq = max(state.order_seq, base + 0.001)
        return state.order_seq
    state.order_seq += 1.0
    return state.order_seq


def _resolve_canonical(
    state: _StmtState,
    st: str,
    concept: str,
    label: str,
    depth: int,
    wb: WorkbookInfo,
    dup_groups: dict[tuple[str, str, int], list[str]],
    row_order: list[str],
    row_index: int,
    stats: LineageBuildStats,
) -> str:
    key = (st, concept)
    if key in state.concept_to_canon:
        return state.concept_to_canon[key]

    norm = _normalize_label(label)
    base_concept = concept.split("@R")[0]
    co_qname_dup = sum(1 for c in row_order if c.split("@R")[0] == base_concept) > 1
    in_dup_group = norm and any(
        concept in grp for grp in dup_groups.values()
    )
    allow_label_merge = not in_dup_group and not co_qname_dup

    # Label match — same face line, tag rename across time.
    if norm and allow_label_merge:
        candidates = [
            c
            for c in state.norm_label_to_canons.get((st, norm), [])
            if state.rows[c].depth == depth
        ]
        if len(candidates) == 1:
            canon = candidates[0]
            _add_mapping(
                state,
                st,
                concept,
                canon,
                "lineage_label_alias",
                f"Label '{norm}' matched existing {canon} (from {wb.filename})",
                stats,
            )
            return canon
        if len(candidates) > 1:
            for cand in candidates:
                if _prefix_alias(concept, cand):
                    _add_mapping(
                        state,
                        st,
                        concept,
                        cand,
                        "lineage_prefix_alias",
                        f"Prefix alias {concept} → {cand} (from {wb.filename})",
                        stats,
                    )
                    return cand

    # Prefix alias against all existing rows (tag extension without exact label norm).
    if allow_label_merge:
        for existing in state.row_list():
            if existing.depth != depth:
                continue
            if _prefix_alias(concept, existing.canonical_row_id):
                if norm and _normalize_label(existing.display_label) == norm:
                    _add_mapping(
                        state,
                        st,
                        concept,
                        existing.canonical_row_id,
                        "lineage_prefix_alias",
                        f"Prefix + label alias {concept} → {existing.canonical_row_id} "
                        f"(from {wb.filename})",
                        stats,
                    )
                    return existing.canonical_row_id

    # Fuzzy label (IS/CF).
    if st != "balance_sheet" and label and allow_label_merge:
        for existing in state.row_list():
            if existing.depth != depth:
                continue
            if _labels_similar_for_merge(label, existing.display_label):
                _add_mapping(
                    state,
                    st,
                    concept,
                    existing.canonical_row_id,
                    "lineage_fuzzy_label",
                    f"Fuzzy label → {existing.canonical_row_id} (from {wb.filename})",
                    stats,
                )
                return existing.canonical_row_id

    # New canonical row — co-occurring duplicate QNames keep separate ``@R`` ids.
    canon = concept
    anchor: str | None = None
    for prev in reversed(row_order[:row_index]):
        if not prev:
            continue
        pk = (st, prev)
        if pk in state.concept_to_canon:
            anchor = state.concept_to_canon[pk]
            break

    order = _insert_order_after_anchor(state, anchor)
    display = label or concept
    state.rows[canon] = MasterRow(
        statement_type=st,
        canonical_row_id=canon,
        master_raw_concept=concept,
        display_label=display,
        display_order=order,
        depth=depth,
    )
    _add_mapping(
        state,
        st,
        concept,
        canon,
        "lineage_new_row",
        f"New row from forward walk ({wb.filename})",
        stats,
    )
    if norm:
        _register_norm_label(state, st, norm, canon)
    stats.new_rows += 1
    return canon


def _anchor_display_orders_to_master_10k(
    states: dict[str, _StmtState],
    master_wb: WorkbookInfo,
) -> None:
    """Prefer latest 10-K row order for rows that appear on the master filing."""
    for sheet in master_wb.sheets:
        st = sheet.statement_type
        state = states.get(st)
        if state is None:
            continue
        for idx, concept in enumerate(sheet.row_order):
            if not concept:
                continue
            key = (st, concept)
            canon = state.concept_to_canon.get(key, concept)
            if canon in state.rows:
                state.rows[canon].display_order = float(idx)
                state.rows[canon].display_label = (
                    sheet.concept_to_line.get(concept, state.rows[canon].display_label)
                )


def _pick_canon_representative(canon_ids: list[str], master_wb: WorkbookInfo | None) -> str:
    """Prefer latest-10-K concept, else longest local name."""
    master_concepts: set[str] = set()
    if master_wb:
        for sh in master_wb.sheets:
            master_concepts.update(sh.row_order)

    def score(c: str) -> tuple[int, int, int, str]:
        on_master = 1 if c in master_concepts else 0
        gaap = 1 if c.startswith("us-gaap:") else 0
        return (on_master, gaap, len(_concept_local_norm(c)), c)

    return max(canon_ids, key=score)


def _collapse_same_label_rows(
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    master_wb: WorkbookInfo,
) -> int:
    """
    Merge canonical rows that share normalized label + depth (tag-rename duplicates).
    Returns number of rows removed.
    """
    by_label: dict[tuple[str, str, int], list[str]] = defaultdict(list)
    for r in master_rows:
        norm = _normalize_label(r.display_label or "")
        if not norm:
            continue
        by_label[(r.statement_type, norm, r.depth)].append(r.canonical_row_id)

    drop_to_keep: dict[tuple[str, str], str] = {}
    ambiguous = frozenset({"other", "other net"})
    for (st, norm, _depth), canon_list in by_label.items():
        if norm in ambiguous:
            continue
        uniq = sorted(set(canon_list))
        if len(uniq) < 2:
            continue
        keep = _pick_canon_representative(uniq, master_wb)
        safe = True
        for drop in uniq:
            if drop == keep:
                continue
            raws = [
                m.raw_concept
                for m in concept_map
                if m.statement_type == st and m.canonical_row_id == drop
            ]
            if not raws:
                continue
            if not all(_prefix_alias(raw, keep) for raw in raws):
                safe = False
                break
        if not safe:
            continue
        for drop in uniq:
            if drop != keep:
                drop_to_keep[(st, drop)] = keep

    if not drop_to_keep:
        return 0

    for m in concept_map:
        key = (m.statement_type, m.canonical_row_id)
        if key in drop_to_keep:
            m.canonical_row_id = drop_to_keep[key]
            m.notes = f"{m.notes}; lineage_collapse_same_label→{drop_to_keep[key]}"

    removed = 0
    kept_ids: set[tuple[str, str]] = set()
    new_rows: list[MasterRow] = []
    for r in master_rows:
        key = (r.statement_type, r.canonical_row_id)
        if key in drop_to_keep:
            removed += 1
            continue
        if key in kept_ids:
            continue
        kept_ids.add(key)
        new_rows.append(r)

    master_rows[:] = new_rows
    return removed


def build_presentation_lineage(
    master_wb: WorkbookInfo,
    all_workbooks: list[WorkbookInfo],
) -> tuple[list[MasterRow], list[ConceptMapping], LineageBuildStats]:
    """
    Build master rows + concept map by walking filings oldest → newest.

    ``master_wb`` is used only to anchor final display order / labels to the latest 10-K.
    """
    stats = LineageBuildStats()
    states: dict[str, _StmtState] = {
        "income_statement": _StmtState(),
        "balance_sheet": _StmtState(),
        "cash_flow": _StmtState(),
    }

    ordered = workbooks_for_forward_walk(all_workbooks)
    stats.workbooks_walked = len(ordered)

    for wb in ordered:
        headlines = sorted(headline_periods_for_workbook(wb))
        logger.debug(
            "Lineage forward step: %s headline=%s",
            wb.filename,
            headlines,
        )
        for sheet in wb.sheets:
            st = sheet.statement_type
            state = states.get(st)
            if state is None:
                continue
            dup_groups = _duplicate_label_groups(sheet)
            for row_index, concept in enumerate(sheet.row_order):
                if not concept:
                    continue
                label = sheet.concept_to_line.get(concept, "")
                depth = sheet.concept_to_depth.get(concept, 0)
                _resolve_canonical(
                    state,
                    st,
                    concept,
                    label,
                    depth,
                    wb,
                    dup_groups,
                    sheet.row_order,
                    row_index,
                    stats,
                )

    _anchor_display_orders_to_master_10k(states, master_wb)

    master_rows: list[MasterRow] = []
    concept_map: list[ConceptMapping] = []
    for state in states.values():
        master_rows.extend(state.row_list())
        concept_map.extend(state.maps)

    collapsed = _collapse_same_label_rows(master_rows, concept_map, master_wb)
    if collapsed:
        logger.info("Lineage collapsed %d same-label duplicate canonical rows", collapsed)

    _renumber_display_order(master_rows)

    logger.info(
        "Presentation lineage: %d workbooks, %d rows, %d mappings "
        "(%d label aliases, %d prefix aliases, %d fuzzy, %d new rows)",
        stats.workbooks_walked,
        len(master_rows),
        len(concept_map),
        stats.label_aliases,
        stats.prefix_aliases,
        stats.fuzzy_aliases,
        stats.new_rows,
    )
    return master_rows, concept_map, stats
