import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { iconSize, type IconComponent } from "./icon.ts";
import * as icons from "./index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const all = Object.entries(icons) as [string, IconComponent][];
const render = (Icon: IconComponent, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(Icon, props));

function sourceFiles() {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(ts|tsx)$/.test(name)) files.push(file);
    }
  };
  walk(join(root, "src"));
  return files;
}

test("the icon module exports exactly the icons the app imports", () => {
  const imported = new Set<string>();
  for (const file of sourceFiles())
    for (const match of readFileSync(file, "utf8").matchAll(/import\s*\{([^}]+)\}\s*from\s*"@\/lib\/icons"/g))
      for (const name of match[1].split(",").map((part) => part.trim()).filter(Boolean)) imported.add(name);
  assert.deepEqual([...imported].sort(), all.map(([name]) => name).sort());
});

test("every icon is drawn on the 15-unit grid at 15px", () => {
  for (const [name, Icon] of all) {
    const html = render(Icon);
    assert.match(html, /^<svg [^>]*viewBox="0 0 15 15"/, name);
    assert.match(html, / width="15" height="15"/, name);
    assert.match(html, / fill="none"/, name);
    assert.match(html, / class="icon"/, name);
    assert.ok(Icon.paths.length > 0, name);
  }
});

test("requested sizes snap to whole multiples of the grid", () => {
  const cases: [number | undefined, number][] = [
    [undefined, 15],
    [14, 15],
    [16, 15],
    [18, 15],
    [20, 15],
    [22, 15],
    [24, 30],
    [28, 30],
    [32, 30],
    [36, 30],
    [40, 45],
    [0, 15],
  ];
  for (const [requested, expected] of cases) assert.equal(iconSize(requested), expected, `size ${requested}`);
  assert.match(render(icons.ArrowRight, { size: 20 }), / width="15" height="15"/);
  assert.match(render(icons.ArrowRight, { size: 24 }), / width="30" height="30"/);
  assert.match(render(icons.TriangleAlert, { size: 40 }), / width="45" height="45"/);
});

test("icons are hidden from screen readers unless they are labelled", () => {
  assert.match(render(icons.Check), / aria-hidden="true"/);
  const labelled = render(icons.Check, { "aria-label": "已完成" });
  assert.doesNotMatch(labelled, /aria-hidden/);
  assert.match(labelled, / aria-label="已完成"/);
  assert.match(labelled, / role="img"/);
});

test("class names and other attributes pass through", () => {
  const html = render(icons.RefreshCw, { className: "animate-spin text-brand", "data-state": "busy" });
  assert.match(html, / class="icon animate-spin text-brand"/);
  assert.match(html, / data-state="busy"/);
});

// Path commands and how many numbers each takes; arc flags are single digits that may touch the next number.
const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Straight segments of an SVG path in absolute coordinates: [x0, y0, x1, y1]. Curves only move the pen. */
function straightSegments(d: string): [number, number, number, number][] {
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const number = () => {
    skip();
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!match) throw new Error(`number expected at ${i} in ${d}`);
    i += match[0].length;
    return Number(match[0]);
  };
  const flag = () => {
    skip();
    const char = d[i++];
    if (char !== "0" && char !== "1") throw new Error(`arc flag expected at ${i - 1} in ${d}`);
    return Number(char);
  };
  const segments: [number, number, number, number][] = [];
  let [x, y, startX, startY] = [0, 0, 0, 0];
  let command: string | null = null;
  for (skip(); i < d.length; skip()) {
    if (/[a-zA-Z]/.test(d[i])) command = d[i++];
    else if (!command) throw new Error(`command expected at ${i} in ${d}`);
    const kind = command.toLowerCase();
    const args =
      kind === "a"
        ? [number(), number(), number(), flag(), flag(), number(), number()]
        : Array.from({ length: ARGS[kind] }, number);
    const [ox, oy] = command === kind ? [x, y] : [0, 0];
    let [nx, ny] = [x, y];
    if (kind === "m") [nx, ny] = [startX, startY] = [ox + args[0], oy + args[1]];
    else if (kind === "l") [nx, ny] = [ox + args[0], oy + args[1]];
    else if (kind === "h") nx = ox + args[0];
    else if (kind === "v") ny = oy + args[0];
    else if (kind === "z") [nx, ny] = [startX, startY];
    else [nx, ny] = [ox + args[args.length - 2], oy + args[args.length - 1]];
    if ("lhvz".includes(kind)) segments.push([x, y, nx, ny]);
    [x, y] = [nx, ny];
    if (kind === "z") command = null;
    else if (command === "M") command = "L";
    else if (command === "m") command = "l";
  }
  return segments;
}

test("the path reader follows relative moves, implicit lines and packed arc flags", () => {
  assert.deepEqual(straightSegments("M1 1.5h3v2z"), [
    [1, 1.5, 4, 1.5],
    [4, 1.5, 4, 3.5],
    [4, 3.5, 1, 1.5],
  ]);
  assert.deepEqual(straightSegments("M1 1 2 2m1 0l1 1"), [
    [1, 1, 2, 2],
    [3, 2, 4, 3],
  ]);
  assert.deepEqual(straightSegments("M.5 3.5a1 1 0 001-1h2"), [[1.5, 2.5, 3.5, 2.5]]);
});

test("straight 1-unit strokes run through pixel centres, so they fill whole pixels at 1x and 2x", () => {
  const offCentre = (value: number) => Math.abs((((value % 1) + 1) % 1) - 0.5) > 0.02;
  const misses: string[] = [];
  for (const [name, Icon] of all)
    for (const path of Icon.paths) {
      if (!path.stroke) continue;
      assert.equal(path.strokeWidth, undefined, `${name} must keep the 1-unit stroke`);
      for (const [x0, y0, x1, y1] of straightSegments(path.d)) {
        if (Math.hypot(x1 - x0, y1 - y0) < 0.5) continue;
        if (Math.abs(y1 - y0) < 1e-6 && offCentre(y0)) misses.push(`${name}: horizontal at y=${y0}`);
        if (Math.abs(x1 - x0) < 1e-6 && offCentre(x0)) misses.push(`${name}: vertical at x=${x0}`);
      }
    }
  assert.deepEqual(misses, []);
});

test("the app no longer imports lucide-react", () => {
  const users = sourceFiles().filter((file) => /from\s*["']lucide-react["']/.test(readFileSync(file, "utf8")));
  assert.deepEqual(users, []);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.dependencies?.["lucide-react"], undefined);
});

test("the generated icon module matches its sources", () => {
  const result = spawnSync(process.execPath, [join(root, "scripts/build-icons.mjs"), "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
