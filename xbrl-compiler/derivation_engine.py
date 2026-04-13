"""Derive missing quarterly values using fixed arithmetic rules.

Income Statement : 4Q is **always** FY − 1Q − 2Q − 3Q whenever FY exists for that
                   year (missing Q1–Q3 treated as 0).  Any value already in the 4Q
                   slot from consolidation is overwritten — raw IS workbooks do not
                   supply authoritative standalone 4Q facts.
Balance Sheet    : 4Q = FY  (same instant balance)
Cash Flow        : 2Q = 6M − 1Q ;  3Q = 9M − 6M ;  4Q = FY − 9M
                   (missing component treated as 0 when the cumulative exists)
"""
from __future__ import annotations

import logging

from consolidator import ConsolidatedData, AuditEntry
from period_parser import parse_period
from master_presentation_builder import MasterRow

logger = logging.getLogger(__name__)


def derive_quarters(
    data: ConsolidatedData,
    master_rows: list[MasterRow],
    existing_audit: list[AuditEntry],
) -> list[AuditEntry]:
    """Fill missing quarters in-place.  Returns new audit entries for derived cells."""
    label_map: dict[tuple[str, str], str] = {
        (r.statement_type, r.canonical_row_id): r.display_label for r in master_rows
    }

    reported: set[tuple[str, str, str]] = set()
    for ae in existing_audit:
        if ae.source_method == "reported":
            reported.add((ae.statement_type, ae.canonical_row_id, ae.output_period))

    new_audit: list[AuditEntry] = []

    for st, concepts in data.items():
        for crid, vals in concepts.items():
            disp = label_map.get((st, crid), crid)
            years = _years(vals)
            for yr in years:
                yy = str(yr % 100).zfill(2)
                if st == "income_statement":
                    _is_4q(st, crid, disp, vals, yy, new_audit)
                elif st == "balance_sheet":
                    _bs_4q(st, crid, disp, vals, yy, reported, new_audit)
                elif st == "cash_flow":
                    _cf(st, crid, disp, vals, yy, reported, new_audit)

    logger.info("Derived %d quarterly values", len(new_audit))
    return new_audit


# ── helpers ────────────────────────────────────────────────────────────────

def _years(vals: dict[str, float | None]) -> set[int]:
    out: set[int] = set()
    for lbl in vals:
        p = parse_period(lbl)
        if p:
            out.add(p.fiscal_year)
    return out


def _g(v: dict, k: str) -> float | None:
    return v.get(k)


def _z(v: dict, k: str) -> float:
    """Get value or 0.0 — for components that may be absent but should be
    treated as zero when the cumulative/total period exists."""
    val = v.get(k)
    return val if val is not None else 0.0


def _skip(vals, lbl, reported, st, crid):
    if vals.get(lbl) is not None:
        return True
    if (st, crid, lbl) in reported:
        return True
    return False


def _put(vals, lbl, value, formula, st, crid, disp, method, audit_list):
    vals[lbl] = value
    audit_list.append(AuditEntry(
        statement_type=st, canonical_row_id=crid,
        master_display_label=disp, output_period=lbl,
        value=value, source_file="(derived)", source_sheet="",
        source_column="", raw_line_label="", raw_concept="",
        source_method=method, derivation_formula=formula,
    ))


def _log_miss(st, crid, target, missing):
    if missing:
        logger.debug("SKIP DERIVE %s/%s/%s – missing %s", st, crid, target, ", ".join(missing))


# ── Income Statement ──────────────────────────────────────────────────────

def _is_4q(st, crid, disp, vals, yy, audit):
    """Set 4Q = FY − 1Q − 2Q − 3Q whenever FY exists; overwrites any prior 4Q."""
    lbl = f"4Q{yy}"
    fy = _g(vals, f"FY{yy}")
    if fy is None:
        _log_miss(st, crid, lbl, [f"FY{yy}"])
        return
    q1 = _z(vals, f"1Q{yy}")
    q2 = _z(vals, f"2Q{yy}")
    q3 = _z(vals, f"3Q{yy}")
    d = fy - q1 - q2 - q3
    parts = []
    for tag, val in [("1Q", q1), ("2Q", q2), ("3Q", q3)]:
        if _g(vals, f"{tag}{yy}") is None:
            parts.append(f"{tag}{yy}(=0, not reported)")
        else:
            parts.append(f"{tag}{yy}")
    formula = f"FY{yy} - {' - '.join(parts)} = {fy} - {q1} - {q2} - {q3}"
    _put(vals, lbl, d, formula, st, crid, disp, "derived", audit)


# ── Balance Sheet ─────────────────────────────────────────────────────────

def _bs_4q(st, crid, disp, vals, yy, reported, audit):
    lbl = f"4Q{yy}"
    if _skip(vals, lbl, reported, st, crid):
        return
    fy = _g(vals, f"FY{yy}")
    if fy is not None:
        _put(vals, lbl, fy,
             f"4Q{yy} = FY{yy} (balance sheet year-end instant)",
             st, crid, disp, "copied_from_fy_for_bs", audit)


# ── Cash Flow ─────────────────────────────────────────────────────────────

def _cf(st, crid, disp, vals, yy, reported, audit):
    # 2Q = 6M − 1Q  (1Q defaults to 0 if absent)
    lbl = f"2Q{yy}"
    if not _skip(vals, lbl, reported, st, crid):
        sm = _g(vals, f"6M{yy}")
        if sm is not None:
            q1 = _z(vals, f"1Q{yy}")
            q1_note = f"1Q{yy}" if _g(vals, f"1Q{yy}") is not None else f"1Q{yy}(=0, not reported)"
            _put(vals, lbl, sm - q1,
                 f"6M{yy} - {q1_note} = {sm} - {q1}",
                 st, crid, disp, "derived", audit)
        else:
            _log_miss(st, crid, lbl, [f"6M{yy}"])

    # 3Q = 9M − 6M  (6M defaults to 0 if absent)
    lbl = f"3Q{yy}"
    if not _skip(vals, lbl, reported, st, crid):
        nm = _g(vals, f"9M{yy}")
        if nm is not None:
            sm = _z(vals, f"6M{yy}")
            sm_note = f"6M{yy}" if _g(vals, f"6M{yy}") is not None else f"6M{yy}(=0, not reported)"
            _put(vals, lbl, nm - sm,
                 f"9M{yy} - {sm_note} = {nm} - {sm}",
                 st, crid, disp, "derived", audit)
        else:
            _log_miss(st, crid, lbl, [f"9M{yy}"])

    # 4Q = FY − 9M  (9M defaults to 0 if absent)
    lbl = f"4Q{yy}"
    if not _skip(vals, lbl, reported, st, crid):
        fy = _g(vals, f"FY{yy}")
        if fy is not None:
            nm = _z(vals, f"9M{yy}")
            nm_note = f"9M{yy}" if _g(vals, f"9M{yy}") is not None else f"9M{yy}(=0, not reported)"
            _put(vals, lbl, fy - nm,
                 f"FY{yy} - {nm_note} = {fy} - {nm}",
                 st, crid, disp, "derived", audit)
        else:
            _log_miss(st, crid, lbl, [f"FY{yy}"])
