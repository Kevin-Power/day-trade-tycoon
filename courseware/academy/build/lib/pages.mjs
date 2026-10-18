// Page templates shared by the student and instructor books.
import { esc, rich, seal, BRAND_SVG } from "./markup.mjs";
import { figure } from "./figure.mjs";
import { LEVEL_ORDER } from "./book.mjs";

export function levelHead(level) {
  return level.id === "FINAL"
    ? `<span class="mono">FINAL MISSION</span>${esc(level.title)}`
    : `<span class="mono">LEVEL ${esc(level.code)}</span>${esc(level.title)}`;
}

export function label(en, zh) {
  return `<span class="label">${esc(en)}<b>${esc(zh)}</b></span>`;
}

/** Figures: single figures, or rows of figures that share the width. */
export function renderFigures(list = [], shots, ctx, prefix, { letters = false, start = 0 } = {}) {
  let count = start;
  const numberOf = () => {
    count += 1;
    return `圖 ${prefix}${letters || list.length > 1 || list.some((item) => item.row) ? String.fromCharCode(96 + count) : ""}`;
  };
  return list
    .map((item) => {
      if (item.row) {
        const cells = item.row
          .map((cell) => {
            const width = cell.width ? `flex:0 0 ${cell.width}` : "flex:1 1 0";
            if (cell.text) return `<div class="fig-cell fig-text" style="${width};min-width:0"><p class="small">${ctx.rich(cell.text)}</p></div>`;
            const head = cell.label ? `<div class="fig-pair-label">${esc(cell.label)}</div>` : "";
            const fig = figure(shots, {
              ...cell,
              width: "100%",
              number: cell.caption ? numberOf() : undefined,
              caption: cell.caption ? ctx.fill(cell.caption) : undefined,
            }, { imageBase: ctx.imageBase });
            return `<div class="fig-cell" style="${width};min-width:0">${head}${fig}</div>`;
          })
          .join("");
        const caption = item.caption ? `<p class="tiny mt-1">${ctx.rich(item.caption)}</p>` : "";
        return `<div class="fig-row">${cells}</div>${caption}`;
      }
      return figure(shots, { ...item, number: item.caption ? numberOf() : undefined, caption: item.caption ? ctx.fill(item.caption) : undefined }, { imageBase: ctx.imageBase });
    })
    .join("");
}

export function journey(current) {
  const names = ["工作台", "看懂行情", "第一筆委託", "完成買賣", "決策與風險", "復盤", "期末挑戰"];
  const index = LEVEL_ORDER.indexOf(current);
  return `<div class="journey">${LEVEL_ORDER.map(
    (level, i) =>
      `<div class="${i < index ? "done" : i === index ? "now" : ""}"><b>${level === "FINAL" ? "FINAL" : `LEVEL ${level.slice(1)}`}</b><span>${names[i]}</span></div>`,
  ).join("")}</div>`;
}

export function trio(task, ctx) {
  const prep = (task.prep ?? []).map((item) => `<li>${ctx.rich(item)}</li>`).join("");
  return `<div class="trio">
  <div>${label("Goal", "這一關要完成")}<p>${ctx.rich(task.goal)}</p></div>
  <div>${label("Why", "為什麼要學")}<p>${ctx.rich(task.why)}</p></div>
  <div>${label("Before", "操作前準備")}<ul>${prep}</ul></div>
</div>`;
}

export function taskHead(task, level, ctx, achievements) {
  const star = task.star ? `<span class="star">★ ${esc(achievements[task.star].en.toUpperCase())}</span>` : "";
  const system = level.systemShort ? `<span class="chip">${esc(level.systemShort)}</span>` : "";
  return `<div class="task-head">
  <div class="task-meta"><span class="task-id">TASK ${esc(task.id.replace("-", "·"))}</span><span class="time">約 ${esc(task.minutes)} 分鐘</span>${system}${star}</div>
  <h2 class="h-page">${ctx.rich(task.title)}</h2>
</div>`;
}

export function steps(task, ctx, { compact = false } = {}) {
  const items = task.steps
    .map(
      (step) =>
        `<li><span class="n${step.on ? " on" : ""}">${esc(step.n)}</span><span class="t">${ctx.rich(step.text)}${step.sub ? `<span class="sub">${ctx.rich(step.sub)}</span>` : ""}</span></li>`,
    )
    .join("");
  // The hint names no position: the figure sits above, beside or on the facing page depending on layout.
  const hasFigure = Boolean(task.figures?.length || task.map || task.sideFigure);
  const hint = hasFigure ? `<span class="tiny">圓圈數字對照圖上的藍色標號</span>` : "";
  return `<div class="block-title">${label("Steps", "逐步操作")}${hint}</div><ol class="steps">${items}</ol>`;
}

export function aside(task, ctx) {
  if (!task.aside) return "";
  return `<div class="box note mt-2"><p class="small"><b class="mono" style="color:var(--blue-deep);margin-right:1.6mm">${esc(task.aside.letter)}</b>${ctx.rich(task.aside.text)}</p></div>`;
}

export function terms(task, ctx) {
  if (!task.terms?.length) return "";
  const cards = task.terms
    .map(([name, text]) => `<div class="term-card"><h4>${esc(name)}<small>名詞小卡</small></h4><p>${ctx.rich(text)}</p></div>`)
    .join("");
  return `<div class="terms${task.terms.length === 2 ? " two" : ""}">${cards}</div>`;
}

export function record(spec, ctx) {
  if (!spec) return "";
  if (spec.list) return listRecord(spec, ctx);
  const head = spec.columns.map((column) => `<th>${esc(column)}</th>`).join("");
  const example = spec.example
    ? `<tr class="example">${spec.example.map((cell) => `<td class="example">${esc(cell)}</td>`).join("")}</tr>`
    : "";
  // `rows` is a count of blank rows, or a list of row labels whose other cells are left to fill in.
  const rows = Array.isArray(spec.rows)
    ? spec.rows.map((name) => `<tr><td class="row-label">${esc(name)}</td>${spec.columns.slice(1).map(() => "<td></td>").join("")}</tr>`).join("")
    : Array.from({ length: spec.rows ?? 2 }, () => `<tr>${spec.columns.map(() => "<td></td>").join("")}</tr>`).join("");
  return `<div class="mt-2">${label("Record", spec.title)}${spec.note ? `<span class="tiny" style="margin-left:2mm">${ctx.rich(spec.note)}</span>` : ""}<table class="record mt-1"><thead><tr>${head}</tr></thead><tbody>${example}${rows}</tbody></table>${spec.example ? `<p class="tiny mt-1">${esc(spec.exampleNote ?? "藍底列是範例。")}</p>` : ""}</div>`;
}

export function ledgerTable(task, ctx) {
  if (!task.ledger) return "";
  const rows = task.ledger.rows.map(([name, source]) => `<tr><td style="width:30mm;color:var(--ink);font-weight:500">${esc(name)}</td><td style="color:var(--ink-3)">${ctx.rich(source)}</td><td class="num" style="width:42mm"></td></tr>`).join("");
  return `<div class="mt-2">${label("Reconcile", "對帳表")}<table class="record mt-1"><thead><tr><th>項目</th><th>資料來源／算法</th><th class="num">金額（元）</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function expect(task, shots, ctx) {
  const fig = task.expectFigure ? renderFigures([{ ...task.expectFigure, width: task.expectFigure.width ?? "100%" }], shots, ctx, `${task.id}-結果`) : "";
  return `<div class="box expect mt-2">${label("Expected", "預期看到")}<p>${ctx.rich(task.expect)}</p>${fig ? `<div class="mt-1">${fig}</div>` : ""}</div>`;
}

export function warnBox(task, ctx) {
  if (!task.warn) return "";
  return `<div class="box warn mt-2">${label("Careful", "注意")}<p class="small">${ctx.rich(task.warn)}</p></div>`;
}

export function trouble(task, ctx) {
  if (!task.trouble?.length) return "";
  const rows = task.trouble.map(([problem, fix]) => `<tr><th>${ctx.rich(problem)}</th><td>${ctx.rich(fix)}</td></tr>`).join("");
  return `<div class="mt-2">${label("If something's off", "遇到問題")}<table class="trouble mt-1"><tbody>${rows}</tbody></table></div>`;
}

export function checksAndThink(task, ctx, { lines = 3 } = {}) {
  const checks = task.checks.map((item) => `<li><span class="checkbox"></span><span>${ctx.rich(item)}</span></li>`).join("");
  return `<div class="bottom-grid">
  <div>${label("Check", "自我檢查")}<ul class="checks mt-1">${checks}</ul></div>
  <div>${label("Think", "想一想")}<p class="small mt-1">${ctx.rich(task.think)}</p><div class="lines">${"<i></i>".repeat(lines)}</div></div>
</div>`;
}

export function nextBand(text, ctx) {
  return `<div class="next-band"><span class="eyebrow">Next</span><span>${ctx.rich(text)}</span><span class="arrow">→</span></div>`;
}

export function sealFor(achievements, key, state, size, id) {
  const item = achievements[key];
  return seal({ name: item.en, code: item.code, state, size, id: `${key}-${id}` });
}

export { esc, rich, BRAND_SVG, figure };

export function exampleBox(task, ctx) {
  if (!task.example) return "";
  return `<div class="box example mt-2">${label("Example", "示範 · 系統實際紀錄")}<p class="small">${ctx.rich(task.example)}</p></div>`;
}

export function worksheet(task, ctx) {
  const sheet = task.worksheet;
  if (!sheet) return "";
  if (sheet.head) {
    const head = sheet.head.map((cell) => `<th>${esc(cell)}</th>`).join("");
    const rows = sheet.rows
      .map((row) => `<tr>${row.map((cell, index) => `<td${index === 0 && cell ? ' style="color:var(--ink);font-weight:500"' : ""}>${ctx.rich(cell)}</td>`).join("")}</tr>`)
      .join("");
    return `<div class="mt-2">${label("Worksheet", sheet.title)}<table class="record sheet mt-1"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  const rows = sheet.rows.map(([name]) => `<tr><td style="width:62mm;color:var(--ink);font-weight:500">${ctx.rich(name)}</td><td></td></tr>`).join("");
  return `<div class="mt-2">${label("Worksheet", sheet.title)}<table class="record sheet mt-1"><tbody>${rows}</tbody></table></div>`;
}

export function riskCards(task, ctx) {
  if (!task.risks) return "";
  return `<div class="risk-grid mt-3">${task.risks
    .map(([name, text], index) => `<div class="risk"><span class="mono">0${index + 1}</span><b>${esc(name)}</b><p>${ctx.rich(text)}</p></div>`)
    .join("")}</div>`;
}

export function thresholdTable(reference, ctx) {
  if (!reference) return "";
  const [day5, day6] = reference.days;
  const rows = day6.quotes
    .map((quote) => {
      const other = day5.quotes.find((item) => item.code === quote.code);
      return `<tr><td style="color:var(--ink);font-weight:500">${esc(quote.name)} ${esc(quote.code)}</td><td class="num">${quote.tick}</td><td class="num">${other.perShare.toFixed(2)}</td><td class="num">${other.ticksToBreakEven}</td><td class="num">${quote.perShare.toFixed(2)}</td><td class="num"><b>${quote.ticksToBreakEven}</b></td></tr>`;
    })
    .join("");
  return `<div class="mt-2">${label("Reference", "費稅門檻參考表（以昨收估算 1 張）")}<table class="record ref mt-1"><thead><tr><th>股票</th><th class="num">一檔（元）</th><th class="num">10/05 每股成本</th><th class="num">至少幾檔</th><th class="num">10/06 每股成本</th><th class="num">至少幾檔</th></tr></thead><tbody>${rows}</tbody></table><p class="tiny mt-1">每股成本 = 預估來回費稅（手續費 0.0855% × 2，每筆最低 20 元＋交易稅 0.15%）÷ 1,000 股。由教室程式的費用函式計算。</p></div>`;
}

export function adherence(task, ctx) {
  if (!task.adherence) return "";
  return `<div class="mt-2">${label("Check the plan", "遵守計畫檢查")}<ol class="adherence mt-1">${task.adherence
    .map((item, index) => `<li><span class="mono">${index + 1}</span><span>${ctx.rich(item)}</span><span class="yn"><i class="checkbox"></i>是<i class="checkbox"></i>否</span></li>`)
    .join("")}</ol></div>`;
}

export function listRecord(spec, ctx) {
  if (!spec?.list) return "";
  return `<div class="mt-2">${label("Record", spec.title)}<ul class="checks mt-1">${spec.list
    .map((item) => `<li><span class="checkbox"></span><span>${ctx.rich(item)}</span></li>`)
    .join("")}<li><span class="checkbox"></span><span>其他：<span class="write" style="min-width:60mm"></span></span></li></ul></div>`;
}
