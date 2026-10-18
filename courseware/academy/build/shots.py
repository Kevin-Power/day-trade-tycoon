#!/usr/bin/env python3
"""Copies raw capture PNGs into the workbook's image folder (lossless, recompressed).

Measured on this UI (2026-10-18): the same dark trading-desk screenshot made a 339 KB PDF page as
PNG and a 600 KB page as JPEG q90 4:4:4, because Chrome re-compresses PNG very well and passes JPEG
through unchanged. So the workbook keeps lossless PNG: smaller PDFs and no artefacts on red/green text.

usage: python shots.py --raw <capture>/raw --manifest <capture>/shots.json --out <assets>/shots
"""
import argparse
import json
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    raw, out = Path(args.raw), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for stale in out.glob("*.jpg"):
        stale.unlink()
    shots = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    total = 0
    for shot_id, shot in shots.items():
        with Image.open(raw / shot["file"]) as image:
            target = out / f"{shot_id}.png"
            rgb = image.convert("RGB")
            rgb.save(target, "PNG", optimize=True, compress_level=9)
            shot["image"] = target.name
            shot["pixels"] = list(image.size)
            # Background colour at the left edge: a figure may extend past the image with this colour
            # (a "gutter") so that step markers sit beside the content instead of on top of it.
            shot["edge"] = "#%02x%02x%02x" % rgb.getpixel((1, image.size[1] // 2))
            total += target.stat().st_size
    (out / "shots.json").write_text(json.dumps(shots, ensure_ascii=False, indent=1), encoding="utf-8")
    for name in ("summary", "facts", "checks", "stalls"):
        source = Path(args.manifest).with_name(f"{name}.json")
        if source.exists():
            (out / f"capture-{name}.json").write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"{len(shots)} images, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
