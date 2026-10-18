#!/usr/bin/env python3
"""PDF acceptance checks for the workbook (needs PyMuPDF; Pillow for contact sheets).

Checks: every page is A4; only the workbook's embedded fonts are used (no Type 3, no system
fallbacks); every page has selectable text; key phrases are searchable; every placed image has at
least the given effective resolution. Also renders page previews and contact sheets for review.

usage: python qa_pdf.py <pdf> --out <dir> [--dpi 110] [--min-image-dpi 150] [--expect "字串" ...]
"""
import argparse
import json
import math
from pathlib import Path

import pymupdf as fitz  # PyMuPDF

A4 = (595.28, 841.89)
ALLOWED = ("NotoSansTC-", "IBMPlexMono-")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("--out", required=True)
    parser.add_argument("--dpi", type=int, default=110)
    # Screenshots are 2x/3x device-pixel captures of UI text. At 150 dpi a 12 px label prints about
    # 3 mm tall and stays sharp; below that the zoom is too strong and text looks soft on paper.
    parser.add_argument("--min-image-dpi", type=int, default=150)
    parser.add_argument("--expect", action="append", default=[])
    parser.add_argument("--no-render", action="store_true")
    args = parser.parse_args()
    out = Path(args.out)
    (out / "pages").mkdir(parents=True, exist_ok=True)
    doc = fitz.open(args.pdf)
    report = {"pdf": args.pdf, "pages": doc.page_count, "metadata": doc.metadata, "problems": [], "fonts": {}, "images": {"count": 0, "min_dpi": None}}
    text_all = []
    min_dpi = math.inf
    for index, page in enumerate(doc, start=1):
        w, h = page.rect.width, page.rect.height
        if abs(w - A4[0]) > 1 or abs(h - A4[1]) > 1:
            report["problems"].append(f"page {index}: size {w:.1f}x{h:.1f}pt is not A4")
        for font in page.get_fonts(full=True):
            kind, name = font[2], font[3]
            base = name.split("+", 1)[-1]
            report["fonts"].setdefault(f"{kind} {base}", 0)
            report["fonts"][f"{kind} {base}"] += 1
            if kind == "Type3":
                report["problems"].append(f"page {index}: Type 3 font {name}")
            elif not base.startswith(ALLOWED):
                report["problems"].append(f"page {index}: unexpected font {base}")
        text = page.get_text()
        text_all.append(text)
        if len(text.strip()) < 20:
            report["problems"].append(f"page {index}: almost no selectable text ({len(text.strip())} chars)")
        for info in page.get_image_info(xrefs=True):
            report["images"]["count"] += 1
            bbox = fitz.Rect(info["bbox"])
            visible = bbox & page.rect
            if visible.is_empty or bbox.width < 5:
                continue
            # The placed rectangle is the whole image; the crop frame clips it, so use its full size.
            dpi = info["width"] / (bbox.width / 72)
            min_dpi = min(min_dpi, dpi)
            if dpi < args.min_image_dpi:
                report["problems"].append(f"page {index}: image at {dpi:.0f} dpi (< {args.min_image_dpi})")
        if not args.no_render:
            pix = page.get_pixmap(dpi=args.dpi)
            pix.save(out / "pages" / f"page-{index:03d}.png")
    report["images"]["min_dpi"] = None if min_dpi is math.inf else round(min_dpi)
    joined = "\n".join(text_all)
    report["expected"] = {phrase: phrase in joined for phrase in args.expect}
    for phrase, found in report["expected"].items():
        if not found:
            report["problems"].append(f"phrase not searchable: {phrase}")
    if not args.no_render:
        contact_sheets(out)
    (out / "pdf-qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("pages", "fonts", "images")}, ensure_ascii=False))
    print(f"{len(report['problems'])} problems")
    for problem in report["problems"][:40]:
        print("  -", problem)


def contact_sheets(out: Path) -> None:
    from PIL import Image

    pages = sorted((out / "pages").glob("page-*.png"))
    per = 8
    for sheet_index in range(0, len(pages), per):
        group = pages[sheet_index : sheet_index + per]
        thumbs = [Image.open(path) for path in group]
        tw = 420
        th = int(tw * 1.4142)
        sheet = Image.new("RGB", (tw * 4 + 50, th * 2 + 30), "#d9dde3")
        for i, thumb in enumerate(thumbs):
            thumb = thumb.convert("RGB").resize((tw, th))
            sheet.paste(thumb, (10 + (i % 4) * (tw + 10), 10 + (i // 4) * (th + 10)))
        sheet.save(out / f"sheet-{sheet_index // per + 1:02d}.png")


if __name__ == "__main__":
    main()
