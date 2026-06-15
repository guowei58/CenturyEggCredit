"""Periods backed by inline XBRL QNames in saved workbooks (not HTML-only rows)."""
from __future__ import annotations

_XBRL_PREFIXES = (
    "us-gaap:",
    "dei:",
    "ifrs-full:",
    "srt:",
    "ecd:",
    "country:",
    "currency:",
)
_URI_MARKERS = ("fasb.org", "xbrl.us", "sec.gov/dei", "xbrl.org")

# Static compile display floor — see ``DISPLAY_MODEL_MIN_FISCAL_YEAR`` in ``main.py``.
# Workbooks may still include pre-2020 filings for master presentation; output starts at 1Q20.
XBRL_PERIOD_MIN_FISCAL_YEAR: int | None = 2020


def _year_floor(min_fiscal_year: int | None) -> int:
    return 0 if min_fiscal_year is None else min_fiscal_year


def is_xbrl_tagged_concept(concept: str) -> bool:
    """True when the Concept column holds a QName / taxonomy URI, not HTML face or synthetic keys."""
    c = (concept or "").strip()
    if not c:
        return False
    if c.startswith("html:") or c.startswith("_:lineonly:"):
        return False
    low = c.lower()
    if any(low.startswith(p) for p in _XBRL_PREFIXES):
        return True
    if "://" in c and any(m in low for m in _URI_MARKERS):
        return True
    # Vendor namespace (e.g. gen:Foo) — tagged extension, not HTML slug
    if ":" in c and not low.startswith("html:"):
        return True
    return False


def workbook_has_xbrl_tagged_facts(wb) -> bool:
    """True when the workbook has at least one numeric fact with an XBRL QName concept."""
    for sheet in wb.sheets:
        for fact in sheet.facts:
            if fact.value is None:
                continue
            if is_xbrl_tagged_concept(fact.concept):
                return True
    return False


def filter_workbooks_to_xbrl_tagged(workbooks: list) -> tuple[list, list[str]]:
    """
    Drop HTML-only workbooks when the batch has no XBRL-tagged anchor.

    When at least one workbook has QName concepts, keep HTML-face-only workbooks
    too so Phase 2/4 label matching can merge ``html:`` rows onto master rows.

    Returns ``(kept, skipped_filenames)``.
    """
    if not workbooks:
        return [], []

    has_any_tagged = any(workbook_has_xbrl_tagged_facts(wb) for wb in workbooks)
    if not has_any_tagged:
        return [], [wb.filename for wb in workbooks]

    kept = list(workbooks)
    return kept, []


def earliest_xbrl_tagged_fiscal_year(workbooks: list) -> int | None:
    """Minimum fiscal year among numeric facts with XBRL-tagged concepts."""
    best: int | None = None
    for wb in workbooks:
        for sheet in wb.sheets:
            for fact in sheet.facts:
                if fact.value is None:
                    continue
                if not is_xbrl_tagged_concept(fact.concept):
                    continue
                yr = fact.period.fiscal_year
                if best is None or yr < best:
                    best = yr
    return best


def earliest_xbrl_tagged_period_canonical(workbooks: list) -> str | None:
    """Earliest period key (e.g. ``1Q18``) with an XBRL-tagged numeric fact."""
    from period_parser import sort_period_labels

    keys: set[str] = set()
    for wb in workbooks:
        for sheet in wb.sheets:
            for fact in sheet.facts:
                if fact.value is None:
                    continue
                if is_xbrl_tagged_concept(fact.concept):
                    keys.add(fact.period.canonical)
    if not keys:
        return None
    return sort_period_labels(list(keys))[0]


def xbrl_backed_period_canonicals(
    workbooks: list,
    *,
    min_fiscal_year: int | None = None,
    min_facts_per_period: int = 1,
) -> frozenset[str]:
    """Canonical period keys (1Q25, FY25, …) with at least one numeric XBRL-tagged fact (all statements)."""
    by_stmt = xbrl_backed_period_canonicals_by_statement(
        workbooks,
        min_fiscal_year=min_fiscal_year,
        min_facts_per_period=min_facts_per_period,
    )
    out: set[str] = set()
    for keys in by_stmt.values():
        out.update(keys)
    return frozenset(out)


def xbrl_backed_period_canonicals_by_statement(
    workbooks: list,
    *,
    min_fiscal_year: int | None = None,
    min_facts_per_period: int = 1,
) -> dict[str, frozenset[str]]:
    """Per statement_type: period keys with at least one XBRL-tagged numeric fact in that sheet."""
    from collections import Counter, defaultdict

    floor = _year_floor(min_fiscal_year)
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    for wb in workbooks:
        for sheet in wb.sheets:
            st = sheet.statement_type
            for fact in sheet.facts:
                if fact.value is None:
                    continue
                if fact.period.fiscal_year < floor:
                    continue
                if not is_xbrl_tagged_concept(fact.concept):
                    continue
                counts[st][fact.period.canonical] += 1
    return {
        st: frozenset(k for k, n in ctr.items() if n >= min_facts_per_period)
        for st, ctr in counts.items()
    }


def filter_facts_to_xbrl_periods(
    facts: list,
    *,
    min_fiscal_year: int | None = None,
) -> list:
    """Drop period columns with no XBRL-tagged facts (optional ``min_fiscal_year`` floor)."""
    floor = _year_floor(min_fiscal_year)
    backed: set[str] = set()
    for f in facts:
        if f.value is None:
            continue
        if f.period.fiscal_year < floor:
            continue
        if is_xbrl_tagged_concept(f.concept):
            backed.add(f.period.canonical)
    filtered = [
        f
        for f in facts
        if f.period.fiscal_year >= floor and f.period.canonical in backed
    ]
    if filtered:
        return filtered
    # HTML-only face workbooks (no QName columns): keep all in-range facts rather than
    # dropping the entire sheet (e.g. TTEC as-presented exports).
    return [
        f
        for f in facts
        if f.value is not None and f.period.fiscal_year >= floor
    ]
