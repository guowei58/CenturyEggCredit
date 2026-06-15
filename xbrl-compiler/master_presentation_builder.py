"""Build master presentation layout + concept-to-row map.

The latest 10-K defines the **layout skeleton** (row order, display labels, depth).

Historical filings are merged **newest headline period → oldest**:

  Phase 1 – latest 10-K seeds canonical rows (identity + labels + order).
  For each older workbook, ordered by its newest headline quarter/FY (backwards):
    Phase 2 – deterministic matching (local-name + normalized-label).
    Phase 3 – AI reconciliation for that filing's unmatched concepts (optional).
  Phase 4 – fallback: append new rows next to anchors.

The canonical row registry is **append-only** for the entire build: Phase 1 seeds
rows; each workbook pass (Phases 2–4) may only add rows and concept mappings.
No step removes or replaces an existing ``(statement_type, canonical_row_id)``.
After each workbook, runtime checks enforce ``keys_before ⊆ keys_after``.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from headline_periods import headline_periods_for_workbook
from period_parser import parse_period
from workbook_loader import WorkbookInfo

logger = logging.getLogger(__name__)


# ── Data classes ──────────────────────────────────────────────────────────

@dataclass
class MasterRow:
    statement_type: str
    canonical_row_id: str      # stable row key (= concept from master)
    master_raw_concept: str    # concept as it appears in source
    display_label: str         # Line text (from master 10-K when available)
    display_order: float       # sequential position within its statement
    depth: int


@dataclass
class ConceptMapping:
    statement_type: str
    raw_concept: str
    canonical_row_id: str
    mapping_status: str        # auto_from_master | auto_local_name | auto_label_match | ai_matched | auto_from_filing
    notes: str


@dataclass
class _UnmatchedItem:
    statement_type: str
    concept: str
    label: str
    depth: int
    source_file: str
    anchor_canon: str | None     # canonical_row_id of nearest preceding mapped concept


@dataclass
class _MatchState:
    seen: set[tuple[str, str]] = field(default_factory=set)
    concept_to_canon: dict[tuple[str, str], str] = field(default_factory=dict)
    matched_local: int = 0
    matched_label: int = 0
    matched_ai: int = 0
    new_rows: int = 0


# ── Deterministic matching helpers ────────────────────────────────────────

def _extract_local_name(concept: str) -> str:
    """Strip namespace prefix, returning only the local part of a QName."""
    if "://" in concept:
        return concept.rsplit("/", 1)[1]
    if ":" in concept:
        return concept.rsplit(":", 1)[1]
    if "/" in concept:
        return concept.rsplit("/", 1)[1]
    return concept


_IRREGULAR_PLURALS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bliabilities\b"),  "liability"),
    (re.compile(r"\bactivities\b"),   "activity"),
    (re.compile(r"\bsecurities\b"),   "security"),
    (re.compile(r"\bsubsidiaries\b"), "subsidiary"),
    (re.compile(r"\bcategories\b"),   "category"),
    (re.compile(r"\binventories\b"),  "inventory"),
    (re.compile(r"\btaxes\b"),        "tax"),
    (re.compile(r"\blosses\b"),       "loss"),
]

_IES_RE = re.compile(r"\b(\w{2,})ies\b")
_TRAILING_S_RE = re.compile(r"\b(\w{3,}[^sui])s\b")

_CONDENSER_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^(?:aggregate\s+)?amount\s+of\s+", re.I), ""),
    (re.compile(r",?\s*net\s+of\s+(?:income\s+)?tax(?:es)?\s*,?", re.I), " "),
    (re.compile(
        r"before\s+(?:addition|deduction)\s+(?:of|for)\s+"
        r"(?:income\s+(?:from\s+)?)?",
        re.I,
    ), "before "),
    (re.compile(
        r"after\s+(?:addition|deduction)\s+(?:of|for)\s+"
        r"(?:income\s+(?:from\s+)?)?",
        re.I,
    ), "after "),
    (re.compile(r",?\s*including\s+(?:accretion|amortization)\b[^,]*,?", re.I), " "),
]


def _label_token_set(label: str) -> frozenset[str]:
    norm = _normalize_label(label)
    return frozenset(w for w in norm.split() if w)


_CAMEL_SPLIT_RE = re.compile(r"([a-z0-9])([A-Z])")


def _concept_local_tokens(concept: str) -> frozenset[str]:
    """Tokenize a concept's local name (CamelCase / underscores) for alignment checks."""
    local = _extract_local_name(concept)
    spaced = _CAMEL_SPLIT_RE.sub(r"\1 \2", local).replace("_", " ")
    norm = _normalize_label(spaced)
    return frozenset(w for w in norm.split() if w)


def _bs_norm_label_match_allowed(
    raw_concept: str,
    raw_label: str,
    master_canonical_row_id: str,
    master_display_label: str,
) -> bool:
    """
    Conservative balance-sheet label match guard.

    Requires the filing concept's tag tokens to overlap its own face label
    (reject mislabeled rows like OtherIntangible tagged with line text "Goodwill"),
    then requires overlap with the master row's tag or label tokens.
    """
    raw_label_tokens = _label_token_set(raw_label)
    raw_concept_tokens = _concept_local_tokens(raw_concept)
    if not raw_label_tokens or not raw_concept_tokens:
        return False
    if not (raw_concept_tokens & raw_label_tokens):
        return False
    master_concept_tokens = _concept_local_tokens(master_canonical_row_id)
    master_label_tokens = _label_token_set(master_display_label)
    if raw_concept_tokens & master_concept_tokens:
        return True
    return bool(raw_concept_tokens & master_label_tokens)


def _resolve_norm_label_match(
    st: str,
    concept: str,
    raw_label: str,
    depth: int,
    norm: str,
    norm_label_lists: dict[tuple[str, str], list[str]],
    label_occurrence: dict[tuple[str, str], int],
    master_rows: list[MasterRow],
) -> str | None:
    """Exact normalized-label match. Balance sheet uses extra safety guards; no fuzzy."""
    candidates = norm_label_lists.get((st, norm), [])
    if not candidates:
        return None

    if st == "balance_sheet":
        rows_by_canon = {
            r.canonical_row_id: r for r in master_rows if r.statement_type == st
        }
        safe: list[str] = []
        for canon in candidates:
            row = rows_by_canon.get(canon)
            if row is None or row.depth != depth:
                continue
            if _bs_norm_label_match_allowed(
                concept, raw_label, canon, row.display_label
            ):
                safe.append(canon)
        return safe[0] if len(safe) == 1 else None

    matched_canon: str | None = None
    if len(candidates) == 1:
        matched_canon = candidates[0]
    elif len(candidates) > 1:
        occ = label_occurrence.get((st, norm), 0)
        label_occurrence[(st, norm)] = occ + 1
        matched_canon = candidates[min(occ, len(candidates) - 1)]
    return matched_canon


def _labels_similar_for_merge(a: str, b: str) -> bool:
    """Fuzzy label match for IS/CF (e.g. restructuring line wording drift across filings)."""
    ta, tb = _label_token_set(a), _label_token_set(b)
    if not ta or not tb:
        return False
    if ta == tb:
        return True
    if ta.issubset(tb) or tb.issubset(ta):
        return True
    inter = len(ta & tb)
    union = len(ta | tb)
    return union > 0 and inter / union >= 0.58


def _normalize_label(label: str) -> str:
    """Deterministic label normalization for matching."""
    s = label.lower().strip()
    s = re.sub(r"\([^)]*\)", "", s)
    s = s.replace("&", " and ")
    for pat, repl in _CONDENSER_RULES:
        s = pat.sub(repl, s)
    for pat, repl in _IRREGULAR_PLURALS:
        s = pat.sub(repl, s)
    s = _IES_RE.sub(r"\1y", s)
    s = _TRAILING_S_RE.sub(r"\1", s)
    s = re.sub(r"^total\s+", "", s)
    s = re.sub(r"[,;:]+\s*$", "", s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _renumber_display_order(rows: list[MasterRow]) -> None:
    """Re-assign integer display_order values per statement type after sorting."""
    by_stmt: dict[str, list[MasterRow]] = {}
    for r in rows:
        by_stmt.setdefault(r.statement_type, []).append(r)
    for stmt_rows in by_stmt.values():
        stmt_rows.sort(key=lambda r: r.display_order)
        for i, r in enumerate(stmt_rows):
            r.display_order = i


def _assert_registry_monotonic(
    keys_before: set[tuple[str, str]],
    keys_after: set[tuple[str, str]],
    *,
    context: str,
) -> None:
    """Raise if any canonical row present before ``context`` was removed."""
    if not keys_before.issubset(keys_after):
        lost = keys_before - keys_after
        sample = sorted(lost)[:5]
        raise RuntimeError(
            f"Canonical row registry shrank during {context} — "
            f"{len(lost)} row(s) removed (e.g. {sample!r}); append-only invariant violated"
        )


def _master_row_keys(rows: list[MasterRow]) -> set[tuple[str, str]]:
    return {(r.statement_type, r.canonical_row_id) for r in rows}


def _newest_headline_sort_key(wb: WorkbookInfo) -> tuple[int, int]:
    """Sort key for backwards walk: newest headline period on this workbook."""
    headlines = headline_periods_for_workbook(wb)
    keys: list[tuple[int, int]] = []
    for label in headlines:
        p = parse_period(label)
        if p is not None:
            keys.append(p.sort_key)
    return max(keys) if keys else (0, 0)


def workbooks_for_backwards_walk(
    all_workbooks: list[WorkbookInfo],
    master_wb: WorkbookInfo,
) -> list[WorkbookInfo]:
    """
    Order non-master workbooks newest headline period first (FY/4Q → … → oldest quarter).

    Each workbook appears once, at the step corresponding to its newest face period.
    """
    others = [w for w in all_workbooks if w.filename != master_wb.filename]
    return sorted(others, key=_newest_headline_sort_key, reverse=True)


def build_backwards_timeline(
    all_workbooks: list[WorkbookInfo],
    master_wb: WorkbookInfo,
) -> list[tuple[str, list[WorkbookInfo]]]:
    """
    Timeline of headline periods newest → oldest, with workbooks that headline each period.

    Used for logging/diagnostics. Processing uses ``workbooks_for_backwards_walk`` so
    each filing is handled once at its newest headline step.
    """
    period_to_wbs: dict[str, list[WorkbookInfo]] = {}
    for wb in all_workbooks:
        if wb.filename == master_wb.filename:
            continue
        for pl in headline_periods_for_workbook(wb):
            period_to_wbs.setdefault(pl, []).append(wb)

    def _period_sort(pl: str) -> tuple[int, int]:
        p = parse_period(pl)
        return p.sort_key if p is not None else (0, 0)

    ordered = sorted(period_to_wbs.keys(), key=_period_sort, reverse=True)
    return [(pl, period_to_wbs[pl]) for pl in ordered]


def _build_match_indices(
    master_rows: list[MasterRow],
) -> tuple[dict[tuple[str, str], str], dict[tuple[str, str], list[str]]]:
    local_name_idx: dict[tuple[str, str], str] = {}
    norm_label_lists: dict[tuple[str, str], list[str]] = {}

    for row in sorted(master_rows, key=lambda r: r.display_order):
        local = _extract_local_name(row.canonical_row_id)
        lk = (row.statement_type, local)
        if lk not in local_name_idx:
            local_name_idx[lk] = row.canonical_row_id

        norm = _normalize_label(row.display_label)
        if norm:
            norm_label_lists.setdefault((row.statement_type, norm), []).append(
                row.canonical_row_id
            )

    return local_name_idx, norm_label_lists


def _seed_phase1_master(
    master_wb: WorkbookInfo,
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    state: _MatchState,
) -> int:
    """Phase 1: seed rows + identity map from latest 10-K."""
    count = 0
    for sheet in master_wb.sheets:
        for idx, concept in enumerate(sheet.row_order):
            if not concept:
                continue
            key = (sheet.statement_type, concept)
            if key in state.seen:
                continue
            state.seen.add(key)

            label = sheet.concept_to_line.get(concept, concept)
            depth = sheet.concept_to_depth.get(concept, 0)

            master_rows.append(MasterRow(
                statement_type=sheet.statement_type,
                canonical_row_id=concept,
                master_raw_concept=concept,
                display_label=label,
                display_order=idx,
                depth=depth,
            ))
            concept_map.append(ConceptMapping(
                statement_type=sheet.statement_type,
                raw_concept=concept,
                canonical_row_id=concept,
                mapping_status="auto_from_master",
                notes=f"Seeded from master 10-K: {master_wb.filename}",
            ))
            state.concept_to_canon[key] = concept
            count += 1
    return count


def _match_workbook_phase2(
    wb: WorkbookInfo,
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    state: _MatchState,
    local_name_idx: dict[tuple[str, str], str],
    norm_label_lists: dict[tuple[str, str], list[str]],
) -> list[_UnmatchedItem]:
    """Deterministic match for one workbook's row_order; return still-unmatched items."""
    still_unmatched: list[_UnmatchedItem] = []

    for sheet in wb.sheets:
        st = sheet.statement_type
        last_mapped_canon: str | None = None
        label_occurrence: dict[tuple[str, str], int] = {}

        for concept in sheet.row_order:
            if not concept:
                continue
            key = (st, concept)

            if key in state.seen:
                last_mapped_canon = state.concept_to_canon.get(key, concept)
                continue

            state.seen.add(key)

            local = _extract_local_name(concept)
            canon = local_name_idx.get((st, local))
            if canon is not None:
                concept_map.append(ConceptMapping(
                    statement_type=st,
                    raw_concept=concept,
                    canonical_row_id=canon,
                    mapping_status="auto_local_name",
                    notes=f"Local name '{local}' matched master {canon} (from {wb.filename})",
                ))
                state.concept_to_canon[key] = canon
                last_mapped_canon = canon
                state.matched_local += 1
                continue

            raw_label = sheet.concept_to_line.get(concept, "")
            depth = sheet.concept_to_depth.get(concept, 0)
            if raw_label:
                norm = _normalize_label(raw_label)
                if norm:
                    matched_canon = _resolve_norm_label_match(
                        st,
                        concept,
                        raw_label,
                        depth,
                        norm,
                        norm_label_lists,
                        label_occurrence,
                        master_rows,
                    )
                    if matched_canon is not None:
                        note_prefix = (
                            "BS normalized label"
                            if st == "balance_sheet"
                            else "Normalized label"
                        )
                        concept_map.append(ConceptMapping(
                            statement_type=st,
                            raw_concept=concept,
                            canonical_row_id=matched_canon,
                            mapping_status="auto_label_match",
                            notes=(
                                f"{note_prefix} '{norm}' matched master {matched_canon} "
                                f"(from {wb.filename})"
                            ),
                        ))
                        state.concept_to_canon[key] = matched_canon
                        last_mapped_canon = matched_canon
                        state.matched_label += 1
                        continue
                    if st != "balance_sheet":
                        for row in master_rows:
                            if row.statement_type != st:
                                continue
                            if depth != row.depth:
                                continue
                            if _labels_similar_for_merge(raw_label, row.display_label):
                                concept_map.append(ConceptMapping(
                                    statement_type=st,
                                    raw_concept=concept,
                                    canonical_row_id=row.canonical_row_id,
                                    mapping_status="auto_label_match",
                                    notes=(
                                        f"Fuzzy label match to {row.canonical_row_id} "
                                        f"(from {wb.filename})"
                                    ),
                                ))
                                state.concept_to_canon[key] = row.canonical_row_id
                                last_mapped_canon = row.canonical_row_id
                                state.matched_label += 1
                                break
                        if key in state.concept_to_canon:
                            continue

            label = raw_label or concept
            still_unmatched.append(_UnmatchedItem(
                statement_type=st,
                concept=concept,
                label=label,
                depth=depth,
                source_file=wb.filename,
                anchor_canon=last_mapped_canon,
            ))

    return still_unmatched


def _apply_phase3_ai(
    still_unmatched: list[_UnmatchedItem],
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    state: _MatchState,
    ai_provider: str | None,
    ai_api_key: str | None,
    ai_model: str | None,
) -> list[_UnmatchedItem]:
    if not still_unmatched or not ai_provider:
        return still_unmatched

    try:
        import ai_matcher as _aim

        master_dicts = [
            {"statement_type": r.statement_type,
             "canonical_row_id": r.canonical_row_id,
             "display_label": r.display_label}
            for r in master_rows
        ]
        um_objs = [
            _aim.UnmatchedConcept(it.statement_type, it.concept, it.label)
            for it in still_unmatched
        ]

        ai_results = _aim.ai_match_concepts(
            master_dicts, um_objs,
            provider=ai_provider,
            api_key=ai_api_key,
            model=ai_model,
        )

        ai_map: dict[tuple[str, str], str] = {}
        for r in ai_results:
            if r.canonical_row_id is not None:
                ai_map[(r.statement_type, r.raw_concept)] = r.canonical_row_id

        remaining: list[_UnmatchedItem] = []
        for item in still_unmatched:
            canon = ai_map.get((item.statement_type, item.concept))
            if canon is not None:
                concept_map.append(ConceptMapping(
                    statement_type=item.statement_type,
                    raw_concept=item.concept,
                    canonical_row_id=canon,
                    mapping_status="ai_matched",
                    notes=f"AI matched to {canon} (from {item.source_file})",
                ))
                state.concept_to_canon[(item.statement_type, item.concept)] = canon
                state.matched_ai += 1
            else:
                remaining.append(item)

        return remaining
    except Exception as exc:
        logger.error("Phase 3 AI matching failed: %s — proceeding without AI", exc)
        return still_unmatched


def _is_html_synthetic_concept(concept: str) -> bool:
    return (concept or "").strip().startswith("html:")


def _try_map_html_concept_to_master(
    item: _UnmatchedItem,
    master_rows: list[MasterRow],
    norm_label_lists: dict[tuple[str, str], list[str]],
) -> str | None:
    """
    Map ``html:`` slugs onto an existing master row by normalized face label.

    Phase 2 may miss edge cases; Phase 4 should not mint duplicate canonical rows
    when the label already exists on the master presentation.
    """
    if not _is_html_synthetic_concept(item.concept) or not item.label:
        return None
    norm = _normalize_label(item.label)
    if not norm:
        return None

    matched = _resolve_norm_label_match(
        item.statement_type,
        item.concept,
        item.label,
        item.depth,
        norm,
        norm_label_lists,
        {},
        master_rows,
    )
    if matched is not None:
        return matched

    if item.statement_type == "balance_sheet":
        return None

    matches = [
        r.canonical_row_id
        for r in master_rows
        if r.statement_type == item.statement_type
        and r.depth == item.depth
        and _normalize_label(r.display_label) == norm
    ]
    return matches[0] if len(matches) == 1 else None


def _apply_phase4_fallback(
    still_unmatched: list[_UnmatchedItem],
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    state: _MatchState,
    norm_label_lists: dict[tuple[str, str], list[str]],
) -> None:
    """Append unmatched concepts as new master rows (monotonic growth — no deletions)."""
    if not still_unmatched:
        return

    before_keys = _master_row_keys(master_rows)
    order_of: dict[tuple[str, str], float] = {
        (r.statement_type, r.canonical_row_id): r.display_order
        for r in master_rows
    }
    anchor_counters: dict[tuple[str, str | None], int] = {}

    for item in still_unmatched:
        html_canon = _try_map_html_concept_to_master(item, master_rows, norm_label_lists)
        if html_canon is not None:
            norm = _normalize_label(item.label)
            concept_map.append(ConceptMapping(
                statement_type=item.statement_type,
                raw_concept=item.concept,
                canonical_row_id=html_canon,
                mapping_status="auto_label_match",
                notes=(
                    f"HTML concept merged to master {html_canon} "
                    f"via label '{norm}' (from {item.source_file})"
                ),
            ))
            state.concept_to_canon[(item.statement_type, item.concept)] = html_canon
            state.matched_label += 1
            continue

        anchor_key = (item.statement_type, item.anchor_canon)
        seq = anchor_counters.get(anchor_key, 0)
        anchor_counters[anchor_key] = seq + 1

        if item.anchor_canon is not None:
            anchor_order = order_of.get((item.statement_type, item.anchor_canon))
            if anchor_order is not None:
                new_order = anchor_order + 0.001 * (seq + 1)
            else:
                new_order = 9999.0 + seq
        else:
            new_order = -1.0 + 0.001 * seq

        master_rows.append(MasterRow(
            statement_type=item.statement_type,
            canonical_row_id=item.concept,
            master_raw_concept=item.concept,
            display_label=item.label,
            display_order=new_order,
            depth=item.depth,
        ))
        concept_map.append(ConceptMapping(
            statement_type=item.statement_type,
            raw_concept=item.concept,
            canonical_row_id=item.concept,
            mapping_status="auto_from_filing",
            notes=(
                f"Positioned after {item.anchor_canon} — added from {item.source_file}"
                if item.anchor_canon
                else f"No anchor — added from {item.source_file}"
            ),
        ))
        state.concept_to_canon[(item.statement_type, item.concept)] = item.concept
        state.new_rows += 1

    after_keys = _master_row_keys(master_rows)
    _assert_registry_monotonic(before_keys, after_keys, context="phase 4 fallback")


def _process_workbook_backwards_step(
    wb: WorkbookInfo,
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    state: _MatchState,
    local_name_idx: dict[tuple[str, str], str],
    norm_label_lists: dict[tuple[str, str], list[str]],
    ai_provider: str | None,
    ai_api_key: str | None,
    ai_model: str | None,
) -> None:
    """Run phases 2–4 for one workbook; refresh match indices after growth."""
    keys_before = _master_row_keys(master_rows)

    unmatched = _match_workbook_phase2(
        wb, master_rows, concept_map, state,
        local_name_idx, norm_label_lists,
    )
    unmatched = _apply_phase3_ai(
        unmatched, master_rows, concept_map, state,
        ai_provider, ai_api_key, ai_model,
    )
    _apply_phase4_fallback(unmatched, master_rows, concept_map, state, norm_label_lists)

    keys_after = _master_row_keys(master_rows)
    _assert_registry_monotonic(
        keys_before, keys_after, context=f"workbook {wb.filename}",
    )

    new_local, new_norm = _build_match_indices(master_rows)
    local_name_idx.clear()
    local_name_idx.update(new_local)
    norm_label_lists.clear()
    norm_label_lists.update(new_norm)


def build_master_presentation(
    master_wb: WorkbookInfo,
    all_workbooks: list[WorkbookInfo] | None = None,
    ai_provider: str | None = None,
    ai_api_key: str | None = None,
    ai_model: str | None = None,
) -> tuple[list[MasterRow], list[ConceptMapping]]:
    """
    Build the row registry and concept map.

    Phase 1 – latest 10-K seeds canonical rows (order + labels).
    Phases 2–4 – walk remaining workbooks **newest headline period → oldest**;
    each pass only appends rows / mappings (registry never shrinks).
    """
    master_rows: list[MasterRow] = []
    concept_map: list[ConceptMapping] = []
    state = _MatchState()

    master_count = _seed_phase1_master(master_wb, master_rows, concept_map, state)

    local_name_idx, norm_label_lists = _build_match_indices(master_rows)
    registry_snapshots: list[set[tuple[str, str]]] = [_master_row_keys(master_rows)]

    if all_workbooks:
        ordered_wbs = workbooks_for_backwards_walk(all_workbooks, master_wb)
        timeline = build_backwards_timeline(all_workbooks, master_wb)
        if timeline:
            logger.info(
                "Backwards presentation walk: %d workbook(s), %d headline period step(s)",
                len(ordered_wbs),
                len(timeline),
            )
        for wb in ordered_wbs:
            headline = sorted(headline_periods_for_workbook(wb))
            logger.debug(
                "Backwards step: %s  headline=%s",
                wb.filename,
                headline,
            )
            _process_workbook_backwards_step(
                wb, master_rows, concept_map, state,
                local_name_idx, norm_label_lists,
                ai_provider, ai_api_key, ai_model,
            )
            registry_snapshots.append(_master_row_keys(master_rows))

    final_keys = _master_row_keys(master_rows)
    for i, snap in enumerate(registry_snapshots):
        label = "phase 1" if i == 0 else f"workbook step {i}"
        _assert_registry_monotonic(snap, final_keys, context=f"final vs {label}")

    _renumber_display_order(master_rows)

    logger.info(
        "Master presentation: %d rows from 10-K, "
        "%d local-name, %d label, %d AI matches, %d new rows = %d total, "
        "%d concept mappings (backwards walk, monotonic growth)",
        master_count, state.matched_local, state.matched_label, state.matched_ai,
        state.new_rows, len(master_rows), len(concept_map),
    )
    return master_rows, concept_map
