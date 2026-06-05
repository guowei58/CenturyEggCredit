"""Parse period column headers: 1Q15, 2Q15, 3Q15, 4Q15, FY15, 6M15, 9M15."""
from __future__ import annotations

import re
from dataclasses import dataclass

_TYPE_ORDER = {"Q1": 0, "Q2": 1, "Q3": 2, "Q4": 3, "FY": 4, "6M": 5, "9M": 6}


@dataclass(frozen=True)
class Period:
    period_type: str   # Q1 Q2 Q3 Q4 FY 6M 9M
    fiscal_year: int   # e.g. 2015
    column_label: str  # original header text

    @property
    def sort_key(self) -> tuple[int, int]:
        return (self.fiscal_year, _TYPE_ORDER.get(self.period_type, 99))

    @property
    def canonical(self) -> str:
        """Normalised label like 1Q15, FY15, 6M15."""
        yy = str(self.fiscal_year % 100).zfill(2)
        if self.period_type.startswith("Q"):
            return f"{self.period_type[1]}Q{yy}"
        return f"{self.period_type}{yy}"

    def is_quarterly(self) -> bool:
        return self.period_type in ("Q1", "Q2", "Q3", "Q4")

    def is_annual(self) -> bool:
        return self.period_type == "FY"

    def is_cumulative(self) -> bool:
        return self.period_type in ("6M", "9M")


_Q_RE  = re.compile(r"^([1-4])Q(\d{2})$", re.I)
_FY_RE = re.compile(r"^FY(\d{2})$", re.I)
_CM_RE = re.compile(r"^([69])M(\d{2})$", re.I)

_SEC_DATE_RE = re.compile(
    r"\b("
    r"Jan(?:uary|\.)?|Feb(?:ruary|\.)?|Mar(?:ch|\.)?|Apr(?:il|\.)?|May\.?|Jun(?:e|\.)?|"
    r"Jul(?:y|\.)?|Aug(?:ust|\.)?|Sep(?:t(?:ember)?|\.)?|Oct(?:ober|\.)?|Nov(?:ember|\.)?|Dec(?:ember|\.)?"
    r")\s+(\d{1,2}),\s*(\d{4})\b",
    re.I,
)

_NUM_DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")


def _year(yy: str) -> int:
    return 2000 + int(yy)


def _month_num_from_token(tok: str) -> int | None:
    t = re.sub(r"[^a-z]", "", tok.lower())
    if len(t) < 3:
        return None
    prefix = t[:3]
    months = (
        "jan", "feb", "mar", "apr", "may", "jun",
        "jul", "aug", "sep", "oct", "nov", "dec",
    )
    try:
        return months.index(prefix) + 1
    except ValueError:
        return None


_BS_INSTANT_MARKERS = (
    "assets",
    "liabilities",
    "stockholders",
    "shareholders",
    "total equity",
    "equity and",
)


def is_balance_sheet_instant_header(header: str) -> bool:
    """GEN-style BS columns: ``December 31, 2021 ASSETS`` (point-in-time, not duration FY)."""
    low = header.lower()
    if "year ended" in low or "years ended" in low or "twelve month" in low:
        return False
    if "three month" in low or "quarter ended" in low or "nine month" in low or "six month" in low:
        return False
    return any(m in low for m in _BS_INSTANT_MARKERS)


def collect_dates(s: str) -> list[tuple[int, int, int]]:
    """Return dates as (year, month, day) in order of appearance."""
    out: list[tuple[int, int, int]] = []
    for m in _SEC_DATE_RE.finditer(s):
        mo = _month_num_from_token(m.group(1))
        if mo is None:
            continue
        d = int(m.group(2))
        y = int(m.group(3))
        out.append((y, mo, d))
    for m in _NUM_DATE_RE.finditer(s):
        mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            out.append((y, mo, d))
    return out


def fiscal_quarter_from_end_month(end_month: int, fy_end_month: int) -> int:
    """Map period *end* calendar month to **fiscal** quarter (1–4) for any FY end month.

    Uses the fiscal month's position within the year (FY starts the month after
    ``fy_end_month``).  GEN-style March FYE quarter **closes** in Jun/Jul (Q1),
    Sep/Oct (Q2), Dec/Jan (Q3), Mar/Apr (Q4) — not calendar Jan–Mar buckets.
    """
    if fy_end_month == 12:
        delta = (end_month - 12) % 12
        if delta == 0:
            return 4
        return (delta - 1) // 3 + 1

    fy_start = (fy_end_month % 12) + 1
    if end_month >= fy_start:
        pos = end_month - fy_start + 1
    else:
        pos = (12 - fy_start + 1) + end_month
    return min(4, max(1, (pos + 1) // 3))


def _months_after_fy_end(end_month: int, fy_end_month: int) -> int:
    """Months from the FY close month to ``end_month`` (0 = same month as FY end)."""
    return (end_month - fy_end_month) % 12


def fiscal_year_from_end_date(
    end_year: int,
    end_month: int,
    fy_end_month: int,
    *,
    is_annual: bool = False,
) -> int:
    """Fiscal year label (calendar year the fiscal year **ends**) from period end date."""
    after = _months_after_fy_end(end_month, fy_end_month)
    if is_annual:
        # 10-K FY column: ends on or within ~2 months after FY close (Mar/Apr, Sep/Oct, …)
        if after <= 2:
            return end_year
        if end_month <= fy_end_month:
            return end_year
        return end_year + 1
    # Quarterly / YTD: H1 of fiscal year spans two calendar years when FYE is not Dec
    if after == 0:
        return end_year
    if end_month <= fy_end_month:
        return end_year
    return end_year + 1


def period_from_end_date(
    end_year: int,
    end_month: int,
    end_day: int,
    fy_end_month: int,
    header: str,
    *,
    cumulative: str | None = None,
) -> Period:
    """Build a Period from an explicit period-end date and inferred FY end month."""
    if cumulative == "9M":
        return Period(
            "9M",
            fiscal_year_from_end_date(end_year, end_month, fy_end_month, is_annual=False),
            header,
        )
    if cumulative == "6M":
        return Period(
            "6M",
            fiscal_year_from_end_date(end_year, end_month, fy_end_month, is_annual=False),
            header,
        )
    if cumulative == "FY":
        return Period(
            "FY",
            fiscal_year_from_end_date(end_year, end_month, fy_end_month, is_annual=True),
            header,
        )
    fq = fiscal_quarter_from_end_month(end_month, fy_end_month)
    fy = fiscal_year_from_end_date(end_year, end_month, fy_end_month, is_annual=False)
    return Period(f"Q{fq}", fy, header)


def _parse_sec_prose_period(
    header: str,
    *,
    fy_end_month: int | None = None,
) -> Period | None:
    """Infer FY / Q / 6M / 9M from SEC HTML-style column headers."""
    s = header.strip()
    if not s:
        return None
    low = s.lower()
    dates = collect_dates(s)
    if not dates:
        return None
    y, mo, d = dates[-1]

    def _from_fy_end(cumulative: str | None = None) -> Period:
        assert fy_end_month is not None
        return period_from_end_date(y, mo, d, fy_end_month, header, cumulative=cumulative)

    if fy_end_month is not None:
        if is_balance_sheet_instant_header(s):
            return _from_fy_end(None)
        if "nine month" in low:
            return _from_fy_end("9M")
        if "six month" in low:
            return _from_fy_end("6M")
        if "twelve month" in low or "year ended" in low or "years ended" in low:
            return _from_fy_end("FY")
        if "three month" in low or "one quarter" in low or "quarter ended" in low:
            return _from_fy_end(None)
        if "as of" in low:
            if mo == 12 and d == 31 and fy_end_month == 12:
                return Period("FY", y, header)
            return _from_fy_end(None)

    if "nine month" in low:
        return Period("9M", y, header)
    if "six month" in low:
        return Period("6M", y, header)
    if "three month" in low or "one quarter" in low or "quarter ended" in low:
        q = (mo - 1) // 3 + 1
        return Period(f"Q{q}", y, header)
    if "twelve month" in low:
        return Period("FY", y, header)
    if "year ended" in low or "years ended" in low:
        return Period("FY", y, header)

    if "as of" in low:
        if mo == 12 and d == 31:
            return Period("FY", y, header)
        q = (mo - 1) // 3 + 1
        return Period(f"Q{q}", y, header)

    if not any(x in low for x in ("month", "quarter", "year", "as of")):
        if is_balance_sheet_instant_header(s):
            if fy_end_month is not None:
                return _from_fy_end(None)
            q = (mo - 1) // 3 + 1
            return Period(f"Q{q}", y, header)
        if mo == 12 and d == 31:
            return Period("FY", y, header)
        q = (mo - 1) // 3 + 1
        return Period(f"Q{q}", y, header)

    if mo == 12 and d == 31 and "ended" in low:
        return Period("FY", y, header)
    q = (mo - 1) // 3 + 1
    return Period(f"Q{q}", y, header)


def parse_period(header: str, *, fy_end_month: int | None = None) -> Period | None:
    """Return a Period for recognised header strings, else None.

    Pass ``fy_end_month`` (1–12) when known so SEC prose headers map to **fiscal**
    Q1–Q4 / FY instead of calendar Jan–Mar / Apr–Jun buckets.
    """
    s = header.strip()

    m = _Q_RE.match(s)
    if m:
        return Period(f"Q{m.group(1)}", _year(m.group(2)), s)

    m = _FY_RE.match(s)
    if m:
        return Period("FY", _year(m.group(1)), s)

    m = _CM_RE.match(s)
    if m:
        return Period(f"{m.group(1)}M", _year(m.group(2)), s)

    prose = _parse_sec_prose_period(s, fy_end_month=fy_end_month)
    if prose:
        return prose

    return None


def sort_period_labels(labels: list[str]) -> list[str]:
    """Sort period label strings chronologically."""
    def _key(lbl: str) -> tuple[int, int]:
        p = parse_period(lbl)
        return p.sort_key if p else (9999, 99)
    return sorted(labels, key=_key)


def ensure_quarter_and_fy_columns(period_labels: list[str]) -> list[str]:
    """Ensure 1Q, 2Q, 3Q, 4Q, and FY columns for every fiscal year in the grid.

    Slots are added even when no line has data (UI shows empty cells). Applies to
    any fiscal year referenced by a quarter, annual, or YTD (6M/9M) column label.
    """
    present = set()
    fy_years: set[int] = set()
    for lbl in period_labels:
        p = parse_period(lbl)
        if p:
            present.add(p.canonical)
            fy_years.add(p.fiscal_year)

    extra: list[str] = []
    for yr in fy_years:
        yy = str(yr % 100).zfill(2)
        for qi in "1234":
            canon = f"{qi}Q{yy}"
            if canon not in present:
                extra.append(canon)
                present.add(canon)
        fy_canon = f"FY{yy}"
        if fy_canon not in present:
            extra.append(fy_canon)

    return sort_period_labels(period_labels + extra)


def interleave_annual_after_q4(
    quarterly_labels: list[str],
    annual_labels: list[str],
) -> list[str]:
    """Insert each FY column immediately after that year's 4Q (balance sheet grid)."""
    fy_by_year: dict[int, str] = {}
    for lbl in annual_labels:
        p = parse_period(lbl)
        if p and p.is_annual():
            fy_by_year[p.fiscal_year] = p.canonical

    q_only = [
        lbl
        for lbl in quarterly_labels
        if (p := parse_period(lbl)) is not None and p.is_quarterly()
    ]

    out: list[str] = []
    seen_fy: set[str] = set()
    for lbl in sort_period_labels(q_only):
        p = parse_period(lbl)
        if not p:
            continue
        out.append(lbl)
        if p and p.period_type == "Q4":
            fy_lbl = fy_by_year.get(p.fiscal_year)
            if fy_lbl and fy_lbl not in seen_fy:
                out.append(fy_lbl)
                seen_fy.add(fy_lbl)

    for yr in sorted(fy_by_year):
        fy_lbl = fy_by_year[yr]
        if fy_lbl not in seen_fy:
            out.append(fy_lbl)
    return out
