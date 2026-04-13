"""Merge mapped facts into one value per (statement_type, canonical_row_id, period).

Two-stage aggregation:

  Stage 1 – **Within each source file**, if multiple *different* raw concepts
            map to the same canonical row + period, resolve as follows:

            0) For the **net-interest** canonical row (interest expense net of
               income), combine as **expense legs − income legs** before any
               other rule.

            a) If the **master concept** (the concept that *defines* the
               canonical row in the latest 10-K) is among the facts, use
               **only** that value.  It is the official subtotal and the
               other concepts are segment components that were mapped to
               the same row — summing them would double-count.

            b) If no master concept is present, but one fact's value equals
               the sum of all others (within rounding tolerance), treat it
               as a **subtotal** and use only that value.

            c) Otherwise **sum** them — they are genuine sub-components
               (e.g. "gain on asset sales" + "gain on business sales") that
               the master presentation merges into a single row.

  Stage 2 – **Across files**, if more than one file supplies a value for the
            same cell, the **most recent file wins** (highest ``file_recency``
            rank).  Identical duplicates are silently kept; differing values
            are logged to the conflicts list.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from row_mapper import MappedFact
from master_presentation_builder import MasterRow
from interest_netting import find_net_interest_canonical_row, try_aggregate_net_interest_row

logger = logging.getLogger(__name__)

# {stmt: {canonical_row_id: {period_label: value}}}
ConsolidatedData = dict[str, dict[str, dict[str, float | None]]]


@dataclass
class AuditEntry:
    statement_type: str
    canonical_row_id: str
    master_display_label: str
    output_period: str
    value: Any
    source_file: str
    source_sheet: str
    source_column: str
    raw_line_label: str
    raw_concept: str
    source_method: str           # reported | derived | copied_from_fy_for_bs | summed_within_file | interest_net
    derivation_formula: str = ""


@dataclass
class Conflict:
    statement_type: str
    canonical_row_id: str
    period: str
    values: list[tuple[Any, str, str, str, str]]  # (val, file, sheet, col, concept)
    resolution: str = ""


@dataclass
class _FileAggregate:
    """One file's contribution to a single (stmt, canonical_row_id, period) cell."""
    source_file: str
    value: float | None
    components: list[MappedFact]   # the individual facts that were summed
    was_summed: bool               # True if >1 different raw concepts were aggregated
    interest_derivation: str | None = None  # expense − income formula for net interest row


_SUM_TOL = 0.5  # rounding tolerance for subtotal detection


def _resolve_multi_concept(
    st: str, crid: str, plabel: str, src_file: str,
    non_null: list[MappedFact],
    master_concept: str | None,
) -> tuple[float, bool]:
    """Decide how to aggregate multiple raw concepts → one canonical cell.

    Returns ``(value, was_summed)``.
    """
    raw_concepts = {f.raw_concept for f in non_null}

    # ── Priority A: master concept present → use it (it's the official subtotal)
    if master_concept and master_concept in raw_concepts:
        master_facts = [f for f in non_null if f.raw_concept == master_concept]
        val = master_facts[0].value
        others = ", ".join(sorted(raw_concepts - {master_concept}))
        logger.info(
            "SUBTOTAL-MASTER: %s/%s/%s in %s — using master concept %s (=%s), "
            "discarding components: %s",
            st, crid, plabel, src_file, master_concept, val, others,
        )
        return val, False

    # ── Priority B: detect implicit subtotal (one value ≈ sum of the rest)
    if len(non_null) >= 2:
        total = sum(f.value for f in non_null)
        for candidate in non_null:
            rest_sum = total - candidate.value
            if abs(candidate.value - rest_sum) <= _SUM_TOL:
                others = ", ".join(
                    sorted({f.raw_concept for f in non_null if f is not candidate})
                )
                logger.info(
                    "SUBTOTAL-DETECTED: %s/%s/%s in %s — %s (=%s) ≈ sum of rest "
                    "(%s = %s), using subtotal value",
                    st, crid, plabel, src_file,
                    candidate.raw_concept, candidate.value, others, rest_sum,
                )
                return candidate.value, False

    # ── Priority C: no subtotal detected → genuine sub-components, sum them
    agg_val = sum(f.value for f in non_null)
    logger.info(
        "SUM-WITHIN-FILE: %s/%s/%s in %s — %d concepts (%s) summed to %s",
        st, crid, plabel, src_file, len(raw_concepts),
        ", ".join(sorted(raw_concepts)), agg_val,
    )
    return agg_val, True


def consolidate(
    mapped_facts: list[MappedFact],
    master_rows: list[MasterRow],
    file_recency: dict[str, int] | None = None,
) -> tuple[ConsolidatedData, list[AuditEntry], list[Conflict]]:
    """
    Merge all mapped facts.

    *file_recency* maps ``source_file`` → integer rank where **higher = more
    recent**.  When multiple files supply a value for the same cell the
    highest-ranked file always wins.
    """
    recency = file_recency or {}
    label_map: dict[tuple[str, str], str] = {
        (r.statement_type, r.canonical_row_id): r.display_label for r in master_rows
    }
    master_concept_map: dict[tuple[str, str], str] = {
        (r.statement_type, r.canonical_row_id): r.master_raw_concept
        for r in master_rows
    }

    net_interest_crid = find_net_interest_canonical_row(master_rows)

    data: ConsolidatedData = defaultdict(lambda: defaultdict(dict))
    audit: list[AuditEntry] = []
    conflicts: list[Conflict] = []

    # ── Stage 1: group by (stmt, canon, period, source_file)
    file_buckets: dict[
        tuple[str, str, str, str], list[MappedFact]
    ] = defaultdict(list)
    for mf in mapped_facts:
        file_buckets[
            (mf.statement_type, mf.canonical_row_id, mf.period.canonical, mf.source_file)
        ].append(mf)

    # Build per-file aggregates
    cell_aggregates: dict[
        tuple[str, str, str], list[_FileAggregate]
    ] = defaultdict(list)

    for (st, crid, plabel, src_file), facts in file_buckets.items():
        non_null = [f for f in facts if f.value is not None]
        raw_concepts = {f.raw_concept for f in facts}
        multiple_concepts = len(raw_concepts) > 1

        interest_derivation: str | None = None
        if not non_null:
            agg_val = None
            was_summed = False
        elif not multiple_concepts:
            agg_val = non_null[0].value
            was_summed = False
        else:
            net_try = try_aggregate_net_interest_row(
                non_null, crid, net_interest_crid,
            )
            if net_try is not None:
                agg_val, was_summed, net_note = net_try
                if net_note:
                    interest_derivation = net_note
            else:
                agg_val, was_summed = _resolve_multi_concept(
                    st, crid, plabel, src_file, non_null,
                    master_concept_map.get((st, crid)),
                )

        cell_aggregates[(st, crid, plabel)].append(
            _FileAggregate(
                src_file, agg_val, facts, was_summed,
                interest_derivation=interest_derivation,
            )
        )

    # ── Stage 2: across files, pick the most recent
    for (st, crid, plabel), aggs in cell_aggregates.items():
        disp = label_map.get((st, crid), crid)

        winner = max(aggs, key=lambda a: (recency.get(a.source_file, 0), a.source_file))

        data[st][crid][plabel] = winner.value

        if winner.interest_derivation:
            concepts_str = "; ".join(sorted({f.raw_concept for f in winner.components}))
            audit.append(AuditEntry(
                statement_type=st, canonical_row_id=crid,
                master_display_label=disp, output_period=plabel,
                value=winner.value, source_file=winner.source_file,
                source_sheet=winner.components[0].source_sheet,
                source_column=winner.components[0].source_column,
                raw_line_label="; ".join(sorted({f.raw_line_label for f in winner.components})),
                raw_concept=concepts_str,
                source_method="interest_net",
                derivation_formula=winner.interest_derivation,
            ))
        elif winner.was_summed:
            concepts_str = " + ".join(sorted({f.raw_concept for f in winner.components}))
            formula = f"SUM({concepts_str}) in {winner.source_file}"
            audit.append(AuditEntry(
                statement_type=st, canonical_row_id=crid,
                master_display_label=disp, output_period=plabel,
                value=winner.value, source_file=winner.source_file,
                source_sheet=winner.components[0].source_sheet,
                source_column=winner.components[0].source_column,
                raw_line_label="; ".join(sorted({f.raw_line_label for f in winner.components})),
                raw_concept=concepts_str,
                source_method="summed_within_file",
                derivation_formula=formula,
            ))
        else:
            rep = winner.components[0]
            audit.append(_audit(st, crid, disp, plabel, rep))

        if len(aggs) > 1:
            unique = {a.value for a in aggs if a.value is not None}
            if len(unique) <= 1:
                logger.debug(
                    "DUPLICATE: %s/%s/%s – %d files, identical, kept most-recent %s",
                    st, crid, plabel, len(aggs), winner.source_file,
                )
            else:
                c = Conflict(
                    statement_type=st, canonical_row_id=crid, period=plabel,
                    values=[
                        (a.value, a.source_file,
                         a.components[0].source_sheet if a.components else "",
                         a.components[0].source_column if a.components else "",
                         " + ".join(sorted({f.raw_concept for f in a.components})))
                        for a in aggs
                    ],
                    resolution=f"Kept most-recent value from {winner.source_file}",
                )
                conflicts.append(c)
                logger.info(
                    "CONFLICT: %s/%s/%s – %d files, used most-recent %s",
                    st, crid, plabel, len(aggs), winner.source_file,
                )

    logger.info(
        "Consolidated: %d cells, %d conflicts",
        sum(len(v) for cc in data.values() for v in cc.values()), len(conflicts),
    )
    return dict(data), audit, conflicts


def _audit(st: str, crid: str, disp: str, plabel: str, f: MappedFact) -> AuditEntry:
    return AuditEntry(
        statement_type=st, canonical_row_id=crid,
        master_display_label=disp, output_period=plabel,
        value=f.value, source_file=f.source_file,
        source_sheet=f.source_sheet, source_column=f.source_column,
        raw_line_label=f.raw_line_label, raw_concept=f.raw_concept,
        source_method=f.source_method,
    )
