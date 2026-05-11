"""
Local shim for EasyOCR on Windows/Python 3.13.

`easyocr` imports `get_display` from `bidi` (not `bidi.algorithm`) but the pure-Python
`python-bidi==0.4.2` package does not export `get_display` at the top level.

For our use case (extracting URLs from English screenshots), a no-op implementation
is sufficient and avoids requiring MSVC Build Tools for newer rust-backed wheels.
"""

from __future__ import annotations


def get_display(s: str) -> str:
    return s

