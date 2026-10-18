# Side-by-side "before | after" images of chosen PDF pages, for a revision report.
#   python courseware/academy/build/evidence_pages.py <before.pdf> <after.pdf> <out dir> <page> [<page> ...]
# A page is "N" (same number in both books) or "N:M" (page N of the old book against page M of the new one).
# Writes <out dir>/pdf-pM-before-after.png (each half rendered at 110 dpi with a label) and prints the files.
import os
import sys

import fitz  # PyMuPDF
from PIL import Image, ImageDraw


def label(path):
    # The default bitmap font has no CJK glyphs: keep the ASCII part of the name (e.g. "-2026.10-r2.1.pdf").
    name = os.path.basename(path)
    return "".join(ch for ch in name if ord(ch) < 128) or "pdf"


def render(doc, number, dpi=110):
    page = doc[number - 1]
    pix = page.get_pixmap(dpi=dpi)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def main():
    before_path, after_path, out_dir, *pages = sys.argv[1:]
    os.makedirs(out_dir, exist_ok=True)
    before, after = fitz.open(before_path), fitz.open(after_path)
    for spec in pages:
        old, new = (int(part) for part in spec.split(":")) if ":" in spec else (int(spec), int(spec))
        left, right = render(before, old), render(after, new)
        bar = 34
        width = left.width + right.width + 24
        sheet = Image.new("RGB", (width, max(left.height, right.height) + bar), (236, 239, 243))
        sheet.paste(left, (0, bar))
        sheet.paste(right, (left.width + 24, bar))
        draw = ImageDraw.Draw(sheet)
        draw.text((10, 10), f"BEFORE  {label(before_path)}  p.{old}", fill=(150, 30, 30))
        draw.text((left.width + 34, 10), f"AFTER  {label(after_path)}  p.{new}", fill=(20, 110, 60))
        target = os.path.join(out_dir, f"pdf-p{new:02d}-before-after.png")
        sheet.save(target, optimize=True)
        print(target)


if __name__ == "__main__":
    main()
