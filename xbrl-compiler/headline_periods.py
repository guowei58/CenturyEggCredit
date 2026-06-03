"""Infer which period keys a saved as-presented workbook *primarily* reports.

Used when merging multiple filings: for a given canonical period (e.g. ``1Q25``),
prefer the value from the workbook whose *face* period is that quarter/year
(e.g. the 1Q 2025 10-Q), not a *later* filing that only carries ``1Q25`` as a
comparative / restated column (e.g. 1Q 2026 10-Q).

Heuristic (no SEC ``reportDate`` in Excel today):
  * **10-K:** every ``FY*`` column present in the workbook is headline (annual
    as-reported in that 10-K).
  * **10-Q / other:** take the **newest** fiscal quarter column (by
    ``Period.sort_key``) among quarterly facts; that is the filing's current
    quarter. When that quarter is **Q2**, also headline **6M** (same fiscal year);
    when it is **Q3**, also headline **9M**. Q1 and Q4 filings headline the
    quarter only.

If no quarterly facts exist (e.g. only FY comparatives), returns an empty set
so consolidation falls back to file-recency.
"""
from __future__ import annotations

from workbook_loader import WorkbookInfo


def headline_periods_for_workbook(wb: WorkbookInfo) -> frozenset[str]:
    if wb.is_10k:
        fy_keys = {
            fr.period.canonical
            for sh in wb.sheets
            for fr in sh.facts
            if fr.period.is_annual()
        }
        return frozenset(fy_keys)

    quarters = [
        fr.period
        for sh in wb.sheets
        for fr in sh.facts
        if fr.period.is_quarterly()
    ]
    if not quarters:
        return frozenset()

    newest = max(quarters, key=lambda p: p.sort_key)
    keys: set[str] = {newest.canonical}
    y = newest.fiscal_year
    pt = newest.period_type

    for sh in wb.sheets:
        for fr in sh.facts:
            # YTD on the face of the Q2 report is 6M; on Q3 it is 9M. Do not tag
            # 6M/9M from earlier quarters in the same file (those are comparatives).
            if pt == "Q2" and fr.period.period_type == "6M" and fr.period.fiscal_year == y:
                keys.add(fr.period.canonical)
            if pt == "Q3" and fr.period.period_type == "9M" and fr.period.fiscal_year == y:
                keys.add(fr.period.canonical)

    return frozenset(keys)
