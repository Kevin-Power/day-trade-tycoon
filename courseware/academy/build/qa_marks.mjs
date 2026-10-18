// Markers must not cover text the learner has to read. For every step marker, in the printed book and
// in the digital edition at phone width, this measures how much of the marker's circle lies over
// "ink" in the real screenshot (pixels that clearly differ from the local background, i.e. glyphs,
// icons, candles). Gutters and areas outside the image are not screenshot pixels and are skipped.
//   node courseware/academy/build/qa_marks.mjs [--python <python with Pillow>]
// It also reports a marker that the crop cuts off. At phone width, a whole-screen overview drawn at less than
// half its capture size is skipped: its words are too small to read there anyway, and the learner reads the
// close-ups under it or opens the zoom viewer (whose 100% view matches the printed scale that is checked).
// Writes output/qa/marks/marks.json; exits 1 when a marker covers ink above the threshold and is not
// listed in ALLOW below (each allowance needs a reason), or when a marker is cut off.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { academy, out } from "./render.mjs";

const args = process.argv.slice(2);
const python = args.includes("--python") ? args[args.indexOf("--python") + 1] : process.env.ACADEMY_PYTHON || "python";
const THRESHOLD = 0.05;
/** "image|marker" → reason. Keep this short: a marker over text should normally be moved. */
const ALLOW = {
  "plan-observe.png|6": "標在「用這個計畫開始」按鈕內的左端：按鈕文字置中，沒有被遮住（按鈕左右兩側都沒有放得下標號的空位）。",
  "courses.png|2": "標在「開始這個練習」按鈕的左上角：按鈕文字置中，沒有被遮住。",
};
const MIN_INSIDE = 0.98;
const MAX_SCALE_390 = 2;

const dir = join(out, "qa", "marks");
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));

async function collect(page, where) {
  return page.evaluate((label) => {
    const rows = [];
    let index = 0;
    for (const figure of document.querySelectorAll(".figure[data-crop]")) {
      index += 1;
      const cropBox = figure.querySelector(".crop")?.getBoundingClientRect();
      if (!cropBox || !cropBox.width) continue;
      const [x, y, w, h] = figure.dataset.crop.split(",").map(Number);
      const [gl, gr, gt, gb = 0] = (figure.dataset.gutters || "0,0,0,0").split(",").map(Number);
      const scale = w / cropBox.width;
      const owner = figure.closest(".page, .w-view");
      const number = figure.querySelector("figcaption b")?.textContent?.trim() ?? "";
      for (const marker of figure.querySelectorAll(".marker")) {
        const box = marker.getBoundingClientRect();
        if (!box.width) continue;
        const ix = Math.max(0, Math.min(box.right, cropBox.right) - Math.max(box.left, cropBox.left));
        const iy = Math.max(0, Math.min(box.bottom, cropBox.bottom) - Math.max(box.top, cropBox.top));
        rows.push({
          fig: index,
          where: label,
          owner: owner?.id ?? "",
          figure: number,
          image: figure.dataset.img,
          dpr: Number(figure.dataset.dpr) || 2,
          marker: marker.textContent.trim(),
          cx: x + (box.left + box.width / 2 - cropBox.left) * scale,
          cy: y + (box.top + box.height / 2 - cropBox.top) * scale,
          r: (box.width / 2) * scale,
          scale: Math.round(scale * 100) / 100,
          inside: Math.round(((ix * iy) / (box.width * box.height)) * 1000) / 1000,
          crop: [x, y, w, h],
          gutters: [gl, gr, gt, gb],
        });
      }
    }
    return rows;
  }, where);
}

const circles = [];
// Printed book (print media, fixed A4 pages; all pages laid out at once).
{
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  await page.emulateMedia({ media: "print" });
  await page.goto(pathToFileURL(join(out, "print", "student.html")).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  circles.push(...(await collect(page, "print")));
  await page.close();
}
// Digital edition at phone width: every view, with collapsed reference sections opened.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(pathToFileURL(join(out, "web", "index.html")).href, { waitUntil: "load" });
  const views = await page.evaluate(() => window.ACADEMY_VIEWS.map((view) => view.id));
  for (const id of views) {
    await page.evaluate((hash) => (location.hash = hash), id);
    await page.waitForTimeout(60);
    await page.evaluate(() => document.querySelectorAll(".w-view:not([hidden]) details").forEach((node) => (node.open = true)));
    const rows = await collect(page, "web-390");
    circles.push(...rows.filter((row) => row.owner === `view-${id}`).map((row) => ({ ...row, overview: row.scale > MAX_SCALE_390 })));
  }
  await page.close();
}
await browser.close();

const input = join(dir, "circles.json");
writeFileSync(input, JSON.stringify(circles));
const analyzer = `
import json, sys
from PIL import Image
circles = json.load(open(sys.argv[1], encoding="utf-8"))
shots = sys.argv[2]
cache = {}
out = []
for c in circles:
    img = cache.get(c["image"])
    if img is None:
        img = Image.open(shots + "/" + c["image"]).convert("L")
        cache[c["image"]] = img
    k = c["dpr"]
    W, H = img.size
    x, y, w, h = c["crop"]
    gl, gr, gt, gb = (c["gutters"] + [0, 0, 0, 0])[:4]
    # Screenshot pixels actually visible: inside the image and outside the painted gutters.
    vx0, vy0 = max(0, x + gl), max(0, y + gt)
    vx1, vy1 = min(W / k, x + w - gr), min(H / k, y + h - gb)
    cx, cy, r = c["cx"], c["cy"], c["r"]
    px = img.load()
    vals = []
    total = 0
    step = max(1, int(k / 2))
    for iy in range(int((cy - r) * k), int((cy + r) * k) + 1, step):
        for ix in range(int((cx - r) * k), int((cx + r) * k) + 1, step):
            dx, dy = ix / k - cx, iy / k - cy
            if dx * dx + dy * dy > r * r:
                continue
            total += 1
            if not (vx0 <= ix / k < vx1 and vy0 <= iy / k < vy1):
                continue
            vals.append(px[ix, iy])
    if not vals:
        out.append({**c, "ink": 0.0, "seen": 0.0})
        continue
    s = sorted(vals)
    bg = s[len(s) // 2]
    ink = sum(1 for v in vals if abs(v - bg) > 64) / max(1, total)
    out.append({**c, "ink": round(ink, 4), "seen": round(len(vals) / max(1, total), 3)})
json.dump(out, open(sys.argv[3], "w", encoding="utf-8"), ensure_ascii=False)
`;
const script = join(dir, "analyze.py");
writeFileSync(script, analyzer);
const result = spawnSync(python, [script, input, join(academy, "assets", "shots"), join(dir, "measured.json")], { stdio: "inherit", windowsHide: true });
if (result.status !== 0) throw new Error("marker analysis failed (needs Pillow; pass --python)");
const measured = JSON.parse(readFileSync(join(dir, "measured.json"), "utf8"));
const checked = measured.filter((row) => !row.overview);
const flagged = checked.filter((row) => row.ink > THRESHOLD && !ALLOW[`${row.image}|${row.marker}`]).sort((a, b) => b.ink - a.ink);
const allowedHits = checked.filter((row) => row.ink > THRESHOLD && ALLOW[`${row.image}|${row.marker}`]);
const cut = measured.filter((row) => row.inside < MIN_INSIDE);
// Two markers of one figure drawn on top of each other (centres closer than 90% of the two radii).
const clashes = [];
for (const [i, a] of measured.entries())
  for (const b of measured.slice(i + 1))
    if (a.where === b.where && a.fig === b.fig && Math.hypot(a.cx - b.cx, a.cy - b.cy) < 0.9 * (a.r + b.r))
      clashes.push({ where: a.where, owner: a.owner, figure: a.figure, image: a.image, markers: `${a.marker}+${b.marker}` });
const report = {
  threshold: THRESHOLD,
  markers: measured.length,
  print: measured.filter((row) => row.where === "print").length,
  web390: measured.filter((row) => row.where === "web-390" && !row.overview).length,
  web390OverviewSkipped: measured.filter((row) => row.overview).length,
  allowed: Object.entries(ALLOW).map(([key, reason]) => ({ key, reason, hits: allowedHits.filter((row) => `${row.image}|${row.marker}` === key).map(({ where, owner, ink }) => ({ where, owner, ink })) })),
  flagged: flagged.map(({ where, owner, figure, image, marker, ink }) => ({ where, owner, figure, image, marker, ink })),
  cutOff: cut.map(({ where, owner, figure, image, marker, inside }) => ({ where, owner, figure, image, marker, inside })),
  overlapping: clashes,
};
writeFileSync(join(dir, "marks.json"), JSON.stringify(report, null, 2));
console.log(`${report.print + report.web390} markers checked (print ${report.print}, web 390px ${report.web390}; ${report.web390OverviewSkipped} on phone overviews skipped); ${flagged.length} cover text above ${THRESHOLD * 100}%, ${allowedHits.length} allowed with a reason, ${cut.length} cut off, ${clashes.length} pairs overlapping`);
for (const row of flagged.slice(0, 60)) console.log(`  ${row.where} ${row.owner} ${row.figure} marker ${row.marker} (${row.image}) ink ${(row.ink * 100).toFixed(1)}%`);
for (const row of cut) console.log(`  CUT ${row.where} ${row.owner} ${row.figure} marker ${row.marker} (${row.image}) inside ${(row.inside * 100).toFixed(0)}%`);
for (const row of clashes) console.log(`  OVERLAP ${row.where} ${row.owner} ${row.figure} markers ${row.markers} (${row.image})`);
if (flagged.length || cut.length || clashes.length) process.exitCode = 1;
