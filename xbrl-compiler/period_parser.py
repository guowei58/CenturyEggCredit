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


def _year(yy: str) -> int:
    return 2000 + int(yy)


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

    return None


def sort_period_labels(labels: list[str]) -> list[str]:
    """Sort period label strings chronologically."""
    def _key(lbl: str) -> tuple[int, int]:
        p = parse_period(lbl)
        return p.sort_key if p else (9999, 99)
    return sorted(labels, key=_key)
