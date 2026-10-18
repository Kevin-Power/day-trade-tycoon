// Interactive edition: one view per level / task, hash routing, and the learner's own work (answers,
// self-checks, notes) kept in this browser with a visible save state, versioned export / import and
// backups. Completion follows each task's required items only (build/lib/forms.mjs), never "every
// checkbox on the page". Screenshots open in a zoom viewer whose markers share the image's coordinates.
import { mkdirSync, writeFileSync, copyFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { academy, out, loadLevels, loadShots, corpus, project, applyCaptureEdition } from "./render.mjs";
import * as course from "../content/course.mjs";
import * as digital from "../content/digital.mjs";
import { buildReference, buildMinuteTable } from "./reference.mjs";
import { esc, rich, seal, BRAND_SVG } from "./lib/markup.mjs";
import { figure, resolveCrop, markerPoint } from "./lib/figure.mjs";
import { taskForm, quickForm, STOCKS, TRI } from "./lib/forms.mjs";

const IMG = "assets/shots/";
let KNOWN = new Set();

/** Web wording: page references become links; 「任務 04-5」 and the L05 rule card link to their views. */
function fill(text) {
  return String(text ?? "")
    .replace(/第 \{\{page:warmup\}\} 頁的課前暖身/g, "⟦QUICK⟧")
    .replace(/\{\{page:[^}]+\}\}/g, "");
}
function webRich(text) {
  return rich(fill(text))
    .replace(/⟦QUICK⟧/g, '<a href="#Q">課前小任務頁</a>的說明')
    .replace(/任務 ((?:0[1-6]|F)-[1-9])/g, (all, id) => (KNOWN.has(id) ? `<a href="#${id}">任務 ${id}</a>` : all))
    .replace(/『我的交易規則卡』/g, '<a href="#L05">『我的交易規則卡』</a>');
}

function fig(shots, spec, number, extra = {}) {
  const caption = spec.caption ? fill(spec.caption).replace(/⟦QUICK⟧/g, "課前小任務") : undefined;
  return figure(shots, { ...spec, number, caption, width: "100%", ...extra }, { imageBase: IMG, lazy: true, interactive: true });
}

/** Close-ups around each marker of a wide screenshot, so the step's button is readable on a phone. */
const GUTTERS = { gl: "gutter", gr: "gutterRight", gt: "gutterTop", gb: "gutterBottom" };
function localCrop(shots, spec, mark) {
  const shot = shots[spec.shot];
  if (mark.crop) {
    const gutters = Object.fromEntries(Object.values(GUTTERS).filter((key) => mark[key]).map((key) => [key, mark[key]]));
    return { shot: spec.shot, crop: mark.crop, ...gutters, marks: [{ ...mark, crop: undefined }], rings: [] };
  }
  const box = mark.target ? shot.boxes[mark.target] : mark.box;
  const pos = mark.pos;
  // A gutter marker keeps a painted gutter in the close-up too, so it never lands on the text at the element's
  // edge; the gutter is wide enough for the phone-size marker at the close-up's scale.
  const gutterKey = GUTTERS[pos];
  const gutter = gutterKey ? { [gutterKey]: Math.max(48, spec[gutterKey] ?? 0) } : {};
  const edge = { gl: [box.x, box.y + box.h / 2], gr: [box.x + box.w, box.y + box.h / 2], gt: [box.x + box.w / 2, box.y], gb: [box.x + box.w / 2, box.y + box.h] };
  const [mx, my] = gutterKey ? edge[pos] : markerPoint(box, pos, { x: 0, y: 0, w: shot.width, h: shot.height });
  // Room around the anchor: a side marker sits wholly beyond the element's edge; on a gutter side the painted
  // gutter holds the marker, so the picture starts just before the element.
  const reach = 48;
  const room = { l: [reach, 0, 16, 16], r: [0, reach, 16, 16], t: [16, 16, reach, 0], b: [16, 16, 0, reach] }[pos] ?? [16, 16, 16, 16];
  const tight = { gl: [10, 16, 16, 16], gr: [16, 10, 16, 16], gt: [16, 16, 6, 16], gb: [16, 16, 16, 6] }[pos];
  const [left, right, up, down] = tight ?? room;
  let x0 = Math.min(box.x, mx - left) - (pos === "gl" ? 0 : 22);
  let y0 = Math.min(box.y, my - up) - (pos === "gt" ? 0 : 16);
  let x1 = Math.max(box.x + box.w, mx + right) + (pos === "gr" ? 0 : 22);
  let y1 = Math.max(box.y + box.h, my + down) + (pos === "gb" ? 0 : 16);
  const [minW, minH, maxW, maxH] = [340, 140, 620, 340];
  // Grow to the minimum size away from a gutter side, so the gutter stays next to the element.
  if (x1 - x0 < minW) [x0, x1] = pos === "gl" ? [x0, x0 + minW] : pos === "gr" ? [x1 - minW, x1] : [(x0 + x1) / 2 - minW / 2, (x0 + x1) / 2 + minW / 2];
  if (y1 - y0 < minH) [y0, y1] = pos === "gt" ? [y0, y0 + minH] : pos === "gb" ? [y1 - minH, y1] : [(y0 + y1) / 2 - minH / 2, (y0 + y1) / 2 + minH / 2];
  if (x1 - x0 > maxW) [x0, x1] = [Math.max(x0, mx - 60), Math.max(x0, mx - 60) + maxW];
  if (y1 - y0 > maxH) [y0, y1] = [Math.max(y0, my - 60), Math.max(y0, my - 60) + maxH];
  const shiftX = Math.max(0, -x0) - Math.max(0, x1 - shot.width);
  const shiftY = Math.max(0, -y0) - Math.max(0, y1 - shot.height);
  const crop = { x: Math.max(0, x0 + shiftX), y: Math.max(0, y0 + shiftY), w: Math.min(shot.width, x1 - x0), h: Math.min(shot.height, y1 - y0) };
  const ring = mark.ring === false && mark.target ? [{ target: mark.target, soft: true }] : [];
  return { shot: spec.shot, crop, ...gutter, marks: [{ ...mark, pos }], rings: ring };
}

function localCrops(shots, spec, number, picks = null) {
  const shot = shots[spec.shot];
  const crop = resolveCrop(shot, spec.crop);
  const marks = (picks ?? spec.marks ?? []).filter((mark) => mark.n !== undefined && (mark.target || mark.box));
  if (!picks && (crop.w <= 760 || !marks.length || marks.length > 6)) return "";
  const items = marks
    .map((mark) => {
      const local = localCrop(shots, spec, mark);
      return `<div class="w-local">${figure(shots, { ...local, number: `標號 ${mark.n}`, caption: mark.label ?? "附近放大", src: "局部放大", width: "100%" }, { imageBase: IMG, lazy: true, interactive: true })}</div>`;
    })
    .join("");
  return `<div class="w-locals"><p class="w-figlabel">${picks ? "先認識這三區（局部放大）" : `局部放大 · ${esc(number ?? "")}`}</p><div class="w-locals-row">${items}</div></div>`;
}

function figures(list = [], shots, prefix) {
  let count = 0;
  const numberOf = () => `圖 ${prefix}${String.fromCharCode(97 + count++)}`;
  return list
    .map((item) => {
      if (item.row)
        return `<div class="w-row">${item.row
          .map((cell) => {
            if (cell.text) return `<div class="w-cell w-cell-text"><p class="w-small">${webRich(cell.text)}</p></div>`;
            const number = cell.caption ? numberOf() : undefined;
            return `<div class="w-cell">${cell.label ? `<p class="w-figlabel">${esc(cell.label)}</p>` : ""}${fig(shots, cell, number)}${localCrops(shots, cell, number)}</div>`;
          })
          .join("")}</div>${item.caption ? `<p class="w-small">${webRich(item.caption)}</p>` : ""}`;
      const number = item.caption ? numberOf() : undefined;
      return fig(shots, item, number) + localCrops(shots, item, number);
    })
    .join("");
}

/* ───────────── form parts (tables are drawn by web.js from the same model) ───────────── */
const pill = (text, quiet = false) => `<span class="w-pill${quiet ? " w-pill-quiet" : ""}">${esc(text)}</span>`;

function control(field) {
  const key = esc(field.key);
  const aria = ` aria-label="${esc(field.label)}"`;
  if (field.type === "area") return `<textarea class="w-in w-area" data-field="${key}" rows="3"${aria} placeholder="${esc(field.hint ?? "")}"></textarea>`;
  if (field.type === "select")
    return `<select class="w-in" data-field="${key}"${aria}><option value="">選擇</option>${field.options.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join("")}</select>`;
  if (field.type === "tri")
    return `<div class="w-seg" role="radiogroup"${aria}>${TRI.map(([value, text]) => `<label><input type="radio" name="${key}" value="${value}" data-field="${key}"><span>${text}</span></label>`).join("")}</div>`;
  const mode = field.type === "num" ? ' inputmode="decimal"' : field.type === "time" ? ' inputmode="numeric" placeholder="09:20"' : "";
  return `<input class="w-in" type="text" data-field="${key}"${aria}${mode}${field.hint && field.type !== "time" ? ` placeholder="${esc(field.hint)}"` : ""}>`;
}

function partHtml(part, task) {
  switch (part.kind) {
    case "intro":
      return `<p class="w-lead">${webRich(part.text)}</p>`;
    case "table":
      return `<section class="w-block w-sheet" data-sheet="${esc(part.prefix)}"><h3>${esc(part.title)} ${pill("作答")}</h3>${part.note ? `<p class="w-small">${webRich(part.note)}</p>` : ""}${
        part.example
          ? `<div class="w-eg"><p class="w-eg-label">${esc(part.exampleNote || "範例（不是你的答案）")}</p><dl>${part.example.map((cell, index) => `<div><dt>${esc(part.cols[index]?.label ?? "")}</dt><dd>${esc(cell)}</dd></div>`).join("")}</dl></div>`
          : ""
      }<div class="w-form-table" data-table="${esc(part.prefix)}"></div>${part.dynamic ? `<div class="w-row-actions"><button type="button" class="w-button w-button-quiet" data-add-row="${esc(part.prefix)}">＋ 新增一列</button></div>` : ""}<p class="w-sheet-status" data-sheet-status="${esc(part.prefix)}"></p>${part.verify ? `<div class="w-verify" data-verify="${esc(part.prefix)}" aria-live="polite"></div>` : ""}</section>`;
    case "choice":
      return `<fieldset class="w-block w-choice"><legend>${esc(part.title)} ${pill("只選一個")}</legend>${part.options
        .map((option, index) => `<label class="w-radio"><input type="radio" name="${esc(part.key)}" value="${index}" data-field="${esc(part.key)}"><span>${webRich(option)}</span></label>`)
        .join("")}<label class="w-radio"><input type="radio" name="${esc(part.key)}" value="other" data-field="${esc(part.key)}"><span>其他（自己寫）</span></label><input class="w-in" type="text" data-field="${esc(part.key)}:other" aria-label="其他：我要檢查的習慣" placeholder="選「其他」時寫下你要檢查的習慣"></fieldset>`;
    case "tri-list":
      return `<section class="w-block w-tri"><h3>${esc(part.title)} ${pill("作答")}</h3><p class="w-small">每題選「是／否／不適用」。選「否」或「不適用」時寫一句原因——誠實的「否」也算完成，而且是復盤最有用的材料。</p><ol class="w-tri-list">${part.items
        .map(
          (item, index) =>
            `<li><fieldset><legend><b>${index + 1}</b>${webRich(item)}</legend><div class="w-seg">${TRI.map(([value, text]) => `<label><input type="radio" name="${esc(part.prefix)}:${index}" value="${value}" data-field="${esc(part.prefix)}:${index}"><span>${text}</span></label>`).join("")}</div><input class="w-in w-why" type="text" data-field="${esc(part.prefix)}:${index}:why" aria-label="第 ${index + 1} 題的原因" placeholder="原因（選否或不適用時必填）"></fieldset></li>`,
        )
        .join("")}</ol></section>`;
    case "fields":
    case "pnl":
      return `<section class="w-block w-fields"><h3>${esc(part.title)} ${pill("作答")}</h3><div class="w-field-grid">${part.fields
        .map((field) => {
          const item = { ...field, key: field.key ?? `${part.prefix}:${field.id}`, type: field.type ?? (field.input === "tri" ? "tri" : field.input === "area" ? "area" : Array.isArray(field.input) ? "select" : field.input) };
          if (Array.isArray(field.input)) item.options = field.input.map((value) => [value, value]);
          if (field.input === "stock") Object.assign(item, { type: "select", options: STOCKS.map(([code, name]) => [code, `${name} ${code}`]) });
          const need = field.need || field.needUnlessNoTrade;
          return `<div class="w-field${item.type === "area" ? " w-field-wide" : ""}"><span class="w-field-label">${esc(field.label)}${need ? pill(field.needUnlessNoTrade ? "必填（有成交時）" : "必填") : pill("選填", true)}</span>${field.hint && item.type !== "area" ? `<small>${esc(field.hint)}</small>` : ""}${control(item)}</div>`;
        })
        .join("")}</div></section>`;
    case "evidence":
      return `<section class="w-block"><h3>要交給講師的證據 ${pill("繳交清單")}</h3><ul class="w-checks">${part.items
        .map((item, index) => {
          const auto = /期末計畫單/.test(item) ? "F-3" : /決策日誌/.test(item) ? "F-4" : /期末報告/.test(item) ? "F-5" : null;
          return auto
            ? `<li class="w-auto"><span class="w-auto-mark" data-auto="${auto}" aria-hidden="true"></span><span>${webRich(item.replace("講義：", "數位作業："))} <a href="#${auto}">前往 ${auto}</a><small data-auto-text="${auto}"></small></span></li>`
            : `<li><label class="w-check"><input type="checkbox" data-check="${esc(part.key)}:${index}"><span>${webRich(item)} ${pill("選做", true)}</span></label></li>`;
        })
        .join("")}</ul></section>`;
    case "toggle":
      return `<label class="w-check w-toggle"><input type="checkbox" data-check="${esc(part.key)}"><span>${esc(part.label)}</span></label>`;
    case "confirm":
      return "";
    case "teacher":
      return `<p class="w-teacher">講師確認：${esc(part.label)}——由講師在「我的學習成果冊」列印頁簽名；數位版不會自動產生。</p>`;
    default:
      return "";
  }
}

/** Self-checks: the learner's own confirmation (自評), required. Rubric items are optional. */
function checksHtml(task, form) {
  const selfReq = form.req.filter((item) => item.t === "check" && item.self);
  if (!selfReq.length) return "";
  return `<section class="w-block"><h3>自我檢查 ${pill("自評")}</h3><p class="w-small">做到了再勾。勾選是你自己的確認，不是系統驗證。</p><ul class="w-checks">${selfReq
    .map((item) => `<li><label class="w-check"><input type="checkbox" data-check="${esc(item.key)}"><span>${webRich(item.label)}</span></label></li>`)
    .join("")}</ul></section>`;
}

function taskView(task, level, shots, reference, form) {
  const parts = [];
  parts.push(`<header class="w-taskhead"><p class="w-meta"><span class="w-id">TASK ${esc(task.id.replace("-", "·"))}</span><span>約 ${esc(task.minutes)} 分鐘</span>${task.lesson ? `<span class="w-chip">${esc(task.lesson)}</span>` : ""}${task.star ? `<span class="w-star">★ ${esc(course.achievements[task.star].en)}</span>` : ""}<span class="w-task-state" data-task-state="${esc(task.id)}"></span></p><h2>${webRich(task.title)}</h2></header>`);
  if (task.goal)
    parts.push(`<div class="w-trio"><div><h3>這一關要完成</h3><p>${webRich(task.goal)}</p></div><div><h3>為什麼要學</h3><p>${webRich(task.why)}</p></div><div><h3>操作前準備</h3><ul>${(task.prep ?? []).map((item) => `<li>${webRich(item)}</li>`).join("")}</ul></div></div>`);
  if (task.map) {
    // Digital 01-4: the three zones this task uses first; the full ten-zone map stays one tap away.
    const zones = task.map.zones;
    const mapSpec = {
      shot: task.map.shot,
      caption: task.map.caption,
      ringPad: 0,
      gutter: task.map.gutter,
      marks: [
        ...zones.map((zone) => ({ n: zone.n, target: zone.target, pos: zone.pos, ring: false })),
        ...task.map.extras.map(([letter, target, , pos = "tl"]) => ({ n: letter, target, pos, letter: true, ring: false })),
      ],
      rings: zones.map((zone) => ({ target: zone.target, soft: true })),
    };
    // Readable close-ups of the three zones (capture pixels of the 09:03 desk).
    const picks = [
      { n: 1, target: "clock", pos: "gt", ring: false, crop: { x: 416, y: 0, w: 380, h: 46 }, gutterTop: 34, label: "①狀態列：時鐘、本輪損益、可用資金" },
      { n: 2, target: "replay", pos: [-14, 17], ring: false, crop: { x: 800, y: 0, w: 294, h: 46 }, label: "②重播控制：「+1 分」在這裡" },
      { n: 5, target: "hero", pos: [250, 50], ring: false, crop: { x: 250, y: 64, w: 480, h: 112 }, label: "⑤報價區：名稱、最新價、漲跌" },
    ];
    parts.push(localCrops(shots, { ...mapSpec, crop: null }, null, picks));
    parts.push(
      `<details class="w-mapref"><summary>工作台十個區塊總覽（參考，用到時再查）</summary>${fig(shots, mapSpec, `圖 ${task.id}`)}<ol class="w-legend">${zones
        .map((zone) => `<li><b class="w-dot">${zone.n}</b><span><strong>${esc(zone.name)}</strong>　${webRich(zone.text)}</span></li>`)
        .join("")}${task.map.extras.map(([letter, , text]) => `<li><b class="w-dot w-dot-letter">${letter}</b><span>${webRich(text)}</span></li>`).join("")}</ol></details>`,
    );
  }
  if (task.figures) parts.push(figures(task.figures, shots, task.id));
  if (task.sideFigure) parts.push(`<div class="w-side">${fig(shots, task.sideFigure, `圖 ${task.id}${String.fromCharCode(97 + (task.figures ?? []).length)}`)}</div>`);
  if (task.stages)
    parts.push(`<div class="w-stages">${task.stages.map((stage, index) => `<div><p class="w-figlabel">0${index + 1} · ${esc(stage.label)}</p>${figure(shots, { shot: stage.shot, crop: stage.crop, marks: [], width: "100%", caption: stage.label, number: `階段 ${index + 1}` }, { imageBase: IMG, lazy: true, interactive: true })}</div>`).join("")}</div>`);
  if (task.rules) parts.push(`<section class="w-block"><h3>任務規則</h3><ol class="w-rules">${task.rules.map((rule) => `<li>${webRich(rule)}</li>`).join("")}</ol></section>`);
  if (task.timeline) parts.push(`<section class="w-block"><h3>時間配置</h3><ul class="w-timeline">${task.timeline.map(([time, text]) => `<li><b>${esc(time)}</b>${esc(text)}</li>`).join("")}</ul></section>`);
  if (task.aside) parts.push(`<p class="w-note"><b>${esc(task.aside.letter)}</b> ${webRich(task.aside.text)}</p>`);
  if (task.example) parts.push(`<div class="w-example"><h3>示範 · 系統實際紀錄（不是你的答案）</h3><p>${webRich(task.example)}</p></div>`);
  if (task.risks) parts.push(`<div class="w-risks">${task.risks.map(([name, text]) => `<div><h4>${esc(name)}</h4><p>${webRich(text)}</p></div>`).join("")}</div>`);
  if (task.terms) parts.push(`<div class="w-terms">${task.terms.map(([name, text]) => `<div><h4>${esc(name)}</h4><p>${webRich(text)}</p></div>`).join("")}</div>`);
  if (task.steps)
    parts.push(`<section class="w-block"><h3>逐步操作</h3><ol class="w-steps">${task.steps.map((step) => `<li><b class="w-n">${esc(step.n)}</b><div>${webRich(step.text)}${step.sub ? `<p class="w-sub">${webRich(step.sub)}</p>` : ""}</div></li>`).join("")}</ol></section>`);
  if (task.threshold && reference) {
    const [day5, day6] = reference.days;
    parts.push(`<section class="w-block"><h3>費稅門檻參考表（以昨收估算 1 張） ${pill("參考 · 唯讀", true)}</h3><div class="w-table"><table><thead><tr><th>股票</th><th>一檔</th><th>10/05 每股成本</th><th>至少幾檔</th><th>10/06 每股成本</th><th>至少幾檔</th></tr></thead><tbody>${day6.quotes
      .map((quote) => {
        const other = day5.quotes.find((item) => item.code === quote.code);
        return `<tr><td>${esc(quote.name)} ${esc(quote.code)}</td><td>${quote.tick}</td><td>${other.perShare.toFixed(2)}</td><td>${other.ticksToBreakEven}</td><td>${quote.perShare.toFixed(2)}</td><td><b>${quote.ticksToBreakEven}</b></td></tr>`;
      })
      .join("")}</tbody></table></div></section>`);
  }
  for (const part of form.parts) parts.push(partHtml(part, task));
  if (task.expect) parts.push(`<div class="w-expect"><h3>預期看到</h3><p>${webRich(task.expect)}</p>${task.expectFigure ? fig(shots, task.expectFigure, `圖 ${task.id}-結果`) : ""}</div>`);
  if (task.warn) parts.push(`<div class="w-warn"><h3>注意</h3><p>${webRich(task.warn)}</p></div>`);
  if (task.trouble?.length)
    parts.push(`<section class="w-block"><h3>遇到問題</h3>${task.trouble.map(([problem, fix]) => `<details class="w-trouble"><summary>${webRich(problem)}</summary><p>${webRich(fix)}</p></details>`).join("")}</section>`);
  if (task.rubric)
    parts.push(`<section class="w-block"><h3>評量方式（模擬損益不計分） ${pill("自我檢查 · 選做", true)}</h3><div class="w-rubric">${task.rubric
      .map((part) => `<div><h4>${esc(part.name)} <span>${part.weight}%</span></h4><ul class="w-checks">${part.items.map((item, index) => `<li><label class="w-check"><input type="checkbox" data-check="${esc(task.id)}:rubric:${esc(part.name)}:${index}"><span>${webRich(item)}</span></label></li>`).join("")}</ul></div>`)
      .join("")}</div><p class="w-small">這些勾選只是你自己的檢查，不是成績；期末成績由講師依規準與證據評分。</p></section>`);
  parts.push(checksHtml(task, form));
  if (task.think)
    parts.push(`<section class="w-block"><h3>想一想 ${pill("選做", true)}</h3><p>${webRich(task.think)}</p><textarea class="w-in w-area w-think" data-field="${esc(task.id)}:think" rows="3" aria-label="想一想：我的想法" placeholder="寫下你的想法（只存在這台裝置）"></textarea></section>`);
  parts.push(`<section class="w-done" data-done="${esc(task.id)}" aria-live="polite"></section>`);
  if (task.next) parts.push(`<p class="w-next"><span>NEXT</span>${webRich(task.next)}</p>`);
  return parts.join("\n");
}

const CARD_FROM = {
  L01: [["01-6:quote:0:0", "stock"], ["01-6:quote:0:1"], ["01-6:quote:0:2"], ["01-6:quote:0:3"]],
  L04: [["04-5:ledger:0:2"], ["04-5:ledger:1:2"], ["04-5:ledger:6:2"], ["04-5:ledger:7:2"]],
  L06: [["06-5:fix:2:1"], ["06-5:fix:4:1"], ["06-5:fix:5:1"]],
};

function levelView(level) {
  const achievement = course.achievements[level.achievement];
  const card =
    level.id === "FINAL"
      ? `<p class="w-small">期末成績（操作正確性、紀律、風險理解、復盤品質）由講師依評量規準填寫，不在這裡自評。</p>`
      : `<div class="w-card-fields"><p class="w-card-title">${esc(level.record.title)} ${pill("選填 · 你的能力卡", true)}</p><p class="w-small">${webRich(level.record.note)}</p>${
          CARD_FROM[level.id] ? `<button type="button" class="w-button w-button-quiet" data-card-fill="${esc(level.id)}">從任務帶入（只填空白欄）</button>` : ""
        }<div class="w-field-grid">${level.record.fields
          .map((name, index) => `<div class="w-field"><span class="w-field-label">${esc(name)}</span><input class="w-in" type="text" data-field="${esc(level.id)}:card:${index}" aria-label="${esc(name)}"></div>`)
          .join("")}</div></div>`;
  return `<header class="w-levelhead"><p class="w-eyebrow">${level.id === "FINAL" ? "FINAL MISSION" : `LEVEL ${esc(level.code)}`}</p><h1>${esc(level.title)}</h1><p class="w-en">${esc(level.en)}</p></header>
<blockquote class="w-goal"><span>成就目標</span>${webRich(level.goal)}</blockquote>
<p class="w-lead">${webRich(level.intro)}</p>
<div class="w-spec">${level.system.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${webRich(value)}</dd></div>`).join("")}</div>
<div class="w-unlock" data-level-seal="${esc(level.id)}">${seal({ name: achievement.en, code: achievement.code, state: "locked", size: "84px", id: `web-${level.id}` })}<div><p class="w-eyebrow">完成本關解鎖</p><p><b>${esc(achievement.en)} Achievement</b>　${esc(achievement.zh)}</p><p class="w-progress-text" data-level-progress="${esc(level.id)}"></p></div></div>
<ol class="w-tasklist">${level.tasks.map((task) => `<li><a href="#${esc(task.id)}"><span>${esc(task.id)}</span>${esc(task.title)}${task.star ? " ★" : ""}<em data-task-progress="${esc(task.id)}"></em></a></li>`).join("")}</ol>
<section class="w-block w-ability" data-ability="${esc(level.id)}"><h3>能力卡 · ${esc(achievement.zh)}</h3><p class="w-ability-can">${esc(achievement.promise)}</p><div data-ability-status="${esc(level.id)}"></div>${card}</section>`;
}

function quickView(shots, form) {
  const q = digital.quickstart;
  return `<header class="w-taskhead"><p class="w-meta"><span class="w-id">START</span><span>${esc(q.minutes)}</span><span class="w-chip">不用建立帳號</span><span class="w-task-state" data-task-state="Q"></span></p><h2>${esc(q.title)}</h2></header>
<div class="w-trio"><div><h3>這一關要完成</h3><p>${webRich(q.goal)}</p></div><div><h3>為什麼要學</h3><p>${webRich(q.why)}</p></div><div><h3>操作前準備</h3><ul>${q.prep.map((item) => `<li>${webRich(item)}</li>`).join("")}</ul></div></div>
${figures(q.figures, shots, "Q-")}
<section class="w-block"><h3>逐步操作</h3><ol class="w-steps">${q.steps.map((step) => `<li><b class="w-n">${step.n}</b><div>${webRich(step.text)}${step.sub ? `<p class="w-sub">${webRich(step.sub)}</p>` : ""}</div></li>`).join("")}</ol></section>
${form.parts.map((part) => partHtml(part)).join("")}
<p class="w-note">${webRich(q.guestNote)} 還沒拿到入場碼？入場頁的「先體驗模擬操作」是一段不用帳號、不用入場碼的三分鐘固定範例（不使用真實行情）。</p>
<section class="w-done" data-done="Q" aria-live="polite"></section>
<p class="w-next"><span>NEXT</span>${webRich(q.next)} <a href="#L01">前往 LEVEL 01</a></p>`;
}

export async function renderWeb() {
  // Release and capture date come from the capture record, the same as in the printed books.
  applyCaptureEdition();
  const levels = await loadLevels();
  const shots = loadShots();
  const reference = await buildReference(project);
  const minutes = await buildMinuteTable(project);
  KNOWN = new Set(["Q", ...levels.flatMap((level) => [level.id, ...level.tasks.map((task) => task.id)])]);

  const model = { edition: { version: course.edition.version, release: course.edition.release, captured: course.edition.captured }, order: [], tasks: {}, levels: {}, minutes, stocks: STOCKS };
  const views = [];
  const quick = quickForm();
  model.order.push("Q");
  model.tasks.Q = { level: null, title: digital.quickstart.title, req: quick.req, parts: quick.parts, can: digital.quickstart.can, proof: "本頁：我的第一張成果卡。", next: "L01", nextText: digital.quickstart.next };

  for (const level of levels) {
    const achievement = course.achievements[level.achievement];
    model.levels[level.id] = { title: level.title, code: level.code, achievement: { en: achievement.en, zh: achievement.zh, promise: achievement.promise, code: achievement.code }, tasks: level.tasks.map((task) => task.id), record: level.id === "FINAL" ? null : level.record, cardFrom: CARD_FROM[level.id] ?? null };
    for (const task of level.tasks) {
      const form = taskForm(task);
      model.order.push(task.id);
      model.tasks[task.id] = { level: level.id, title: task.title, req: form.req, parts: form.parts, can: digital.can[task.id], proof: digital.proof[task.id], nextText: task.next ?? "" };
      task.__form = form;
    }
  }
  model.order.forEach((id, index) => (model.tasks[id].next = model.tasks[id].next ?? model.order[index + 1] ?? null));

  views.push({
    id: "start",
    title: "開始之前",
    level: null,
    html: `<header class="w-levelhead"><p class="w-eyebrow">TRADING ACADEMY</p><h1>學員實戰闖關手冊</h1><p class="w-en">當沖大富翁 Day Trade Tycoon · 數位互動版 · ${esc(course.edition.version)}</p></header>
<div data-resume></div>
<a class="w-cta" href="#Q"><b>先做 5 分鐘課前小任務</b><span>不用帳號：進教室、讀出第一個報價，拿到第一張成果卡。</span></a>
<p class="w-lead">從第一個報價，到第一場完整的模擬當沖。每一關的節奏都一樣：看懂目標 → 照圖操作 → 立即驗證 → 完成挑戰 → 解鎖下一關。完成一個任務，頁面下方會出現「你現在會做什麼／你留下的成果／下一個小挑戰」。</p>
<div class="w-storage" role="note"><h3>你的作答存在哪裡？</h3><p>你在這個數位版寫下的答案、勾選與筆記，<b>只存在這台裝置的這個瀏覽器</b>（localStorage），不會上傳，也不會傳給講師或教室系統。畫面右上角會顯示「已保存」或「保存失敗」。換裝置、使用無痕視窗或清除瀏覽器資料前，請到「我的進度與紀錄」<b>匯出備份檔</b>；之後可以在任何瀏覽器匯入還原。</p><p class="w-storage-status" data-storage-status></p></div>
${course.notices.map((notice) => `<div class="w-notice"><h3>${esc(notice.title)}</h3><p>${webRich(notice.body)}</p></div>`).join("")}
<section class="w-block"><h3>學習地圖</h3><ol class="w-map">${course.mapping
      .map((row) => {
        const key = Object.keys(course.achievements).find((name) => course.achievements[name].code === row.level);
        const id = row.level === "FINAL" ? "FINAL" : `L${row.level}`;
        return `<li><a href="#${id}"><b>${row.level === "FINAL" ? "FINAL" : `LEVEL ${esc(row.level)}`}</b><span>${esc(row.title)}</span><small>${esc(row.lesson)} · ${esc(row.round)} · 約 ${row.minutes} 分</small><em>★ ${esc(course.achievements[key].en)}</em></a></li>`;
      })
      .join("")}</ol></section>`,
  });
  views.push({ id: "Q", title: "課前小任務", level: null, task: true, html: quickView(shots, quick) });
  for (const level of levels) {
    views.push({ id: level.id, title: level.id === "FINAL" ? "期末挑戰" : `LEVEL ${level.code}`, level: level.id, html: levelView(level) });
    for (const task of level.tasks) views.push({ id: task.id, title: `${task.id} ${task.title}`, level: level.id, task: true, html: taskView(task, level, shots, reference, task.__form) });
  }
  views.push({
    id: "portfolio",
    title: "我的學習成果冊",
    level: null,
    html: `<header class="w-levelhead"><p class="w-eyebrow">MY PORTFOLIO</p><h1>我的學習成果冊</h1><p class="w-en">把每一關留下的作品整理在一起，可以列印或存成 PDF 交給講師</p></header>
<div class="w-field w-portfolio-name"><span class="w-field-label">學員名稱（選填，只存在這台裝置，列印時會出現）</span><input class="w-in" type="text" data-field="portfolio:name" aria-label="學員名稱"></div>
<div class="w-actions"><button type="button" class="w-button" data-print>列印／存成 PDF</button><a class="w-button w-button-quiet" href="#progress">匯出備份檔</a></div>
<p class="w-small">標示說明：<b>自評</b>＝你自己勾選的確認；<b>作答</b>＝你寫下或選擇的內容；<b>核對</b>＝數位版用算式或教材資料自動比對（只是提示，不是成績）；<b>講師確認</b>＝由講師在列印頁簽名。這本成果冊不是能力認證。</p>
<div data-portfolio></div>`,
  });
  views.push({
    id: "progress",
    title: "我的進度與紀錄",
    level: null,
    html: `<header class="w-levelhead"><p class="w-eyebrow">MY PROGRESS</p><h1>我的進度與紀錄</h1></header>
<div class="w-board" data-board>${Object.entries(course.achievements)
      .map(([key, item]) => `<a class="w-board-item" href="#${esc(key === "final" ? "FINAL" : `L${item.code}`)}" data-board-item="${esc(key === "final" ? "FINAL" : `L${item.code}`)}">${seal({ name: item.en, code: item.code, state: "locked", size: "76px", id: `web-board-${key}` })}<b>${esc(item.en)}</b><span>${esc(item.zh)}</span><em data-board-progress></em></a>`)
      .join("")}</div>
<section class="w-storage w-data"><h3>你的紀錄：保存、備份與還原</h3><p>紀錄只存在這台裝置的這個瀏覽器。<b>匯出備份檔</b>會下載一個 JSON 檔，包含所有作答、勾選與筆記；在新的瀏覽器或清除資料後，可以用<b>匯入備份檔</b>還原。匯入前會先顯示內容並請你確認，目前的紀錄也會先自動留一份備份。</p><p class="w-storage-status" data-storage-status></p>
<div class="w-actions"><button type="button" class="w-button" data-export>匯出備份檔（JSON）</button><label class="w-button w-button-quiet w-file"><input type="file" accept="application/json,.json" data-import>匯入備份檔</label></div>
<div data-import-review></div>
<h4>這台裝置上的自動備份</h4><p class="w-small">匯入或清除前自動建立；不會自動刪除，需要時可以還原或自行刪除。</p><div data-backups></div>
<div class="w-actions"><button type="button" class="w-button w-button-quiet" data-reset>清除這台裝置的紀錄…</button></div></section>`,
  });
  views.push({
    id: "glossary",
    title: "術語表",
    level: null,
    html: `<header class="w-levelhead"><p class="w-eyebrow">GLOSSARY</p><h1>術語表</h1></header><dl class="w-glossary">${course.glossary
      .map(([name, taskId, text]) => {
        if (!KNOWN.has(taskId)) throw new Error(`glossary ${name}: unknown task ${taskId}`);
        return `<div><dt>${esc(name)} <a href="#${esc(taskId)}" data-term-link="${esc(name)}">${esc(taskId)}</a></dt><dd>${webRich(text)}</dd></div>`;
      })
      .join("")}</dl>`,
  });

  const nav = [`<a href="#start" data-nav="start">開始之前</a>`, `<a href="#Q" data-nav="Q" class="w-navquick">課前小任務 <i data-task-progress="Q"></i></a>`];
  for (const level of levels)
    nav.push(`<div class="w-navgroup"><a href="#${esc(level.id)}" data-nav="${esc(level.id)}" class="w-navlevel"><b>${level.id === "FINAL" ? "FINAL" : esc(level.code)}</b>${esc(level.title)}<i data-nav-progress="${esc(level.id)}"></i></a>${level.tasks.map((task) => `<a href="#${esc(task.id)}" data-nav="${esc(task.id)}" class="w-navtask">${esc(task.id)} ${esc(task.title)}</a>`).join("")}</div>`);
  nav.push(`<a href="#portfolio" data-nav="portfolio">我的學習成果冊</a>`, `<a href="#progress" data-nav="progress">我的進度與紀錄</a>`, `<a href="#glossary" data-nav="glossary">術語表</a>`);

  const body = `<a class="w-skip" href="#w-main">跳到內容</a>
<header class="w-bar"><button type="button" class="w-menu" aria-expanded="false" aria-controls="w-nav">目錄</button><a class="w-brand" href="#start">${BRAND_SVG}<span><b>當沖大富翁</b><small>學員實戰闖關手冊</small></span></a><span class="w-save" data-save-status role="status" aria-live="polite"></span><div class="w-total"><span data-total-text>0%</span><i><b data-total-bar style="width:0%"></b></i></div></header>
<div class="w-banner" data-banner hidden role="alert"></div>
<div class="w-layout"><nav id="w-nav" class="w-nav" aria-label="講義目錄"><div class="w-navhead"><b>目錄</b><button type="button" class="w-navclose" data-nav-close>關閉目錄</button></div>${nav.join("")}</nav><div class="w-navshade" data-nav-backdrop hidden></div>
<main id="w-main" class="w-main" tabindex="-1">${views
    .map((view, index) => `<article class="w-view${view.task ? " w-task" : ""}" id="view-${esc(view.id)}" data-view="${esc(view.id)}" data-level="${esc(view.level ?? "")}" data-title="${esc(view.title)}" ${index ? "hidden" : ""}>${view.html}</article>`)
    .join("\n")}
<nav class="w-pager" aria-label="上一頁／下一頁"><a data-prev href="#start">← 上一頁</a><a data-next href="#start">下一頁 →</a></nav>
<footer class="w-foot">模擬交易教學 · 非投資建議 · 講義版本 ${esc(course.edition.version)} · 截圖取自系統 release ${esc(course.edition.release)}（${esc(course.edition.captured)}）</footer></main></div>
<div class="w-lightbox" hidden role="dialog" aria-modal="true" aria-labelledby="w-lb-title">
<div class="w-lb-top"><p id="w-lb-title" class="w-lb-title"></p><button type="button" class="w-lb-btn w-lb-close" data-lb="close">關閉</button></div>
<div class="w-lb-tools" role="toolbar" aria-label="縮放工具"><div class="w-lb-main"><button type="button" class="w-lb-btn" data-lb="fit">適合螢幕</button><button type="button" class="w-lb-btn" data-lb="actual">原尺寸 100%</button><button type="button" class="w-lb-btn" data-lb="out" aria-label="縮小">−</button><output class="w-lb-zoom" data-lb-zoom>100%</output><button type="button" class="w-lb-btn" data-lb="in" aria-label="放大">＋</button><button type="button" class="w-lb-btn" data-lb="reset">還原</button></div><div class="w-lb-marks" data-lb-marks></div></div>
<div class="w-lb-viewport" data-lb-viewport tabindex="0" role="img" aria-roledescription="可縮放的截圖" aria-label="截圖：可拖曳或用方向鍵移動，雙擊或按 1 切換原尺寸，按 0 適合螢幕"><div class="w-lb-stage" data-lb-stage></div></div>
<p class="w-lb-caption" data-lb-caption></p></div>
<div class="w-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="w-dialog-title" data-dialog><div class="w-dialog-card"><h2 id="w-dialog-title" data-dialog-title></h2><div data-dialog-body></div><div class="w-actions" data-dialog-actions></div></div></div>
<script>window.ACADEMY=${JSON.stringify(model).replace(/</g, "\\u003c")};window.ACADEMY_VIEWS=${JSON.stringify(views.map((view) => ({ id: view.id, level: view.level, task: Boolean(view.task), title: view.title })))};</script>
<script src="assets/web.js"></script>`;

  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>學員實戰闖關手冊</title>
<meta name="description" content="當沖大富翁 Trading Academy 學員實戰闖關手冊數位互動版：課前小任務、六個關卡與期末任務，真實系統截圖、逐步操作、數位作答與學習成果冊。">
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
  // Text the browser script renders (status lines, dialogs) must be in the font subset too.
  const scriptText = (await import("node:fs")).readFileSync(join(academy, "design", "web.js"), "utf8");
  return { html, text: corpus(html) + scriptText, images: used.size };
}
