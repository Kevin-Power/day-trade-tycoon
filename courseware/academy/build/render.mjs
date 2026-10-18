// Renders the workbook HTML (student print, instructor print, web) from content + captured screens.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Book } from "./lib/book.mjs";
import { addFront, addLevel, addBack } from "./lib/student.mjs";
import { buildReference } from "./reference.mjs";
import * as course from "../content/course.mjs";

export const academy = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const project = resolve(academy, "../..");
export const out = join(academy, "output");

export async function loadLevels() {
  const levels = [];
  for (const name of ["l01", "l02", "l03", "l04", "l05", "l06", "final"]) {
    const file = join(academy, "content", `${name}.mjs`);
    if (existsSync(file)) levels.push((await import(pathToFileURL(file).href)).default);
  }
  return levels;
}

/** The release and date the screenshots were taken from (written by the capture run). */
export function applyCaptureEdition() {
  const file = join(academy, "assets", "shots", "capture-summary.json");
  if (!existsSync(file)) return null;
  const summary = JSON.parse(readFileSync(file, "utf8"));
  const taipei = new Date(new Date(summary.finishedAt).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10).replaceAll("-", "/");
  course.edition.release = summary.release;
  course.edition.captured = taipei;
  return summary;
}

export function loadShots() {
  return JSON.parse(readFileSync(join(academy, "assets", "shots", "shots.json"), "utf8"));
}

/**
 * Cover art from real data: the five lesson stocks on 2026/10/06, 09:00–10:30, each minute close as
 * % change from its previous close. 台積電 (the workbook's main example) is the highlighted line.
 */
export function coverArt() {
  const data = JSON.parse(readFileSync(join(project, "server", "data", "morning-2026-10-06.json"), "utf8"));
  const series = data.catalog.symbols.map((symbol) => ({
    code: symbol.code,
    name: symbol.name,
    points: data.bars[symbol.code].map((bar) => ((bar.c - symbol.previousClose) / symbol.previousClose) * 100),
  }));
  const values = series.flatMap((item) => item.points);
  const low = Math.min(...values, 0) - 0.4;
  const high = Math.max(...values, 0) + 0.4;
  const [x0, x1, y0, y1] = [20, 190, 186, 238];
  const count = series[0].points.length;
  const x = (index) => x0 + ((x1 - x0) * index) / (count - 1);
  const y = (value) => y1 - ((value - low) / (high - low)) * (y1 - y0);
  const grid = [];
  for (let gx = x0; gx <= x1 + 0.01; gx += (x1 - x0) / 9)
    grid.push(`<line x1="${gx.toFixed(2)}" y1="${y0 - 4}" x2="${gx.toFixed(2)}" y2="${y1 + 4}" stroke="#161d26" stroke-width="0.18"/>`);
  for (let level = Math.ceil(low); level <= Math.floor(high); level += 1)
    grid.push(`<line x1="${x0}" y1="${y(level).toFixed(2)}" x2="${x1}" y2="${y(level).toFixed(2)}" stroke="#161d26" stroke-width="0.18"/>`);
  const line = (points) => points.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(2)} ${y(value).toFixed(2)}`).join(" ");
  const others = series
    .filter((item) => item.code !== "2330")
    .map((item) => `<path d="${line(item.points)}" fill="none" stroke="#3a475a" stroke-width="0.32" stroke-linejoin="round"/>`)
    .join("");
  const main = series.find((item) => item.code === "2330");
  const last = main.points.length - 1;
  return `${grid.join("")}
<line x1="${x0}" y1="${y(0).toFixed(2)}" x2="${x1}" y2="${y(0).toFixed(2)}" stroke="#55606f" stroke-width="0.25" stroke-dasharray="1.2 1.2"/>
${others}
<path d="${line(main.points)}" fill="none" stroke="#5b8cff" stroke-width="0.6" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${x(last).toFixed(2)}" cy="${y(main.points[last]).toFixed(2)}" r="0.9" fill="#5b8cff"/>
<text x="${x0}" y="${y1 + 9}" font-family="WB Mono, WB Sans, monospace" font-size="2.1" letter-spacing="0.45" fill="#5a6474">2026/10/06 09:00–10:30 · 五檔教材股票分鐘收盤價漲跌幅（%）· 藍線為台積電</text>
<text x="${x1 + 1.6}" y="${(y(0) + 0.7).toFixed(2)}" font-family="WB Mono, WB Sans, monospace" font-size="1.9" fill="#5a6474">昨收 0%</text>`;
}

function fontFaces() {
  const sans = [400, 500, 700, 900]
    .map((weight) => `@font-face{font-family:"WB Sans";src:url("../fonts/noto-sans-tc-${weight}.woff2") format("woff2");font-weight:${weight};font-style:normal;font-display:block}`)
    .join("\n");
  const mono = [300, 400, 500, 600]
    .map((weight) => `@font-face{font-family:"WB Mono";src:url("../fonts/ibm-plex-mono-latin-${weight}-normal.woff2") format("woff2");font-weight:${weight};font-style:normal;font-display:block}`)
    .join("\n");
  return `${sans}\n${mono}`;
}

export function htmlDocument({ title, body, css, lang = "zh-Hant", extraHead = "" }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${fontFaces()}</style>
${css.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n")}
${extraHead}
</head>
<body>
${body}
</body>
</html>`;
}

/** Every character the fonts must contain (text, attributes, SVG text). */
export function corpus(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export async function renderStudent() {
  applyCaptureEdition();
  const levels = await loadLevels();
  const shots = loadShots();
  const book = new Book({ kind: "student", title: course.edition.title, legal: "學員實戰闖關手冊 · 模擬交易教學，非投資建議", imageBase: "../../assets/shots/" });
  const reference = await buildReference(project);
  const backToc = [
    ["總完成清單", "board"],
    ["練習紀錄表", "practice-log"],
    ["術語表", "glossary-1"],
    ["心得紀錄", "notes-1"],
    ["資料來源、版本與聲明", "colophon"],
  ];
  const data = { ...course, shots, levels, reference, backToc, cover: coverArt() };
  addFront(book, data);
  for (const level of levels) addLevel(book, level, data);
  addBack(book, data);
  const body = book.render();
  const html = htmlDocument({
    title: `${course.edition.brand}｜${course.edition.title}`,
    body,
    css: ["../../design/print.css"],
  });
  return { html, pages: book.pages.length, pageMap: Object.fromEntries(book.pages.map((page, index) => [page.id, index + 1])) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(join(out, "print"), { recursive: true });
  const student = await renderStudent();
  writeFileSync(join(out, "print", "student.html"), student.html);
  writeFileSync(join(out, "corpus.txt"), corpus(student.html));
  console.log(`student.html: ${student.pages} pages`);
}
