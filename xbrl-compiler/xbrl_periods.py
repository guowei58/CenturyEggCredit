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

# Earliest fiscal year to include when building from tagged periods only.
XBRL_PERIOD_MIN_FISCAL_YEAR = 2019


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


def xbrl_backed_period_canonicals(
    workbooks: list,
    *,
    min_fiscal_year: int = XBRL_PERIOD_MIN_FISCAL_YEAR,
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
    min_fiscal_year: int = XBRL_PERIOD_MIN_FISCAL_YEAR,
    min_facts_per_period: int = 1,
) -> dict[str, frozenset[str]]:
    """Per statement_type: period keys with at least one XBRL-tagged numeric fact in that sheet."""
    from collections import Counter, defaultdict

    counts: dict[str, Counter[str]] = defaultdict(Counter)
    for wb in workbooks:
        for sheet in wb.sheets:
            st = sheet.statement_type
            for fact in sheet.facts:
                if fact.value is None:
                    continue
                if fact.period.fiscal_year < min_fiscal_year:
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
    min_fiscal_year: int = XBRL_PERIOD_MIN_FISCAL_YEAR,
) -> list:
    """Drop period columns with no XBRL-tagged facts and periods before ``min_fiscal_year``."""
    backed: set[str] = set()
    for f in facts:
        if f.value is None:
            continue
        if f.period.fiscal_year < min_fiscal_year:
            continue
        if is_xbrl_tagged_concept(f.concept):
            backed.add(f.period.canonical)
    filtered = [
        f
        for f in facts
        if f.period.fiscal_year >= min_fiscal_year and f.period.canonical in backed
    ]
    if filtered:
        return filtered
    # HTML-only face workbooks (no QName columns): keep all in-range facts rather than
    # dropping the entire sheet (e.g. TTEC as-presented exports).
    return [
        f
        for f in facts
        if f.value is not None and f.period.fiscal_year >= min_fiscal_year
    ]
