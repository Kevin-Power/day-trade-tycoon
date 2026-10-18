"""Side-by-side sheets: each workbook screenshot next to the independent journey's screen for the same task.

Left: the image the workbook prints (assets/shots). Right: the journey's "after" screenshot of a step of the same
task on the current release. Used for looking, task by task, at whether the printed screen still matches.

    python -I qa/acceptance/pair_shots.py <academy dir> <journey dir with journey.json> <out dir>

Chosen pairs instead (a printed page or a workbook image next to a named journey screenshot):

    python -I qa/acceptance/pair_shots.py --spec <pairs.json> <out dir>

pairs.json: [{"name", "left", "leftLabel", "right", "rightLabel", "leftCrop": [x0, y0, x1, y1] (optional),
"rightCrop": [...] (optional)}]; paths are absolute or relative to pairs.json.
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

if sys.argv[1] == "--spec":
    spec_file, out_dir = Path(sys.argv[2]), Path(sys.argv[3])
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/msjh.ttc", 18)
    except OSError:
        font = None
    height = 760
    written = []
    for pair in json.loads(spec_file.read_text(encoding="utf-8")):
        images = []
        for side in ("left", "right"):
            image = Image.open(spec_file.parent / pair[side]).convert("RGB")
            if pair.get(f"{side}Crop"):
                image = image.crop(tuple(pair[f"{side}Crop"]))
            scale = height / image.height
            images.append(image.resize((max(1, round(image.width * scale)), height)))
        left, right = images
        sheet = Image.new("RGB", (left.width + right.width + 30, height + 44), "white")
        sheet.paste(left, (10, 38))
        sheet.paste(right, (left.width + 20, 38))
        draw = ImageDraw.Draw(sheet)
        draw.text((10, 8), pair.get("leftLabel", pair["left"]), fill="black", font=font)
        draw.text((left.width + 20, 8), pair.get("rightLabel", pair["right"]), fill="black", font=font)
        target = out_dir / f"{pair['name']}.png"
        sheet.save(target)
        written.append({"name": pair["name"], "sheet": target.name, "left": pair["left"], "right": pair["right"]})
    (out_dir / "pairs.json").write_text(json.dumps(written, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(written)} chosen pairs written to {out_dir}")
    sys.exit(0)

academy, journey_dir, out_dir = (Path(arg) for arg in sys.argv[1:4])
out_dir.mkdir(parents=True, exist_ok=True)
shots = json.loads((academy / "assets" / "shots" / "shots.json").read_text(encoding="utf-8"))
records = json.loads((journey_dir / "journey.json").read_text(encoding="utf-8"))["records"]

# Which shots each task prints: read from the content files' `shot: "name"` entries under each task id.
task_shots = {}
current = None
for file in sorted((academy / "content").glob("*.mjs")):
    for line in file.read_text(encoding="utf-8").splitlines():
        match = re.search(r'id:\s*"((?:0[1-6]|F|Q)-\d+)"', line)
        if match:
            current = match.group(1)
        for shot in re.findall(r'shot:\s*"([^"]+)"', line):
            if current:
                task_shots.setdefault(current, [])
                if shot not in task_shots[current]:
                    task_shots[current].append(shot)

HEIGHT = 520
try:
    FONT = ImageFont.truetype("C:/Windows/Fonts/msjh.ttc", 16)  # labels in Chinese
except OSError:
    FONT = None
def fit(image, height=HEIGHT):
    scale = height / image.height
    return image.resize((max(1, round(image.width * scale)), height))

index = []
for task, names in task_shots.items():
    steps = [record for record in records if record["task"] == task and record.get("after")]
    live = steps[-1] if steps else None
    for name in names:
        meta = shots.get(name)
        if not meta:
            continue
        left = fit(Image.open(academy / "assets" / "shots" / meta["image"]).convert("RGB"))
        if live and (journey_dir / live["after"]).exists():
            right = fit(Image.open(journey_dir / live["after"]).convert("RGB"))
            label_right = f"journey {live['seq']} {live['does'][:40]}"
        else:
            right = Image.new("RGB", (640, HEIGHT), "#eeeeee")
            label_right = "journey: no step for this task"
        sheet = Image.new("RGB", (left.width + right.width + 30, HEIGHT + 40), "white")
        sheet.paste(left, (10, 30))
        sheet.paste(right, (left.width + 20, 30))
        draw = ImageDraw.Draw(sheet)
        draw.text((10, 8), f"{task} workbook: {name} (taken {meta.get('takenAt', '?')[:19]})", fill="black", font=FONT)
        draw.text((left.width + 20, 8), label_right, fill="black", font=FONT)
        path = out_dir / f"{task}-{name}.png"
        sheet.save(path)
        index.append({"task": task, "shot": name, "sheet": path.name, "journey": live["seq"] if live else None})
(out_dir / "pairs.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{len(index)} pairs written to {out_dir}")
