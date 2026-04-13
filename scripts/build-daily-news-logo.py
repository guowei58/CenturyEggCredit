"""Copy `scripts/daily-news-logo-source.png` → `public/images/daily-news-logo.png`."""
from __future__ import annotations

import shutil
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
SRC = _REPO / "scripts" / "daily-news-logo-source.png"
DST = _REPO / "public" / "images" / "daily-news-logo.png"


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Missing source image: {SRC}")
    DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SRC, DST)
    print("Copied", SRC, "->", DST)


if __name__ == "__main__":
    main()
