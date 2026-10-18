// Interactive edition: one view per level / task, hash routing, checkboxes and notes kept in this
// browser only (localStorage, with the limits stated on screen), screenshots that open full size.
import { mkdirSync, writeFileSync, copyFileSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { academy, out, loadLevels, loadShots, corpus } from "./render.mjs";
import * as course from "../content/course.mjs";
import { buildReference } from "./reference.mjs";
import { project } from "./render.mjs";
import { esc, rich, seal, BRAND_SVG } from "./lib/markup.mjs";
import { figure } from "./lib/figure.mjs";

const IMG = "assets/shots/";
const paper = (text) => String(text ?? "").replace(/第 \{\{page:[^}]+\}\} 頁/g, "紙本講義").replace(/\{\{page:[^}]+\}\}/g, "紙本講義");
const ctx = { imageBase: IMG, fill: paper, rich: (text) => rich(paper(text)) };

function fig(shots, spec, number) {
  return figure(shots, { ...spec, number, caption: spec.caption ? ctx.fill(spec.caption) : undefined, width: "100%" }, { imageBase: IMG, lazy: true });
}

function figures(list = [], shots, prefix) {
  let count = 0;
  const numberOf = () => `圖 ${prefix}${String.fromCharCode(97 + count++)}`;
  return list
    .map((item) => {
      if (item.row)
        return `<div class="w-row">${item.row
          .map((cell) =>
            cell.text
              ? `<div class="w-cell w-cell-text"><p class="w-small">${ctx.rich(cell.text)}</p></div>`
              : `<div class="w-cell">${cell.label ? `<p class="w-figlabel">${esc(cell.label)}</p>` : ""}${fig(shots, cell, cell.caption ? numberOf() : undefined)}</div>`,
          )
          .join("")}</div>${item.caption ? `<p class="w-small">${ctx.rich(item.caption)}</p>` : ""}`;
      return fig(shots, item, item.caption ? numberOf() : undefined);
    })
    .join("");
}

let checkSerial = 0;
function checkbox(id, text) {
  checkSerial += 1;
  return `<li><label class="w-check"><input type="checkbox" data-key="${esc(id)}"><span>${ctx.rich(text)}</span></label></li>`;
}

function taskView(task, level, shots, reference) {
  const parts = [];
  parts.push(`<header class="w-taskhead"><p class="w-meta"><span class="w-id">TASK ${esc(task.id.replace("-", "·"))}</span><span>約 ${esc(task.minutes)} 分鐘</span>${task.lesson ? `<span class="w-chip">${esc(task.lesson)}</span>` : ""}${task.star ? `<span class="w-star">★ ${esc(course.achievements[task.star].en)}</span>` : ""}</p><h2>${ctx.rich(task.title)}</h2></header>`);
  if (task.goal)
    parts.push(`<div class="w-trio"><div><h3>這一關要完成</h3><p>${ctx.rich(task.goal)}</p></div><div><h3>為什麼要學</h3><p>${ctx.rich(task.why)}</p></div><div><h3>操作前準備</h3><ul>${(task.prep ?? []).map((item) => `<li>${ctx.rich(item)}</li>`).join("")}</ul></div></div>`);
  if (task.map) {
    parts.push(
      figure(
        shots,
        {
          shot: task.map.shot,
          caption: task.map.caption,
          number: `圖 ${task.id}`,
          ringPad: 0,
          gutter: task.map.gutter,
          marks: [
            ...task.map.zones.map((zone) => ({ n: zone.n, target: zone.target, pos: zone.pos, ring: false })),
            ...task.map.extras.map(([letter, target, , pos = "tl"]) => ({ n: letter, target, pos, letter: true, ring: false })),
          ],
          rings: task.map.zones.map((zone) => ({ target: zone.target, soft: true })),
          width: "100%",
        },
        { imageBase: IMG, lazy: true },
      ),
    );
    parts.push(`<ol class="w-legend">${task.map.zones.map((zone) => `<li><b class="w-dot">${zone.n}</b><span><strong>${esc(zone.name)}</strong>　${ctx.rich(zone.text)}</span></li>`).join("")}${task.map.extras.map(([letter, , text]) => `<li><b class="w-dot w-dot-letter">${letter}</b><span>${ctx.rich(text)}</span></li>`).join("")}</ol>`);
  }
  if (task.figures) parts.push(figures(task.figures, shots, task.id));
  if (task.sideFigure) parts.push(`<div class="w-side">${fig(shots, task.sideFigure, `圖 ${task.id}${String.fromCharCode(97 + (task.figures ?? []).length)}`)}</div>`);
  if (task.stages)
    parts.push(`<div class="w-stages">${task.stages.map((stage, index) => `<div><p class="w-figlabel">0${index + 1} · ${esc(stage.label)}</p>${figure(shots, { shot: stage.shot, crop: stage.crop, marks: [], width: "100%" }, { imageBase: IMG, lazy: true })}</div>`).join("")}</div>`);
  if (task.rules) parts.push(`<section class="w-block"><h3>任務規則</h3><ol class="w-rules">${task.rules.map((rule) => `<li>${ctx.rich(rule)}</li>`).join("")}</ol></section>`);
  if (task.timeline) parts.push(`<section class="w-block"><h3>時間配置</h3><ul class="w-timeline">${task.timeline.map(([time, text]) => `<li><b>${esc(time)}</b>${esc(text)}</li>`).join("")}</ul></section>`);
  if (task.aside) parts.push(`<p class="w-note"><b>${esc(task.aside.letter)}</b> ${ctx.rich(task.aside.text)}</p>`);
  if (task.example) parts.push(`<div class="w-example"><h3>示範 · 系統實際紀錄</h3><p>${ctx.rich(task.example)}</p></div>`);
  if (task.risks) parts.push(`<div class="w-risks">${task.risks.map(([name, text]) => `<div><h4>${esc(name)}</h4><p>${ctx.rich(text)}</p></div>`).join("")}</div>`);
  if (task.terms) parts.push(`<div class="w-terms">${task.terms.map(([name, text]) => `<div><h4>${esc(name)}</h4><p>${ctx.rich(text)}</p></div>`).join("")}</div>`);
  if (task.steps)
    parts.push(`<section class="w-block"><h3>逐步操作</h3><ol class="w-steps">${task.steps.map((step) => `<li><b class="w-n">${esc(step.n)}</b><div>${ctx.rich(step.text)}${step.sub ? `<p class="w-sub">${ctx.rich(step.sub)}</p>` : ""}</div></li>`).join("")}</ol></section>`);
  if (task.threshold && reference) {
    const [day5, day6] = reference.days;
    parts.push(`<section class="w-block"><h3>費稅門檻參考表（以昨收估算 1 張）</h3><div class="w-table"><table><thead><tr><th>股票</th><th>一檔</th><th>10/05 每股成本</th><th>至少幾檔</th><th>10/06 每股成本</th><th>至少幾檔</th></tr></thead><tbody>${day6.quotes.map((quote) => {
      const other = day5.quotes.find((item) => item.code === quote.code);
      return `<tr><td>${esc(quote.name)} ${esc(quote.code)}</td><td>${quote.tick}</td><td>${other.perShare.toFixed(2)}</td><td>${other.ticksToBreakEven}</td><td>${quote.perShare.toFixed(2)}</td><td><b>${quote.ticksToBreakEven}</b></td></tr>`;
    }).join("")}</tbody></table></div></section>`);
  }
  // Paper sheets: shown as their table format; answers go in the printed workbook.
  const sheets = [];
  if (task.record && !task.record.list)
    sheets.push({
      title: task.record.title,
      head: task.record.columns,
      example: task.record.example,
      rows: Array.isArray(task.record.rows)
        ? task.record.rows.map((name) => [name, ...task.record.columns.slice(1).map(() => "")])
        : Array.from({ length: task.record.rows ?? 2 }, () => task.record.columns.map(() => "")),
    });
  if (task.worksheet)
    sheets.push({
      title: task.worksheet.title,
      head: task.worksheet.head ?? ["項目", "我的紀錄"],
      rows: task.worksheet.head ? task.worksheet.rows : task.worksheet.rows.map(([name]) => [name, ""]),
    });
  if (task.ledger) sheets.push({ title: "對帳表", head: ["項目", "資料來源／算法", "金額（元）"], rows: task.ledger.rows.map(([name, source]) => [name, source, ""]) });
  for (const sheet of sheets) {
    const example = sheet.example ? `<tr class="w-example-row">${sheet.example.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>` : "";
    const rows = sheet.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ? ctx.rich(cell) : "&nbsp;"}</td>`).join("")}</tr>`).join("");
    parts.push(`<section class="w-block"><h3>${esc(sheet.title)}</h3><p class="w-small">請寫在紙本講義上；數位版只顯示表格格式${sheet.example ? "，藍底列是範例" : ""}。</p><div class="w-table"><table><thead><tr>${sheet.head.map((cell) => `<th>${esc(cell)}</th>`).join("")}</tr></thead><tbody>${example}${rows}</tbody></table></div></section>`);
  }
  if (task.record?.list) parts.push(`<section class="w-block"><h3>${esc(task.record.title)}</h3><ul class="w-checks">${task.record.list.map((item, index) => checkbox(`${task.id}:habit:${index}`, item)).join("")}</ul></section>`);
  if (task.adherence) parts.push(`<section class="w-block"><h3>遵守計畫檢查</h3><ul class="w-checks">${task.adherence.map((item, index) => checkbox(`${task.id}:adherence:${index}`, item)).join("")}</ul></section>`);
  if (task.expect) parts.push(`<div class="w-expect"><h3>預期看到</h3><p>${ctx.rich(task.expect)}</p>${task.expectFigure ? fig(shots, task.expectFigure, `圖 ${task.id}-結果`) : ""}</div>`);
  if (task.warn) parts.push(`<div class="w-warn"><h3>注意</h3><p>${ctx.rich(task.warn)}</p></div>`);
  if (task.trouble?.length)
    parts.push(`<section class="w-block"><h3>遇到問題</h3>${task.trouble.map(([problem, fix]) => `<details class="w-trouble"><summary>${ctx.rich(problem)}</summary><p>${ctx.rich(fix)}</p></details>`).join("")}</section>`);
  if (task.evidence) parts.push(`<section class="w-block"><h3>要交給講師的證據</h3><ul class="w-checks">${task.evidence.map((item, index) => checkbox(`${task.id}:evidence:${index}`, item)).join("")}</ul></section>`);
  if (task.rubric)
    parts.push(`<section class="w-block"><h3>評量方式（模擬損益不計分）</h3><div class="w-rubric">${task.rubric.map((part) => `<div><h4>${esc(part.name)} <span>${part.weight}%</span></h4><ul class="w-checks">${part.items.map((item, index) => checkbox(`${task.id}:${part.name}:${index}`, item)).join("")}</ul></div>`).join("")}</div></section>`);
  if (task.layout?.startsWith("sheet-"))
    parts.push(`<div class="w-note"><p>${esc(task.title)}是紙本作答頁，請寫在講義上（學員版 PDF 的期末任務章節）。完成後勾選：</p><ul class="w-checks">${checkbox(`${task.id}:done`, `${task.title}已完成`)}</ul></div>`);
  if (task.checks) parts.push(`<section class="w-block"><h3>自我檢查</h3><ul class="w-checks">${task.checks.map((item, index) => checkbox(`${task.id}:check:${index}`, item)).join("")}</ul></section>`);
  if (task.think)
    parts.push(`<section class="w-block"><h3>想一想</h3><p>${ctx.rich(task.think)}</p><textarea class="w-think" data-note="${esc(task.id)}:think" rows="3" placeholder="寫下你的想法（只存在這台裝置）"></textarea></section>`);
  if (task.next) parts.push(`<p class="w-next"><span>NEXT</span>${ctx.rich(task.next)}</p>`);
  return parts.join("\n");
}

function levelView(level) {
  const achievement = course.achievements[level.achievement];
  return `<header class="w-levelhead"><p class="w-eyebrow">${level.id === "FINAL" ? "FINAL MISSION" : `LEVEL ${esc(level.code)}`}</p><h1>${esc(level.title)}</h1><p class="w-en">${esc(level.en)}</p></header>
<blockquote class="w-goal"><span>成就目標</span>${ctx.rich(level.goal)}</blockquote>
<p class="w-lead">${ctx.rich(level.intro)}</p>
<div class="w-spec">${level.system.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${ctx.rich(value)}</dd></div>`).join("")}</div>
<div class="w-unlock" data-level-seal="${esc(level.id)}">${seal({ name: achievement.en, code: achievement.code, state: "locked", size: "84px", id: `web-${level.id}` })}<div><p class="w-eyebrow">完成本關解鎖</p><p><b>${esc(achievement.en)} Achievement</b>　${esc(achievement.zh)}</p><p class="w-progress-text" data-level-progress="${esc(level.id)}"></p></div></div>
<ol class="w-tasklist">${level.tasks.map((task) => `<li><a href="#${esc(task.id)}"><span>${esc(task.id)}</span>${esc(task.title)}${task.star ? " ★" : ""}<em data-task-progress="${esc(task.id)}"></em></a></li>`).join("")}</ol>`;
}

export async function renderWeb() {
  const levels = await loadLevels();
  const shots = loadShots();
  const reference = await buildReference(project);
  const views = [];
  views.push({
    id: "start",
    title: "開始之前",
    level: null,
    html: `<header class="w-levelhead"><p class="w-eyebrow">TRADING ACADEMY</p><h1>學員實戰闖關手冊</h1><p class="w-en">當沖大富翁 Day Trade Tycoon · 數位互動版</p></header>
<p class="w-lead">從第一個報價，到第一場完整的模擬當沖。每一關的節奏都一樣：看懂目標 → 照圖操作 → 立即驗證 → 完成挑戰 → 解鎖下一關。點下方的關卡開始，或用「下一頁」依序閱讀。</p>
<div class="w-storage" role="note"><h3>勾選會存在哪裡？</h3><p>你在這個數位版勾選的項目與寫下的想法，<b>只存在這台裝置的這個瀏覽器</b>（localStorage）。換手機或電腦、使用無痕視窗、清除瀏覽器資料，紀錄就會消失；也<b>不會傳給講師或教室系統</b>。正式的學習紀錄請以紙本講義、講師簽名與教室系統的復盤為準。</p><p class="w-storage-status" data-storage-status></p></div>
${course.notices.map((notice) => `<div class="w-notice"><h3>${esc(notice.title)}</h3><p>${ctx.rich(notice.body)}</p></div>`).join("")}
<section class="w-block"><h3>學習地圖</h3><ol class="w-map">${course.mapping
      .map((row) => {
        const key = Object.keys(course.achievements).find((name) => course.achievements[name].code === row.level);
        const id = row.level === "FINAL" ? "FINAL" : `L${row.level}`;
        return `<li><a href="#${id}"><b>${row.level === "FINAL" ? "FINAL" : `LEVEL ${esc(row.level)}`}</b><span>${esc(row.title)}</span><small>${esc(row.lesson)} · ${esc(row.round)} · 約 ${row.minutes} 分</small><em>★ ${esc(course.achievements[key].en)}</em></a></li>`;
      })
      .join("")}</ol></section>`,
  });
  for (const level of levels) {
    views.push({ id: level.id, title: level.id === "FINAL" ? "期末挑戰" : `LEVEL ${level.code}`, level: level.id, html: levelView(level) });
    for (const task of level.tasks) views.push({ id: task.id, title: `${task.id} ${task.title}`, level: level.id, task: true, html: taskView(task, level, shots, reference) });
  }
  views.push({
    id: "progress",
    title: "我的進度",
    level: null,
    html: `<header class="w-levelhead"><p class="w-eyebrow">MY PROGRESS</p><h1>我的進度</h1></header>
<div class="w-board" data-board>${Object.entries(course.achievements)
      .map(([key, item]) => `<div class="w-board-item" data-board-item="${esc(key === "final" ? "FINAL" : `L${item.code}`)}">${seal({ name: item.en, code: item.code, state: "locked", size: "76px", id: `web-board-${key}` })}<b>${esc(item.en)}</b><span>${esc(item.zh)}</span><em data-board-progress></em></div>`)
      .join("")}</div>
<div class="w-storage"><h3>這些紀錄存在哪裡</h3><p>只存在這台裝置的這個瀏覽器，不會上傳。換裝置或清除瀏覽器資料就會消失。</p><div class="w-actions"><button type="button" class="w-button" data-export>下載我的勾選紀錄（JSON）</button><button type="button" class="w-button w-button-quiet" data-reset>清除這台裝置的勾選與筆記</button></div></div>`,
  });
  views.push({
    id: "glossary",
    title: "術語表",
    level: null,
    html: `<header class="w-levelhead"><p class="w-eyebrow">GLOSSARY</p><h1>術語表</h1></header><dl class="w-glossary">${course.glossary.map(([name, taskId, text]) => `<div><dt>${esc(name)} <a href="#${esc(taskId)}">${esc(taskId)}</a></dt><dd>${ctx.rich(text)}</dd></div>`).join("")}</dl>`,
  });

  const nav = [`<a href="#start" data-nav="start">開始之前</a>`];
  for (const level of levels)
    nav.push(`<div class="w-navgroup"><a href="#${esc(level.id)}" data-nav="${esc(level.id)}" class="w-navlevel"><b>${level.id === "FINAL" ? "FINAL" : esc(level.code)}</b>${esc(level.title)}<i data-nav-progress="${esc(level.id)}"></i></a>${level.tasks.map((task) => `<a href="#${esc(task.id)}" data-nav="${esc(task.id)}" class="w-navtask">${esc(task.id)} ${esc(task.title)}</a>`).join("")}</div>`);
  nav.push(`<a href="#progress" data-nav="progress">我的進度</a>`, `<a href="#glossary" data-nav="glossary">術語表</a>`);

  const body = `<a class="w-skip" href="#w-main">跳到內容</a>
<header class="w-bar"><button type="button" class="w-menu" aria-expanded="false" aria-controls="w-nav">目錄</button><a class="w-brand" href="#start">${BRAND_SVG}<span><b>當沖大富翁</b><small>學員實戰闖關手冊</small></span></a><div class="w-total" aria-live="polite"><span data-total-text>0%</span><i><b data-total-bar style="width:0%"></b></i></div></header>
<div class="w-layout"><nav id="w-nav" class="w-nav" aria-label="講義目錄">${nav.join("")}</nav>
<main id="w-main" class="w-main" tabindex="-1">${views
    .map((view, index) => `<article class="w-view${view.task ? " w-task" : ""}" id="view-${esc(view.id)}" data-view="${esc(view.id)}" data-level="${esc(view.level ?? "")}" data-title="${esc(view.title)}" ${index ? "hidden" : ""}>${view.html}</article>`)
    .join("\n")}
<nav class="w-pager" aria-label="上一頁／下一頁"><a data-prev href="#start">← 上一頁</a><a data-next href="#start">下一頁 →</a></nav>
<footer class="w-foot">模擬交易教學 · 非投資建議 · 截圖取自系統 release ${esc(course.edition.release)}（${esc(course.edition.captured)}）</footer></main></div>
<div class="w-lightbox" hidden role="dialog" aria-modal="true" aria-label="放大的截圖"><button type="button" class="w-lightbox-close">關閉</button><div class="w-lightbox-body"></div></div>
<script>window.ACADEMY_VIEWS=${JSON.stringify(views.map((view) => ({ id: view.id, level: view.level, task: Boolean(view.task) })))};</script>
<script src="assets/web.js"></script>`;

  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>學員實戰闖關手冊</title>
<meta name="description" content="當沖大富翁 Trading Academy 學員實戰闖關手冊數位互動版：六個關卡與期末任務，真實系統截圖、逐步操作與完成勾選。">
<link rel="stylesheet" href="assets/web.css">
</head>
<body>
${body}
</body>
</html>`;

  const dir = join(out, "web");
  mkdirSync(join(dir, "assets", "shots"), { recursive: true });
  mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  copyFileSync(join(academy, "design", "web.css"), join(dir, "assets", "web.css"));
  copyFileSync(join(academy, "design", "web.js"), join(dir, "assets", "web.js"));
  const used = new Set([...html.matchAll(/assets\/shots\/([^"]+\.png)/g)].map((match) => match[1]));
  for (const file of used) copyFileSync(join(academy, "assets", "shots", file), join(dir, "assets", "shots", file));
  const fonts = join(out, "fonts");
  if (existsSync(fonts)) for (const file of readdirSync(fonts).filter((name) => name.endsWith(".woff2"))) copyFileSync(join(fonts, file), join(dir, "assets", "fonts", file));
  return { html, text: corpus(html), images: used.size };
}
