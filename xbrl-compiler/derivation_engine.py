"""Derive missing **cash-flow quarters from YTD** and **income-statement 4Q**.

Income Statement : Before deriving 4Q, optional **FY display-sign harmonization** for
                   gain/loss/disposition-style rows when FY ≈ −(1Q+2Q+3Q) with the same
                   zero-fill as the bridge. **4Q = FY − 1Q − 2Q − 3Q** when FY exists
                   (missing Q1–Q3 treated as 0 for the bridge only). **Exception:**
                   weighted-average share counts → **4Q = FY**.
Balance Sheet    : 4Q = FY when the year-end instant is missing (point-in-time).
Cash Flow        : **2Q = 6M − 1Q**, **3Q = 9M − 6M**, **4Q = FY − 9M** when the
                   target quarter is absent (9M treated as 0 for 4Q only when missing).
                   Requires reported operands; never overwrites filed quarters or YTD.

Reported 1Q–3Q and 6M/9M from filings are never overwritten. Empty quarter/FY
column slots in the UI are handled in ``period_parser.ensure_quarter_and_fy_columns``.
"""
from __future__ import annotations

import logging

from consolidator import ConsolidatedData, AuditEntry
from period_parser import parse_period
from master_presentation_builder import MasterRow

logger = logging.getLogger(__name__)

_HARM_TOL_ABS = 0.5
_HARM_TOL_RATIO = 0.02


def _amounts_near(a: float, b: float) -> bool:
    tol = max(_HARM_TOL_ABS, _HARM_TOL_RATIO * max(abs(a), abs(b), 1.0))
    return abs(a - b) <= tol


def _label_suggests_gain_loss_disposition_harmon(display_label: str) -> bool:
    """Sparse IS lines where 10-K vs 10-Q presentation sign often inverts (narrow gate)."""
    u = display_label.lower()
    if "disposition" in u or "divest" in u:
        return True
    if "gain" in u and "loss" in u:
        return True
    if "gain on sale" in u or "loss on sale" in u:
        return True
    return False


def _concept_local_name(crid: str) -> str:
    if "://" in crid:
        return crid.rsplit("/", 1)[-1]
    if ":" in crid:
        return crid.rsplit(":", 1)[-1]
    return crid


def is_weighted_average_shares_concept(crid: str) -> bool:
    """True for EPS-denominator-style weighted-average share / unit facts (XBRL local names).

    These are period averages, not fiscal sums — **never** apply Q1+Q2+Q3+4Q = FY style
    bridging from cumulative YTD deltas.
    """
    ln = _concept_local_name(crid).replace("_", "").lower()
    if not ln:
        return False
    if "weightedaverage" not in ln and "weightedavg" not in ln:
        return False
    if "share" in ln:
        return True
    return False


def is_weighted_average_shares_row(crid: str, display_label: str) -> bool:
    """Like ``is_weighted_average_shares_concept`` plus display-label fallback."""
    if is_weighted_average_shares_concept(crid):
        return True
    u = (display_label or "").lower()
    return "weighted average" in u and "share" in u


def _concept_suggests_gain_loss_disposition_harmon(crid: str) -> bool:
    """When ``display_label`` is empty or truncated, infer from canonical / master concept."""
    u = _concept_local_name(crid).replace("_", "").lower()
    if not u:
        return False
    if "divest" in u:
        return True
    if "disposition" in u or "disposal" in u:
        if "gain" in u or "loss" in u or "gainloss" in u:
            return True
    if "gainlossonsale" in u or "gainonsaleof" in u or "lossonsaleof" in u:
        return True
    return False


def _row_matches_gain_loss_disposition_harmon(display_label: str, crid: str) -> bool:
    return _label_suggests_gain_loss_disposition_harmon(display_label) or _concept_suggests_gain_loss_disposition_harmon(
        crid
    )


def harmonize_income_statement_fy_display_sign_before_4q(
    data: ConsolidatedData,
    label_map: dict[tuple[str, str], str],
) -> None:
    """If FY is the negation of (1Q+2Q+3Q) on a gain/loss/disposition row, flip FY.

    Otherwise ``4Q = FY - Q1 - Q2 - Q3`` double-applies opposite conventions and blows
    up 4Q (e.g. FICO FY2021 disposition activity).
    """
    rows = data.get("income_statement")
    if not rows:
        return
    for crid, vals in rows.items():
        label = label_map.get(("income_statement", crid), "")
        if not _row_matches_gain_loss_disposition_harmon(label, crid):
            continue
        years = _years(vals)
        for yr in years:
            yy = str(yr % 100).zfill(2)
            fk = f"FY{yy}"
            fy = vals.get(fk)
            if fy is None:
                continue
            # Match _is_4q: missing Q1–Q3 treated as 0 for the bridge comparison
            s123 = _z(vals, f"1Q{yy}") + _z(vals, f"2Q{yy}") + _z(vals, f"3Q{yy}")
            if _amounts_near(fy, -s123):
                vals[fk] = -float(fy)
                logger.info(
                    "HARMONIZE IS FY sign (gain/loss row): %s %s — %s was %s, "
                    "flipped to %s (1Q+2Q+3Q=%s from saved workbooks)",
                    crid, fk, label[:72], fy, vals[fk], s123,
                )


def derive_quarters(
    data: ConsolidatedData,
    master_rows: list[MasterRow],
    existing_audit: list[AuditEntry],
) -> list[AuditEntry]:
    """Fill missing quarters in-place.  Returns new audit entries for derived cells."""
    label_map: dict[tuple[str, str], str] = {
        (r.statement_type, r.canonical_row_id): r.display_label for r in master_rows
    }

    harmonize_income_statement_fy_display_sign_before_4q(data, label_map)

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
                    _cf_2q(st, crid, disp, vals, yy, reported, new_audit)
                    _cf_3q(st, crid, disp, vals, yy, reported, new_audit)
                    _cf_4q(st, crid, disp, vals, yy, reported, new_audit)

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
    if is_weighted_average_shares_row(crid, disp):
        # FY weighted average is not the sum of quarterly weighted averages.
        formula = (
            f"4Q{yy} = FY{yy} (weighted-average shares: FY is not the sum of quarters; "
            f"replacing flow-style bridge)"
        )
        _put(
            vals, lbl, float(fy), formula, st, crid, disp,
            "copied_from_fy_for_wacs", audit,
        )
        return
    if (
        _g(vals, f"1Q{yy}") is None
        and _g(vals, f"2Q{yy}") is None
        and _g(vals, f"3Q{yy}") is None
    ):
        # FY-only year (no quarterly filings merged) — do not clone FY into 4Q.
        _log_miss(st, crid, lbl, [f"1Q{yy}", f"2Q{yy}", f"3Q{yy}"])
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

def _cf_2q(st, crid, disp, vals, yy, reported, audit):
    """Derive 2Q = 6M − 1Q when 2Q is absent and both YTD operands exist."""
    lbl = f"2Q{yy}"
    if _skip(vals, lbl, reported, st, crid):
        return
    sm = _g(vals, f"6M{yy}")
    if sm is None:
        _log_miss(st, crid, lbl, [f"6M{yy}"])
        return
    q1 = _g(vals, f"1Q{yy}")
    if q1 is None:
        _log_miss(st, crid, lbl, [f"1Q{yy}"])
        return
    d = float(sm) - float(q1)
    _put(
        vals, lbl, d,
        f"6M{yy} - 1Q{yy} = {sm} - {q1}",
        st, crid, disp, "derived", audit,
    )


def _cf_3q(st, crid, disp, vals, yy, reported, audit):
    """Derive 3Q = 9M − 6M when 3Q is absent and both YTD operands exist."""
    lbl = f"3Q{yy}"
    if _skip(vals, lbl, reported, st, crid):
        return
    nm = _g(vals, f"9M{yy}")
    if nm is None:
        _log_miss(st, crid, lbl, [f"9M{yy}"])
        return
    sm = _g(vals, f"6M{yy}")
    if sm is None:
        _log_miss(st, crid, lbl, [f"6M{yy}"])
        return
    d = float(nm) - float(sm)
    _put(
        vals, lbl, d,
        f"9M{yy} - 6M{yy} = {nm} - {sm}",
        st, crid, disp, "derived", audit,
    )


def _cf_4q(st, crid, disp, vals, yy, reported, audit):
    """Derive 4Q = FY − 9M (9M treated as 0 when absent)."""
    lbl = f"4Q{yy}"
    if _skip(vals, lbl, reported, st, crid):
        return
    fy = _g(vals, f"FY{yy}")
    if fy is None:
        _log_miss(st, crid, lbl, [f"FY{yy}"])
        return
    if is_weighted_average_shares_row(crid, disp):
        _put(
            vals, lbl, float(fy),
            f"4Q{yy} = FY{yy} (weighted-average shares: not FY−9M)",
            st, crid, disp, "copied_from_fy_for_wacs", audit,
        )
        return
    nm = _z(vals, f"9M{yy}")
    nm_note = f"9M{yy}" if _g(vals, f"9M{yy}") is not None else f"9M{yy}(=0, not reported)"
    _put(vals, lbl, fy - nm,
         f"FY{yy} - {nm_note} = {fy} - {nm}",
         st, crid, disp, "derived", audit)
