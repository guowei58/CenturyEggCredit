"""Comprehensive tie-out checks on compiled financial statements.

Returns per-cell validation failures so the frontend can highlight them in red.

Check categories:
  1. Q_SUM       – Q1+Q2+Q3+Q4 = FY  (income statement & cash flow)
  2. IS_SUBTOTAL – operating income, pre-tax income, net income, net income to common
  3. BS_EQUATION – assets = liabilities + equity
  4. BS_SUBTOTAL – current assets, total assets, current liabilities, total liabilities
  5. CF_SECTION  – section items sum to section subtotal
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from period_parser import parse_period
from consolidator import ConsolidatedData
from master_presentation_builder import MasterRow

logger = logging.getLogger(__name__)

_TOL = 0.5  # allow rounding tolerance

# ── data classes ──────────────────────────────────────────────────────────

@dataclass
class ValidationResult:
    check: str
    passed: bool
    statement_type: str
    canonical_row_id: str
    period: str
    detail: str


@dataclass
class CellFailure:
    """A single cell that failed validation, keyed by (statement_type, row_id, period)."""
    statement_type: str
    canonical_row_id: str
    period: str
    checks: list[str] = field(default_factory=list)


# ── concept identification via local-name patterns ────────────────────────

def _local(concept: str) -> str:
    if "://" in concept:
        return concept.rsplit("/", 1)[-1]
    if ":" in concept:
        return concept.rsplit(":", 1)[-1]
    return concept


_IS_PATTERNS: dict[str, list[re.Pattern]] = {
    "revenue": [
        re.compile(r"^Revenues?$", re.I),
        re.compile(r"^RevenueFromContract", re.I),
        re.compile(r"^SalesRevenueNet$", re.I),
        re.compile(r"^SalesRevenueGoodsNet$", re.I),
    ],
    "operating_income": [
        re.compile(r"^OperatingIncomeLoss$", re.I),
    ],
    "pretax_income": [
        re.compile(r"IncomeLoss.*BeforeIncomeTax", re.I),
        re.compile(r"^IncomeLossFromContinuingOperationsBefore", re.I),
    ],
    "income_tax": [
        re.compile(r"^IncomeTaxExpenseBenefit$", re.I),
        re.compile(r"^IncomeTaxesPaidNet$", re.I),
    ],
    "net_income": [
        re.compile(r"^NetIncomeLoss$", re.I),
        re.compile(r"^ProfitLoss$", re.I),
    ],
    "minority_interest": [
        re.compile(r"NetIncomeLossAttributableToNoncontrollingInterest", re.I),
        re.compile(r"MinorityInterest", re.I),
    ],
    "equity_method": [
        re.compile(r"IncomeLossFromEquityMethodInvestment", re.I),
    ],
    "net_income_common": [
        re.compile(r"NetIncomeLossAvailableToCommonStockholder", re.I),
        re.compile(r"NetIncomeLossAttributableToParent", re.I),  # close proxy
    ],
}

_BS_PATTERNS: dict[str, list[re.Pattern]] = {
    "total_assets": [re.compile(r"^Assets$", re.I)],
    "total_liabilities": [
        re.compile(r"^Liabilities$", re.I),
        re.compile(r"^LiabilitiesNoncurrentAndCurrent$", re.I),
    ],
    "total_equity": [
        re.compile(r"^StockholdersEquity$", re.I),
        re.compile(r"^StockholdersEquityIncluding", re.I),
    ],
    "current_assets": [re.compile(r"^AssetsCurrent$", re.I)],
    "current_liabilities": [re.compile(r"^LiabilitiesCurrent$", re.I)],
    "noncurrent_assets": [
        re.compile(r"^AssetsNoncurrent$", re.I),
    ],
    "noncurrent_liabilities": [
        re.compile(r"^LiabilitiesNoncurrent$", re.I),
    ],
    "liabilities_and_equity": [
        re.compile(r"^LiabilitiesAndStockholdersEquity$", re.I),
    ],
}

_CF_PATTERNS: dict[str, list[re.Pattern]] = {
    "operating": [
        re.compile(r"^NetCashProvidedByUsedIn.*Operating", re.I),
    ],
    "investing": [
        re.compile(r"^NetCashProvidedByUsedIn.*Investing", re.I),
    ],
    "financing": [
        re.compile(r"^NetCashProvidedByUsedIn.*Financing", re.I),
    ],
}

_LABEL_PATTERNS: dict[str, list[re.Pattern]] = {
    "revenue": [re.compile(r"^(?:total\s+)?(?:net\s+)?(?:revenue|sale)s?$", re.I)],
    "operating_income": [re.compile(r"^(?:total\s+)?operating\s+income", re.I)],
    "pretax_income": [re.compile(r"income.*before.*(?:income\s+)?tax", re.I)],
    "income_tax": [re.compile(r"(?:income\s+tax|provision\s+for\s+income\s+tax)", re.I)],
    "net_income": [re.compile(r"^net\s+income(?:\s*\(loss\))?$", re.I)],
    "net_income_common": [re.compile(r"net\s+income.*(?:common|parent)", re.I)],
    "total_assets": [re.compile(r"^total\s+assets$", re.I)],
    "total_liabilities": [re.compile(r"^total\s+liabilities$", re.I)],
    "total_equity": [re.compile(r"(?:total\s+)?(?:stockholders|shareholders).*equity", re.I)],
    "current_assets": [re.compile(r"^total\s+current\s+assets$", re.I)],
    "current_liabilities": [re.compile(r"^total\s+current\s+liabilities$", re.I)],
    "operating": [re.compile(r"(?:net\s+)?cash.*(?:from|by).*operating", re.I)],
    "investing": [re.compile(r"(?:net\s+)?cash.*(?:from|by|in).*investing", re.I)],
    "financing": [re.compile(r"(?:net\s+)?cash.*(?:from|by|in).*financing", re.I)],
}


def _match_concept(concept: str, label: str, patterns: dict[str, list[re.Pattern]],
                   label_patterns: dict[str, list[re.Pattern]] | None = None) -> str | None:
    """Return the role key if concept or label matches, else None."""
    ln = _local(concept)
    for role, pats in patterns.items():
        for pat in pats:
            if pat.search(ln):
                return role
    if label_patterns and label:
        for role, pats in label_patterns.items():
            if role in patterns:
                for pat in pats:
                    if pat.search(label.strip()):
                        return role
    return None


# ── identify key rows ────────────────────────────────────────────────────

def _build_role_map(
    master_rows: list[MasterRow],
    stmt_type: str,
    patterns: dict[str, list[re.Pattern]],
) -> dict[str, str]:
    """Map role → canonical_row_id for a given statement type."""
    out: dict[str, str] = {}
    for r in master_rows:
        if r.statement_type != stmt_type:
            continue
        role = _match_concept(r.canonical_row_id, r.display_label, patterns, _LABEL_PATTERNS)
        if role and role not in out:
            out[role] = r.canonical_row_id
    return out


# ── helpers ───────────────────────────────────────────────────────────────

def _years(v: dict) -> set[int]:
    out: set[int] = set()
    for lbl in v:
        p = parse_period(lbl)
        if p:
            out.add(p.fiscal_year)
    return out


def _all_years(concepts: dict[str, dict]) -> set[int]:
    out: set[int] = set()
    for vals in concepts.values():
        out |= _years(vals)
    return out


def _g(v: dict | None, k: str) -> float | None:
    if v is None:
        return None
    return v.get(k)


def _q_periods(yy: str) -> list[str]:
    return [f"1Q{yy}", f"2Q{yy}", f"3Q{yy}", f"4Q{yy}", f"FY{yy}"]


# ── check implementations ────────────────────────────────────────────────

def _check_q_sum(
    st: str,
    concepts: dict[str, dict[str, float | None]],
    results: list[ValidationResult],
    failures: dict[tuple[str, str, str], list[str]],
) -> None:
    """Q1+Q2+Q3+Q4 should equal FY for every row (IS and CF)."""
    for crid, vals in concepts.items():
        for yr in _years(vals):
            yy = str(yr % 100).zfill(2)
            qs = [_g(vals, f"{q}Q{yy}") for q in range(1, 5)]
            fy = _g(vals, f"FY{yy}")
            if fy is None or any(q is None for q in qs):
                continue
            qsum = sum(qs)  # type: ignore[arg-type]
            diff = abs(qsum - fy)
            ok = diff <= _TOL
            detail = f"Q1+Q2+Q3+Q4={qsum:.2f}, FY={fy:.2f}, diff={diff:.2f}"
            results.append(ValidationResult("Q_SUM", ok, st, crid, f"FY{yy}", detail))
            if not ok:
                for p in _q_periods(yy):
                    failures[(st, crid, p)] = failures.get((st, crid, p), [])
                    failures[(st, crid, p)].append(f"Q_SUM: {detail}")


def _check_subtotal(
    st: str,
    concepts: dict[str, dict[str, float | None]],
    subtotal_id: str,
    component_ids: list[str],
    check_name: str,
    negate_ids: set[str],
    results: list[ValidationResult],
    failures: dict[tuple[str, str, str], list[str]],
) -> None:
    """Verify that subtotal = sum(components) accounting for sign."""
    sub_vals = concepts.get(subtotal_id)
    if sub_vals is None:
        return
    for yr in _years(sub_vals):
        yy = str(yr % 100).zfill(2)
        for ptype in ["1Q", "2Q", "3Q", "4Q", "FY"]:
            plabel = f"{ptype}{yy}"
            expected = _g(sub_vals, plabel)
            if expected is None:
                continue
            total = 0.0
            any_found = False
            for cid in component_ids:
                cv = concepts.get(cid)
                val = _g(cv, plabel) if cv else None
                if val is not None:
                    any_found = True
                    total += (-val if cid in negate_ids else val)
            if not any_found:
                continue
            diff = abs(expected - total)
            ok = diff <= _TOL
            detail = f"expected={expected:.2f}, computed={total:.2f}, diff={diff:.2f}"
            results.append(ValidationResult(check_name, ok, st, subtotal_id, plabel, detail))
            if not ok:
                failures[(st, subtotal_id, plabel)] = failures.get(
                    (st, subtotal_id, plabel), []
                )
                failures[(st, subtotal_id, plabel)].append(f"{check_name}: {detail}")


def _check_bs_equation(
    concepts: dict[str, dict[str, float | None]],
    roles: dict[str, str],
    results: list[ValidationResult],
    failures: dict[tuple[str, str, str], list[str]],
) -> None:
    """Assets = Liabilities + Equity."""
    a_id = roles.get("total_assets")
    l_id = roles.get("total_liabilities")
    e_id = roles.get("total_equity")
    if not a_id or not (l_id or e_id):
        return
    a_vals = concepts.get(a_id, {})
    for yr in _years(a_vals):
        yy = str(yr % 100).zfill(2)
        for ptype in ["1Q", "2Q", "3Q", "4Q", "FY"]:
            plabel = f"{ptype}{yy}"
            assets = _g(a_vals, plabel)
            liab = _g(concepts.get(l_id, {}), plabel) if l_id else None
            eq = _g(concepts.get(e_id, {}), plabel) if e_id else None
            if assets is None:
                continue
            rhs = (liab or 0) + (eq or 0)
            if liab is None and eq is None:
                continue
            diff = abs(assets - rhs)
            ok = diff <= _TOL
            detail = f"Assets={assets:.2f}, L+E={rhs:.2f} (L={liab}, E={eq}), diff={diff:.2f}"
            results.append(ValidationResult("BS_EQUATION", ok, "balance_sheet", a_id, plabel, detail))
            if not ok:
                for rid in [a_id, l_id, e_id]:
                    if rid:
                        key = ("balance_sheet", rid, plabel)
                        failures[key] = failures.get(key, [])
                        failures[key].append(f"BS_EQUATION: {detail}")


def _check_cf_sections(
    concepts: dict[str, dict[str, float | None]],
    master_rows: list[MasterRow],
    roles: dict[str, str],
    results: list[ValidationResult],
    failures: dict[tuple[str, str, str], list[str]],
) -> None:
    """Items between two section subtotals should sum to the subtotal."""
    cf_rows = sorted(
        [r for r in master_rows if r.statement_type == "cash_flow"],
        key=lambda r: r.display_order,
    )
    if not cf_rows:
        return

    section_ids = []
    for role in ["operating", "investing", "financing"]:
        rid = roles.get(role)
        if rid:
            section_ids.append(rid)

    section_set = set(section_ids)

    for section_id in section_ids:
        section_idx = None
        for i, r in enumerate(cf_rows):
            if r.canonical_row_id == section_id:
                section_idx = i
                break
        if section_idx is None:
            continue

        # Walk backwards from the subtotal row to find component rows
        components: list[str] = []
        for i in range(section_idx - 1, -1, -1):
            rid = cf_rows[i].canonical_row_id
            if rid in section_set:
                break
            components.append(rid)

        if not components:
            continue

        sub_vals = concepts.get(section_id)
        if sub_vals is None:
            continue
        for yr in _years(sub_vals):
            yy = str(yr % 100).zfill(2)
            for ptype in ["1Q", "2Q", "3Q", "4Q", "FY"]:
                plabel = f"{ptype}{yy}"
                expected = _g(sub_vals, plabel)
                if expected is None:
                    continue
                total = 0.0
                any_found = False
                for cid in components:
                    cv = concepts.get(cid)
                    val = _g(cv, plabel) if cv else None
                    if val is not None:
                        any_found = True
                        total += val
                if not any_found:
                    continue
                diff = abs(expected - total)
                ok = diff <= _TOL
                check_name = f"CF_SECTION_{section_id}"
                detail = f"subtotal={expected:.2f}, sum_of_items={total:.2f}, diff={diff:.2f}"
                results.append(ValidationResult(check_name, ok, "cash_flow", section_id, plabel, detail))
                if not ok:
                    key = ("cash_flow", section_id, plabel)
                    failures[key] = failures.get(key, [])
                    failures[key].append(f"CF_SECTION: {detail}")


def _check_bs_subtotals(
    concepts: dict[str, dict[str, float | None]],
    master_rows: list[MasterRow],
    roles: dict[str, str],
    results: list[ValidationResult],
    failures: dict[tuple[str, str, str], list[str]],
) -> None:
    """Check current assets/liabilities sums and total assets/liabilities sums."""
    bs_rows = sorted(
        [r for r in master_rows if r.statement_type == "balance_sheet"],
        key=lambda r: r.display_order,
    )
    if not bs_rows:
        return

    # Identify subtotal row indices
    subtotal_ids = set()
    for role in ["current_assets", "current_liabilities", "total_assets",
                 "total_liabilities", "total_equity", "noncurrent_assets",
                 "noncurrent_liabilities", "liabilities_and_equity"]:
        rid = roles.get(role)
        if rid:
            subtotal_ids.add(rid)

    # For each subtotal, find its component rows by walking backwards
    for sub_role, sub_id in roles.items():
        if sub_role not in ("current_assets", "current_liabilities",
                            "total_assets", "total_liabilities"):
            continue
        sub_idx = None
        for i, r in enumerate(bs_rows):
            if r.canonical_row_id == sub_id:
                sub_idx = i
                break
        if sub_idx is None:
            continue

        components: list[str] = []
        for i in range(sub_idx - 1, -1, -1):
            rid = bs_rows[i].canonical_row_id
            if rid in subtotal_ids and rid != sub_id:
                break
            if rid != sub_id:
                components.append(rid)

        if not components:
            continue

        sub_vals = concepts.get(sub_id)
        if sub_vals is None:
            continue

        check_name = f"BS_SUBTOTAL_{sub_role}"
        for yr in _years(sub_vals):
            yy = str(yr % 100).zfill(2)
            for ptype in ["1Q", "2Q", "3Q", "4Q", "FY"]:
                plabel = f"{ptype}{yy}"
                expected = _g(sub_vals, plabel)
                if expected is None:
                    continue
                total = 0.0
                any_found = False
                for cid in components:
                    cv = concepts.get(cid)
                    val = _g(cv, plabel) if cv else None
                    if val is not None:
                        any_found = True
                        total += val
                if not any_found:
                    continue
                diff = abs(expected - total)
                ok = diff <= _TOL
                detail = f"subtotal={expected:.2f}, sum={total:.2f}, diff={diff:.2f}"
                results.append(ValidationResult(check_name, ok, "balance_sheet", sub_id, plabel, detail))
                if not ok:
                    key = ("balance_sheet", sub_id, plabel)
                    failures[key] = failures.get(key, [])
                    failures[key].append(f"{check_name}: {detail}")


# ── public API ────────────────────────────────────────────────────────────

def validate_all(
    data: ConsolidatedData,
    master_rows: list[MasterRow] | None = None,
) -> tuple[list[ValidationResult], dict[tuple[str, str, str], list[str]]]:
    """Run all checks.

    Returns:
        results: list of ValidationResult (for logging / summary)
        failures: dict mapping (statement_type, canonical_row_id, period)
                  to list of failure messages — used for red-highlighting.
    """
    results: list[ValidationResult] = []
    failures: dict[tuple[str, str, str], list[str]] = {}

    # 1. Q1+Q2+Q3+Q4 = FY  (IS and CF)
    for st in ("income_statement", "cash_flow"):
        if st in data:
            _check_q_sum(st, data[st], results, failures)

    if master_rows:
        # 2. Income statement subtotals
        is_roles = _build_role_map(master_rows, "income_statement", _IS_PATTERNS)
        is_data = data.get("income_statement", {})
        logger.info("IS roles identified: %s", {k: v for k, v in is_roles.items()})

        # Revenue - (everything between revenue and operating_income) = operating_income
        # We handle the IS subtotals via section-walk just like CF
        is_rows = sorted(
            [r for r in master_rows if r.statement_type == "income_statement"],
            key=lambda r: r.display_order,
        )
        is_subtotal_ids = set(is_roles.values())

        for sub_role in ["operating_income", "pretax_income", "net_income", "net_income_common"]:
            sub_id = is_roles.get(sub_role)
            if not sub_id:
                continue
            sub_idx = None
            for i, r in enumerate(is_rows):
                if r.canonical_row_id == sub_id:
                    sub_idx = i
                    break
            if sub_idx is None:
                continue

            components: list[str] = []
            for i in range(sub_idx - 1, -1, -1):
                rid = is_rows[i].canonical_row_id
                if rid in is_subtotal_ids and rid != sub_id:
                    break
                if rid != sub_id:
                    components.append(rid)

            if not components:
                continue

            sub_vals = is_data.get(sub_id)
            if sub_vals is None:
                continue

            check_name = f"IS_SUBTOTAL_{sub_role}"
            for yr in _years(sub_vals):
                yy = str(yr % 100).zfill(2)
                for ptype in ["1Q", "2Q", "3Q", "4Q", "FY"]:
                    plabel = f"{ptype}{yy}"
                    expected = _g(sub_vals, plabel)
                    if expected is None:
                        continue
                    total = 0.0
                    any_found = False
                    for cid in components:
                        cv = is_data.get(cid)
                        val = _g(cv, plabel) if cv else None
                        if val is not None:
                            any_found = True
                            total += val
                    if not any_found:
                        continue
                    diff = abs(expected - total)
                    ok = diff <= _TOL
                    detail = f"subtotal={expected:.2f}, sum_of_section={total:.2f}, diff={diff:.2f}"
                    results.append(ValidationResult(check_name, ok, "income_statement", sub_id, plabel, detail))
                    if not ok:
                        key = ("income_statement", sub_id, plabel)
                        failures[key] = failures.get(key, [])
                        failures[key].append(f"{check_name}: {detail}")

        # 3. Balance sheet equation: Assets = Liabilities + Equity
        bs_roles = _build_role_map(master_rows, "balance_sheet", _BS_PATTERNS)
        bs_data = data.get("balance_sheet", {})
        logger.info("BS roles identified: %s", {k: v for k, v in bs_roles.items()})

        _check_bs_equation(bs_data, bs_roles, results, failures)

        # 4. Balance sheet subtotals
        _check_bs_subtotals(bs_data, master_rows, bs_roles, results, failures)

        # 5. Cash flow section subtotals
        cf_roles = _build_role_map(master_rows, "cash_flow", _CF_PATTERNS)
        cf_data = data.get("cash_flow", {})
        logger.info("CF roles identified: %s", {k: v for k, v in cf_roles.items()})

        _check_cf_sections(cf_data, master_rows, cf_roles, results, failures)

    ok = sum(r.passed for r in results)
    fail = len(results) - ok
    logger.info("Validation: %d passed, %d failed / %d total", ok, fail, len(results))
    return results, failures
