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


def _collect_dates(s: str) -> list[tuple[int, int, int]]:
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


def _parse_sec_prose_period(header: str) -> Period | None:
    """Infer FY / Q / 6M / 9M from SEC HTML-style column headers."""
    s = header.strip()
    if not s:
        return None
    low = s.lower()
    dates = _collect_dates(s)
    if not dates:
        return None
    y, mo, d = dates[-1]

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
        if mo == 12 and d == 31:
            return Period("FY", y, header)
        q = (mo - 1) // 3 + 1
        return Period(f"Q{q}", y, header)

    if mo == 12 and d == 31 and "ended" in low:
        return Period("FY", y, header)
    q = (mo - 1) // 3 + 1
    return Period(f"Q{q}", y, header)


def parse_period(header: str) -> Period | None:
    """Return a Period for recognised header strings, else None."""
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

    prose = _parse_sec_prose_period(s)
    if prose:
        return prose

    return None


def sort_period_labels(labels: list[str]) -> list[str]:
    """Sort period label strings chronologically."""
    def _key(lbl: str) -> tuple[int, int]:
        p = parse_period(lbl)
        return p.sort_key if p else (9999, 99)
    return sorted(labels, key=_key)
