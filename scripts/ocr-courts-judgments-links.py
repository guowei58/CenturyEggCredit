from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image, ImageEnhance
import numpy as np


def main() -> None:
    # Source screenshot saved by Cursor.
    img_path = Path(
        r"C:\Users\admin\.cursor\projects\c-Users-admin-Desktop-CenturyEggCredit\assets\c__Users_admin_AppData_Roaming_Cursor_User_workspaceStorage_08ce8da28c64a4b3726e887f4cca67d8_images_image-b204f867-41d3-451a-a29b-00527676b78a.png"
    )
    if not img_path.exists():
        raise SystemExit(f"Missing image: {img_path}")

    # Lazy import (slow).
    import easyocr  # type: ignore

    im = Image.open(img_path).convert("RGB")
    # Upscale aggressively for tiny URL text.
    scale = 6
    im = im.resize((im.width * scale, im.height * scale))
    im = ImageEnhance.Contrast(im).enhance(2.2)
    im = ImageEnhance.Sharpness(im).enhance(2.5)

    reader = easyocr.Reader(["en"], gpu=False)
    out = reader.readtext(
        np.array(im),
        detail=1,
        paragraph=False,
        decoder="beamsearch",
        text_threshold=0.3,
        low_text=0.2,
        link_threshold=0.2,
        contrast_ths=0.1,
        adjust_contrast=0.7,
    )

    # Print raw text lines.
    rows = []
    for bbox, text, conf in out:
        rows.append({"text": text, "conf": float(conf)})
    print(json.dumps({"count": len(out), "rows": rows}, indent=2))


if __name__ == "__main__":
    main()

