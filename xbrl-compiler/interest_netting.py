"""Route interest income + interest expense legs to one net-interest line.

GAAP filings often show either:
  • one line ``Interest income (expense), net`` / ``Interest expense, net``, or
  • separate ``Interest expense`` and ``Interest income`` / investment income.

This module **early** (before ``map_all_facts``) forces separate interest-income
and interest-expense concepts onto the **same canonical row** as the master
presentation’s net-interest line when we can detect it.  The consolidator then
nets within each source file: **expense legs − income legs** so the stored
number is interest expense **net of** interest income.
"""
from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from master_presentation_builder import MasterRow, ConceptMapping
    from workbook_loader import WorkbookInfo

logger = logging.getLogger(__name__)


def _local(concept: str) -> str:
    if "://" in concept:
        return concept.rsplit("/", 1)[1]
    if ":" in concept:
        return concept.rsplit(":", 1)[1]
    if "/" in concept:
        return concept.rsplit("/", 1)[1]
    return concept


def _norm_label(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# Already a single combined net line — do not split / remap with netting math
_COMBINED_NET_RE = re.compile(
    r"InterestIncomeExpenseNet|InterestExpenseNet|NetInterest|InterestAndDebtExpense",
    re.I,
)


def is_combined_interest_net_concept(raw_concept: str) -> bool:
    return bool(_COMBINED_NET_RE.search(_local(raw_concept)))


def is_interest_income_leg(raw_concept: str) -> bool:
    """Standalone interest / investment income (not the combined net tag)."""
    if is_combined_interest_net_concept(raw_concept):
        return False
    loc = _local(raw_concept)
    # InterestIncomeOperating, InvestmentIncomeInterest, InterestIncomeDebtSecurities...
    if re.search(r"InterestIncome|InvestmentIncomeInterest|DividendIncomeInterest", loc, re.I):
        return True
    if re.search(r"^InterestIncome$", loc, re.I):
        return True
    return False


def is_interest_expense_leg(raw_concept: str) -> bool:
    """Gross interest expense (not income), excluding combined net single tags."""
    if is_combined_interest_net_concept(raw_concept):
        return False
    if is_interest_income_leg(raw_concept):
        return False
    loc = _local(raw_concept)
    if re.search(r"InterestExpense|InterestCosts|AmortizationOfFinancingCosts|DebtRelatedCommitmentFees", loc, re.I):
        return True
    return False


def is_interest_netting_pair(concepts: set[str]) -> bool:
    """Any income-leg and any expense-leg present (local-name checks)."""
    has_inc = any(is_interest_income_leg(c) for c in concepts)
    has_exp = any(is_interest_expense_leg(c) for c in concepts)
    return has_inc and has_exp


def find_net_interest_canonical_row(master_rows: list) -> str | None:
    """Pick the master IS row that should hold net interest (expense net of income)."""
    is_rows = [r for r in master_rows if r.statement_type == "income_statement"]
    if not is_rows:
        return None

    # 1) Explicit combined / net concepts in the master row id
    for r in is_rows:
        loc = _local(r.canonical_row_id)
        if _COMBINED_NET_RE.search(loc):
            return r.canonical_row_id

    # 2) Label text: "interest … net", "net interest", "interest expense, net"
    for r in is_rows:
        lab = _norm_label(r.display_label)
        if "net interest" in lab or "interest expense net" in lab or "interest income expense net" in lab:
            return r.canonical_row_id
        if "interest" in lab and "net" in lab and "tax" not in lab:
            return r.canonical_row_id

    # 3) Generic InterestExpense row (not obviously income-only)
    for r in is_rows:
        loc = _local(r.canonical_row_id)
        if re.search(r"InterestExpense", loc, re.I) and not re.search(r"Income", loc, re.I):
            return r.canonical_row_id

    return None


def canonical_is_net_interest_row(
    canonical_row_id: str,
    net_target: str | None,
) -> bool:
    return net_target is not None and canonical_row_id == net_target


def apply_interest_netting_aliases(
    master_rows: list,
    concept_map: list,
    workbooks: list,
) -> int:
    """
    Append ``ConceptMapping`` entries so interest income/expense legs map to the
    net-interest canonical row.  Later mappings for the same (st, raw) win in
    ``row_mapper`` — we remove prior entries for touched raw concepts then append.

    Returns number of raw concepts re-mapped.
    """
    from master_presentation_builder import ConceptMapping

    target = find_net_interest_canonical_row(master_rows)
    if not target:
        logger.info("Interest netting: no net-interest master row found — skipping")
        return 0

    raw_touched: set[str] = set()
    for wb in workbooks:
        for sh in wb.sheets:
            if sh.statement_type != "income_statement":
                continue
            for concept in set(sh.row_order) | {f.concept for f in sh.facts if f.concept}:
                c = str(concept).strip()
                if not c:
                    continue
                if is_combined_interest_net_concept(c):
                    continue
                if not (is_interest_income_leg(c) or is_interest_expense_leg(c)):
                    continue
                # Map to net line (same target for both legs)
                raw_touched.add(c)

    if not raw_touched:
        return 0

    # Drop existing mappings for those raw concepts so netting aliases win
    filtered = [
        m for m in concept_map
        if not (m.statement_type == "income_statement" and m.raw_concept in raw_touched)
    ]
    concept_map.clear()
    concept_map.extend(filtered)

    n = 0
    for raw in sorted(raw_touched):
        leg = "income" if is_interest_income_leg(raw) else "expense"
        concept_map.append(
            ConceptMapping(
                statement_type="income_statement",
                raw_concept=raw,
                canonical_row_id=target,
                mapping_status="interest_net_alias",
                notes=f"Interest netting — {leg} leg mapped to net interest line {target}",
            )
        )
        n += 1

    logger.info(
        "Interest netting: %d concepts routed to net row %s",
        n,
        target,
    )
    return n


def try_aggregate_net_interest_row(
    non_null: list,
    crid: str,
    net_interest_crid: str | None,
) -> tuple[float | None, bool, str] | None:
    """
    If *crid* is the net-interest canonical row, combine facts as **expense − income**
    (missing leg treated as 0).  Returns ``(value, was_summed, formula)`` or
    ``None`` to fall back to standard multi-concept resolution.
    """
    if not net_interest_crid or crid != net_interest_crid or not non_null:
        return None

    if len(non_null) == 1:
        v = non_null[0].value
        return (v, False, "") if v is not None else (None, False, "")

    # Prefer a single combined net tag if present alongside duplicates
    for f in non_null:
        if is_combined_interest_net_concept(f.raw_concept) and f.value is not None:
            return f.value, False, ""

    exp_facts = [f for f in non_null if is_interest_expense_leg(f.raw_concept)]
    inc_facts = [f for f in non_null if is_interest_income_leg(f.raw_concept)]

    e = sum(f.value for f in exp_facts if f.value is not None)
    i = sum(f.value for f in inc_facts if f.value is not None)

    if exp_facts or inc_facts:
        net = e - i
        note = f"interest_net: expense_sum={e} - income_sum={i}"
        return net, True, note

    return None  # fall back — unrelated concepts on same cell
