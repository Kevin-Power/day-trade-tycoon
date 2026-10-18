#!/usr/bin/env python3
"""Static, subset web fonts for the workbook.

Chrome embeds a *variable* CJK font in PDFs as dozens of Type 3 fonts. Static weight instances embed
as normal CID TrueType fonts (selectable, searchable, print-shop friendly), so this script cuts the
weights the workbook uses out of Noto Sans TC (variable) and keeps only the characters it prints.

usage: python fonts.py --text <file with every character to keep> --out <dir> [--source NotoSansTC-VF.ttf]
needs: fontTools, brotli (pip install fonttools brotli)
"""
import argparse
import os
import shutil
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

WEIGHTS = {400: "Regular", 500: "Medium", 700: "Bold", 900: "Black"}
# Always keep ASCII, common CJK punctuation and the symbols the layout uses.
BASE = "".join(chr(c) for c in range(0x20, 0x7F)) + "　、。，．・：；？！「」『』（）〔〕【】《》〈〉—–…‧·￥％＋－＝／～▲▼△▽○●◎□■☐☑✓✔→←↑↓↗↘×÷≦≧≤≥±％℃＄"


def default_source() -> str:
    windir = os.environ.get("WINDIR", "C:/Windows")
    for candidate in (os.environ.get("ACADEMY_NOTO_TC"), f"{windir}/Fonts/NotoSansTC-VF.ttf"):
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit("Noto Sans TC variable font not found: set ACADEMY_NOTO_TC or pass --source")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--source", default=None)
    parser.add_argument("--plex", default=None, help="folder with @fontsource/ibm-plex-mono woff2 files")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    text = Path(args.text).read_text(encoding="utf-8") + BASE
    # Keep the ideographic space (U+3000): the layout prints it between labels and text.
    keep = "".join(sorted(set(ch for ch in text if not ch.isspace() or ch in " 　")))
    source = args.source or default_source()

    # Subset the variable font once (fast), then cut each static weight from the small subset.
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.glyph_names = False
    variable = TTFont(source)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=keep)
    subsetter.subset(variable)
    for weight, style in WEIGHTS.items():
        # instantiateVariableFont returns a copy (inplace=False), so the subset stays reusable.
        static = instantiateVariableFont(variable, {"wght": weight}, updateFontNames=True)
        static.flavor = "woff2"
        static.save(out / f"noto-sans-tc-{weight}.woff2")
        print(f"noto-sans-tc-{weight}.woff2 ({style})", (out / f"noto-sans-tc-{weight}.woff2").stat().st_size, "bytes")

    plex = Path(args.plex) if args.plex else None
    if plex and plex.exists():
        for weight in (300, 400, 500, 600):
            name = f"ibm-plex-mono-latin-{weight}-normal.woff2"
            shutil.copyfile(plex / name, out / name)
            print(name, "copied")
    (out / "chars.txt").write_text(keep, encoding="utf-8")
    print(len(keep), "characters kept")


if __name__ == "__main__":
    main()
