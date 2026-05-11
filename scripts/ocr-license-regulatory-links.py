from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance


def ocr(img: Image.Image) -> list[dict]:
    import easyocr  # type: ignore

    # Allow-list tuned for URLs + state abbreviations.
    allow = ":/._-?&=%#abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    reader = easyocr.Reader(["en"], gpu=False)
    out = reader.readtext(
        np.array(img),
        detail=1,
        paragraph=False,
        decoder="beamsearch",
        allowlist=allow,
        text_threshold=0.2,
        low_text=0.15,
        link_threshold=0.2,
        contrast_ths=0.05,
        adjust_contrast=0.8,
    )
    rows = []
    for _bbox, text, conf in out:
        rows.append({"text": str(text), "conf": float(conf)})
    return rows


def main() -> None:
    img_path = Path(
        r"C:\Users\admin\.cursor\projects\c-Users-admin-Desktop-CenturyEggCredit\assets\c__Users_admin_AppData_Roaming_Cursor_User_workspaceStorage_08ce8da28c64a4b3726e887f4cca67d8_images_image-92552370-d262-43d5-ac9c-ea615f2e88e8.png"
    )
    if not img_path.exists():
        raise SystemExit(f"Missing image: {img_path}")

    im = Image.open(img_path).convert("RGB")

    # Upscale + sharpen.
    scale = 7
    im = im.resize((im.width * scale, im.height * scale))
    im = ImageEnhance.Contrast(im).enhance(2.6)
    im = ImageEnhance.Sharpness(im).enhance(3.0)

    # Run OCR on full image and on right-side URL-heavy crop.
    full_rows = ocr(im)
    crop = im.crop((int(im.width * 0.33), 0, im.width, im.height))
    crop_rows = ocr(crop)

    http_re = re.compile(r"https?://", re.I)
    only_http = sorted(
        {r["text"].strip() for r in (full_rows + crop_rows) if http_re.search(r["text"] or "")}
    )

    print(
        json.dumps(
            {
                "full_count": len(full_rows),
                "crop_count": len(crop_rows),
                "http": only_http,
                "sample_full": full_rows[:80],
                "sample_crop": crop_rows[:80],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

