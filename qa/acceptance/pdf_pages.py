"""Read-only page index of a workbook PDF for acceptance.

For every page: task ids printed on it, text length, fonts, every placed image with its effective dpi, and a
rendered preview (for looking at, page by page). Writes <out>/pages.json and <out>/page-NNN.png, plus contact
sheets of 12 pages each for a quick overview.

    python -I qa/acceptance/pdf_pages.py <pdf> <out dir> [--zoom 1.5]
"""
import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image, ImageDraw

args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
pdf_path, out_dir = Path(args[0]), Path(args[1])
zoom = float(sys.argv[sys.argv.index("--zoom") + 1]) if "--zoom" in sys.argv else 1.5
out_dir.mkdir(parents=True, exist_ok=True)

TASK = re.compile(r"TASK\s*(0[1-6]|F)\s*[·\-]\s*(\d)\b")  # task headings only, not dates such as 10-06 · 5 檔
doc = fitz.open(pdf_path)
pages = []
for index, page in enumerate(doc, start=1):
    text = page.get_text()
    tasks = sorted({f"{a}-{b}" for a, b in TASK.findall(text)})
    fonts = sorted({font[3] for font in page.get_fonts(full=True)})
    images = []
    for info in page.get_image_info(xrefs=True):
        x0, y0, x1, y1 = info["bbox"]
        width_in = (x1 - x0) / 72
        height_in = (y1 - y0) / 72
        dpi = min(info["width"] / width_in, info["height"] / height_in) if width_in > 0 and height_in > 0 else 0
        images.append({"xref": info.get("xref"), "pixels": [info["width"], info["height"]], "bbox": [round(v, 1) for v in info["bbox"]], "dpi": round(dpi)})
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    preview = out_dir / f"page-{index:03d}.png"
    pix.save(preview)
    pages.append({
        "page": index,
        "size_mm": [round(page.rect.width / 72 * 25.4, 1), round(page.rect.height / 72 * 25.4, 1)],
        "tasks": tasks,
        "chars": len(text.strip()),
        "fonts": fonts,
        "images": images,
        "min_dpi": min((image["dpi"] for image in images), default=None),
        "preview": preview.name,
    })

# Contact sheets: 12 pages each, labelled with the page number.
sheet_paths = []
for start in range(0, len(pages), 12):
    batch = pages[start : start + 12]
    thumbs = [Image.open(out_dir / item["preview"]) for item in batch]
    thumb_w = 360
    scaled = [image.resize((thumb_w, round(image.height * thumb_w / image.width))) for image in thumbs]
    cell_h = max(image.height for image in scaled) + 28
    sheet = Image.new("RGB", (thumb_w * 4 + 50, cell_h * 3 + 20), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (image, item) in enumerate(zip(scaled, batch)):
        x = 10 + (i % 4) * (thumb_w + 10)
        y = 10 + (i // 4) * cell_h
        sheet.paste(image, (x, y + 22))
        draw.rectangle([x, y + 22, x + image.width - 1, y + 22 + image.height - 1], outline="#999999")
        draw.text((x, y + 4), f"p.{item['page']}  {' '.join(item['tasks'][:4])}", fill="black")
    path = out_dir / f"contact-{start // 12 + 1:02d}.png"
    sheet.save(path)
    sheet_paths.append(path.name)

summary = {
    "pdf": str(pdf_path),
    "pages": len(pages),
    "all_a4": all(abs(item["size_mm"][0] - 210) < 1 and abs(item["size_mm"][1] - 297) < 1 for item in pages),
    "low_dpi_pages": [item["page"] for item in pages if item["min_dpi"] is not None and item["min_dpi"] < 150],
    "fonts": sorted({font for item in pages for font in item["fonts"]}),
    "empty_text_pages": [item["page"] for item in pages if item["chars"] < 20],
    "contact_sheets": sheet_paths,
    "metadata": doc.metadata,
}
(out_dir / "pages.json").write_text(json.dumps({"summary": summary, "pages": pages}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))
