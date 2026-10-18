// Student workbook: level openers, task pages (all layouts), final-mission sheets, level completion
// pages and the back matter. Every layout keeps the ten parts of a task in the same order.
import {
  esc,
  label,
  levelHead,
  renderFigures,
  journey,
  trio,
  taskHead,
  steps,
  aside,
  terms,
  record,
  ledgerTable,
  expect,
  warnBox,
  trouble,
  checksAndThink,
  nextBand,
  sealFor,
  figure,
  exampleBox,
  worksheet,
  riskCards,
  thresholdTable,
  adherence,
} from "./pages.mjs";

export function addLevel(book, level, data) {
  const { achievements } = data;
  const head = levelHead(level);
  const achievement = achievements[level.achievement];

  book.add({
    id: `${level.id}-open`,
    level: level.id,
    head,
    render: (ctx) => `<div class="opener">
  <div class="numeral"><small>${level.id === "FINAL" ? "FINAL MISSION" : "LEVEL"}</small>${level.id === "FINAL" ? "★" : esc(level.code)}</div>
  <h1>${esc(level.title)}</h1>
  <div class="en">${esc(level.en)}</div>
  <div class="goal-quote">${label("Achievement goal", "成就目標")}<p>${ctx.rich(level.goal)}</p></div>
  <p class="lead mt-3">${ctx.rich(level.intro)}</p>
  <div class="opener-grid">
    <div>${label(level.id === "FINAL" ? "Mission" : "Tasks", level.id === "FINAL" ? "任務內容" : "本關任務")}<ul class="task-list mt-1">${level.tasks
      .map(
        (task) =>
          `<li><span class="mono">${esc(task.id)}</span><span>${esc(task.title)}${task.star ? `<span class="star">★</span>` : ""}</span><span class="pg">p.${ctx.pageOf(`${task.id}-a`)}</span></li>`,
      )
      .join("")}</ul><p class="tiny mt-1">預估時間：約 ${esc(level.minutes)} 分鐘</p></div>
    <div>${label("System", "在教室系統裡")}<div class="spec mt-1"><dl>${level.system
      .map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${ctx.rich(value)}</dd></div>`)
      .join("")}</dl></div>
      <div class="unlock mt-2">${sealFor(achievements, level.achievement, "locked", "21mm", `${level.id}-open`)}<p class="small">${level.id === "FINAL" ? "完成期末任務，獲得" : "完成本關，解鎖"}<br><b class="mono" style="font-size:7.6pt;letter-spacing:.08em">${esc(achievement.en.toUpperCase())}</b><br>${esc(achievement.zh)}</p></div>
    </div>
  </div>
  ${journey(level.id)}
</div>`,
  });

  for (const task of level.tasks) addTask(book, level, task, data);

  if (level.id === "FINAL") return addCertificate(book, level, data);
  book.add({
    id: `${level.id}-done`,
    level: level.id,
    head,
    render: (ctx) => `<p class="eyebrow">Level ${esc(level.code)} complete</p>
<div class="complete-hero">
  <div class="seal-wrap">${sealFor(achievements, level.achievement, "unlocked", "40mm", `${level.id}-done`)}
    <div>${label("Achievement unlocked", "成就解鎖")}<h2>${esc(achievement.en)} Achievement<br><span style="font-size:14pt;color:var(--ink-2)">${esc(achievement.zh)}</span></h2><p class="small mt-1">${esc(achievement.promise)}</p></div>
  </div>
  <p class="cheer">${ctx.rich(level.cheer)}</p>
</div>
<div class="cols-2 mt-4">
  <div>${label("Checklist", "本關完成清單")}<ul class="checks mt-1">${level.tasks
      .map((task) => `<li><span class="checkbox"></span><span><span class="mono" style="color:var(--blue);font-size:7.6pt;margin-right:1.6mm">${esc(task.id)}</span>${esc(task.title)}</span></li>`)
      .join("")}</ul></div>
  <div>${label("Record", level.record.title)}<p class="tiny mt-1">${ctx.rich(level.record.note)}</p>
    <table class="record mt-1"><tbody>${level.record.fields.map((field) => `<tr><td style="width:30mm;color:var(--ink-2)">${esc(field)}</td><td></td></tr>`).join("")}</tbody></table>
  </div>
</div>
<div class="signoff"><div>完成日期</div><div>學員簽名</div><div>講師確認</div></div>
${journey(nextLevel(level.id))}`,
  });
}

function nextLevel(id) {
  const order = ["L01", "L02", "L03", "L04", "L05", "L06", "FINAL"];
  return order[Math.min(order.length - 1, order.indexOf(id) + 1)];
}

function addTask(book, level, task, data) {
  const { shots, achievements } = data;
  const head = levelHead(level);
  const page = (suffix, render) => book.add({ id: `${task.id}-${suffix}`, level: level.id, head, render });

  switch (task.layout) {
    case "single":
      if (task.figureTop) {
        // Wide, short screens (ledger tables) print full width on top; steps and records share the row below.
        page("a", (ctx) => `${taskHead(task, level, ctx, achievements)}
${trio(task, ctx)}
<div class="mt-3">${renderFigures(task.figures, shots, ctx, task.id)}</div>
${aside(task, ctx)}
<div class="single-grid even mt-3">
  <div class="single-steps">${steps(task, ctx, { compact: true })}</div>
  <div>${record(task.record, ctx)}${worksheet(task, ctx)}${adherence(task, ctx)}</div>
</div>
${expect(task, shots, ctx)}
${warnBox(task, ctx)}
${trouble(task, ctx)}
${checksAndThink(task, ctx, { lines: task.thinkLines ?? 2 })}
${nextBand(task.next, ctx)}`);
        return;
      }
      page("a", (ctx) => `${taskHead(task, level, ctx, achievements)}
${trio(task, ctx)}
<div class="single-grid mt-3${task.figures?.length ? "" : " no-fig"}">
  <div class="single-fig">${renderFigures(task.figures, shots, ctx, task.id)}${aside(task, ctx)}${task.recordUnderFigure ? record(task.record, ctx) : ""}</div>
  <div class="single-steps">${steps(task, ctx, { compact: true })}${task.recordUnderFigure ? "" : record(task.record, ctx)}${worksheet(task, ctx)}${adherence(task, ctx)}</div>
</div>
${expect(task, shots, ctx)}
${warnBox(task, ctx)}
${trouble(task, ctx)}
${checksAndThink(task, ctx, { lines: task.thinkLines ?? 2 })}
${nextBand(task.next, ctx)}`);
      return;
    case "map":
      page("a", (ctx) => `${taskHead(task, level, ctx, achievements)}
${trio(task, ctx)}
${figure(
  shots,
  {
    shot: task.map.shot,
    caption: ctx.fill(task.map.caption),
    number: `圖 ${task.id}a`,
    ringPad: 0,
    gutter: task.map.gutter,
    marks: [
      ...task.map.zones.map((zone) => ({ n: zone.n, target: zone.target, pos: zone.pos, ring: false })),
      ...task.map.extras.map(([letter, target, , pos = "tl"]) => ({ n: letter, target, pos, letter: true, ring: false })),
    ],
    rings: task.map.zones.map((zone) => ({ target: zone.target, soft: true })),
  },
  { imageBase: ctx.imageBase },
)}
<ol class="legend zones mt-2">${task.map.zones
        .map((zone) => `<li><span class="dot">${zone.n}</span><span><b>${esc(zone.name)}</b>　${ctx.rich(zone.text)}</span></li>`)
        .join("")}${task.map.extras
        .map(([letter, , text]) => `<li><span class="dot letter">${letter}</span><span>${ctx.rich(text)}</span></li>`)
        .join("")}</ol>`);
      page("b", (ctx) => `${renderFigures(task.figures, shots, ctx, task.id)}
<div class="mt-3">${steps(task, ctx, { compact: true })}</div>
${expect(task, shots, ctx)}
${warnBox(task, ctx)}
${trouble(task, ctx)}
${checksAndThink(task, ctx, { lines: 1 })}
${nextBand(task.next, ctx)}`);
      return;
    case "final-brief":
      return finalBrief(task, level, data, page);
    case "rubric":
      return rubricPage(task, page);
    case "sheet-plan":
      return planSheet(task, data, page);
    case "sheet-log":
      return logSheet(task, page);
    case "sheet-report":
      return reportSheet(task, page);
    default:
      page("a", (ctx) => `${taskHead(task, level, ctx, achievements)}
${trio(task, ctx)}
${renderFigures(task.figures, shots, ctx, task.id, { letters: Boolean(task.sideFigure) })}
${aside(task, ctx)}
${exampleBox(task, ctx)}
${riskCards(task, ctx)}
${task.sideFigure ? `<div class="side-block">${renderFigures([task.sideFigure], shots, ctx, task.id, { letters: true, start: (task.figures ?? []).length })}<div class="side-terms">${terms({ terms: task.terms }, ctx)}</div></div>` : terms(task, ctx)}
${task.sheetPage === "a" ? worksheet(task, ctx) : ""}`);
      page("b", (ctx) => `<p class="eyebrow muted">TASK ${esc(task.id.replace("-", "·"))} · ${esc(task.title)}</p>
<div class="mt-2">${steps(task, ctx)}</div>
${record(task.record, ctx)}
${ledgerTable(task, ctx)}
${task.sheetPage === "a" ? "" : worksheet(task, ctx)}
${task.threshold ? thresholdTable(data.reference, ctx) : ""}
${adherence(task, ctx)}
${expect(task, shots, ctx)}
${warnBox(task, ctx)}
${trouble(task, ctx)}
${checksAndThink(task, ctx)}
${nextBand(task.next, ctx)}`);
  }
}

/* ───────────────────────── final mission ───────────────────────── */
function finalBrief(task, level, data, page) {
  const { shots, achievements } = data;
  page("a", (ctx) => `${taskHead(task, level, ctx, achievements)}
${trio(task, ctx)}
<div class="cols-2 mt-3" style="grid-template-columns:1.35fr 1fr">
  <div>${label("Rules", "任務規則")}<ol class="rules mt-1">${task.rules.map((rule, index) => `<li><span class="mono">${index + 1}</span><span>${ctx.rich(rule)}</span></li>`).join("")}</ol></div>
  <div>${label("Timeline", "時間配置（約 60 分鐘）")}<ol class="timeline mt-1">${task.timeline.map(([time, text]) => `<li><b class="mono">${esc(time)}</b><span>${esc(text)}</span></li>`).join("")}</ol>
  <div class="box note mt-2"><p class="small">期末任務不提供逐步截圖與標準答案。每一個步驟你都在前六關做過——忘了就翻回去看。</p></div></div>
</div>
<div class="mt-3">${label("Stages", "六個階段 · 你熟悉的畫面")}<div class="stage-strip mt-1">${task.stages
    .map(
      (stage, index) =>
        `<div class="stage"><span class="mono">0${index + 1}</span><b>${esc(stage.label)}</b>${figure(shots, { shot: stage.shot, crop: stage.crop, marks: [] }, { imageBase: ctx.imageBase })}</div>`,
    )
    .join("")}</div></div>`);
  page("b", (ctx) => `<p class="eyebrow muted">FINAL MISSION · ${esc(task.title)}</p>
<div class="mt-2">${steps(task, ctx, { compact: true })}</div>
${expect(task, data.shots, ctx)}
${trouble(task, ctx)}
<div class="mt-2">${label("Evidence", "要交給講師的證據")}<ul class="checks two-col mt-1">${task.evidence.map((item) => `<li><span class="checkbox"></span><span>${ctx.rich(item)}</span></li>`).join("")}</ul></div>
<div class="box warn mt-2"><span class="label">Fair play<b>公平與誠實</b></span><p class="small">教材只有兩個交易日，你可能記得後面的走勢。期末評的是『你怎麼用規則做決定』：只依當下已揭露的資料判斷，並在報告中誠實寫下你知道與不知道的事。</p></div>
<div class="bottom-grid"><div>${label("Think", "想一想")}<p class="small mt-1">${ctx.rich(task.think)}</p><div class="lines"><i></i><i></i></div></div><div>${label("After the course", "課後")}<p class="small mt-1">期末之後，你仍然可以用兩個交易日、六個主題反覆練習。每次練習都只帶一個『下一次只改一件事』。</p></div></div>
${nextBand(task.next, ctx)}`);
}

function rubricPage(task, page) {
  page("a", (ctx) => `<p class="eyebrow">Final mission · Assessment</p>
<h1 class="h-page mt-1">評量方式</h1>
<p class="lead mt-2">講師依四個面向評分，總分 100。每一項都要能在系統紀錄或講義上找到證據。<b>模擬損益不計分：賺錢不加分、虧錢不扣分。</b></p>
<div class="rubric mt-3">${task.rubric
    .map(
      (part) => `<section><header><b>${esc(part.name)}</b><span class="mono">${part.weight}%</span></header><ul>${part.items
        .map((item) => `<li><span class="checkbox"></span><span>${ctx.rich(item)}</span></li>`)
        .join("")}</ul><p class="tiny">自評：<span class="write" style="min-width:18mm"></span> / ${part.weight}</p></section>`,
    )
    .join("")}</div>
<div class="cols-3 mt-3 levels-key">
  <div><b>優秀</b><p class="small">每一項都有完整證據，並能清楚說明原因。</p></div>
  <div><b>達成</b><p class="small">大部分項目做到，少數地方缺少紀錄或說明。</p></div>
  <div><b>待加強</b><p class="small">缺少關鍵紀錄，或沒有依計畫執行且未說明。</p></div>
</div>
<div class="box note mt-auto"><p class="small">左邊的勾選框是你的自我檢查：交卷前逐項確認。講師版手冊有完整的評分規準，用來對照你的證據。</p></div>`);
}

function planSheet(task, data, page) {
  const field = (name, lines = 2, hint = "") =>
    `<div class="field"><span class="field-label">${esc(name)}${hint ? `<small>${esc(hint)}</small>` : ""}</span><div class="lines">${"<i></i>".repeat(lines)}</div></div>`;
  page("a", (ctx) => `<p class="eyebrow">Final mission · Sheet 1</p>
<h1 class="h-page mt-1">期末計畫單</h1>
<p class="small mt-1">開始回放前填完。系統計畫的三格要和這一頁一致。</p>
<div class="cols-3 mt-3 short-fields">
  <div class="field"><span class="field-label">交易日</span><div class="lines"><i></i></div></div>
  <div class="field"><span class="field-label">練習主題</span><div class="lines"><i></i></div></div>
  <div class="field"><span class="field-label">股票（代號）</span><div class="lines"><i></i></div></div>
</div>
${field("我觀察的理由", 2, "背景或價格條件，不寫成買賣答案")}
${field("進場條件", 2, "什麼條件出現，我才考慮操作（要能在畫面上核對）")}
${field("失效／出場條件", 2, "價格條件＋時間條件")}
<div class="cols-2 mt-2" style="grid-template-columns:1.2fr 1fr">
  ${worksheet(
    {
      worksheet: {
        title: "風險預算表",
        rows: [["① 預計進場價"], ["② 停損（失效）價"], ["③ 每股風險 = ① − ②"], ["④ 每張價差風險 = ③ × 1,000"], ["⑤ 每張來回費稅（下單票）"], ["⑥ 每張總風險 = ④ + ⑤"], ["⑦ 可承受模擬損失"], ["⑧ 最多張數 = ⑦ ÷ ⑥（捨去，≤3）"]],
      },
    },
    ctx,
  )}
  <div>${label("Threshold", "費稅門檻")}
    <table class="record mt-1"><tbody>
      <tr><td style="color:var(--ink-2)">每股成本 = 來回費稅 ÷ 1,000</td><td></td></tr>
      <tr><td style="color:var(--ink-2)">一檔是多少元</td><td></td></tr>
      <tr><td style="color:var(--ink-2)">至少要漲幾檔才打平</td><td></td></tr>
      <tr><td style="color:var(--ink-2)">我的結束時間</td><td></td></tr>
    </tbody></table>
    <p class="tiny mt-1">參考值見任務 05-1 的費稅門檻表。</p>
  </div>
</div>
<div class="checks-inline mt-auto"><span class="checkbox"></span><span class="small">計畫單已完成，系統計畫的三格與本頁一致。　講師確認：<span class="write"></span></span></div>`);
}

function logSheet(task, page) {
  const rows = Array.from({ length: 13 }, () => "<tr><td></td><td></td><td></td><td></td></tr>").join("");
  page("a", (ctx) => `<p class="eyebrow">Final mission · Sheet 2</p>
<h1 class="h-page mt-1">決策日誌</h1>
<p class="small mt-1">每做一個決定（送單、等待、出場、不交易）就寫一列。只寫『當時看得到的』，不寫後來才知道的。</p>
<table class="record log mt-3"><thead><tr><th style="width:17mm">時間</th><th>當時看得到的條件</th><th style="width:34mm">我的決定</th><th>理由</th></tr></thead><tbody>${rows}</tbody></table>
<p class="tiny mt-auto">提示：做決定前先按暫停；寫完再前進。回放不會因為你停下來而錯過行情。</p>`);
}

function reportSheet(task, page) {
  const fills = Array.from({ length: 4 }, () => "<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>").join("");
  page("a", (ctx) => `<p class="eyebrow">Final mission · Sheet 3</p>
<h1 class="h-page mt-1">期末報告</h1>
<div class="mt-2">${label("Fills", "成交與對帳")}<table class="record mt-1"><thead><tr><th>時間</th><th>買／賣</th><th class="num">張數</th><th class="num">成交價</th><th class="num">手續費</th><th class="num">交易稅</th></tr></thead><tbody>${fills}</tbody></table></div>
<div class="cols-3 mt-2 short-fields">
  <div class="field"><span class="field-label">價差合計</span><div class="lines"><i></i></div></div>
  <div class="field"><span class="field-label">費稅合計</span><div class="lines"><i></i></div></div>
  <div class="field"><span class="field-label">淨損益（＝本輪損益？）</span><div class="lines"><i></i></div></div>
</div>
${adherence(
  {
    adherence: [
      "進場前，條件真的已經成立了嗎？",
      "張數沒有超過風險預算的最多張數嗎？",
      "出場是依照事先寫好的條件嗎？",
      "結束前處理完部位了嗎？（沒有的話寫原因）",
      "有沒有計畫以外的委託？",
    ],
  },
  ctx,
)}
<div class="cols-2 mt-2">
  <div class="field"><span class="field-label">一次具體的失誤<small>時間、看到什麼、做了什麼、應該做什麼</small></span><div class="lines"><i></i><i></i><i></i></div></div>
  <div class="field"><span class="field-label">下一次只改一件事<small>要能從紀錄核對</small></span><div class="lines"><i></i><i></i><i></i></div></div>
</div>
<div class="field mt-2"><span class="field-label">這場挑戰，我最滿意的一個決定</span><div class="lines"><i></i><i></i></div></div>
<div class="checks-inline mt-auto"><span class="checkbox"></span><span class="small">系統復盤已保存，完成卡畫面已給講師看過。</span></div>`);
}

function addCertificate(book, level, data) {
  const { achievements } = data;
  const achievement = achievements[level.achievement];
  book.add({
    id: `${level.id}-done`,
    level: level.id,
    head: levelHead(level),
    render: (ctx) => `<div class="certificate">
  <p class="eyebrow">Certificate of completion</p>
  <div class="cert-seal">${sealFor(achievements, level.achievement, "unlocked", "46mm", "final-cert")}</div>
  <p class="cert-kicker mono">FINAL MISSION COMPLETE</p>
  <h1>當沖大富翁 Trading Academy<br>期末挑戰完成證書</h1>
  <p class="cert-name">學員 <span class="write" style="min-width:70mm"></span></p>
  <p class="cert-text">已完成 LEVEL 01–06 六個關卡與期末任務，<br>能獨立完成一場有計畫、有紀律、有復盤的模擬當沖。</p>
  <p class="cheer">${ctx.rich(level.cheer)}</p>
  <div class="cert-scores">${level.record.fields.map((field) => `<div><span>${esc(field)}</span><i></i></div>`).join("")}</div>
  <div class="signoff"><div>完成日期</div><div>講師簽名</div><div>班級</div></div>
  <p class="tiny mt-2">本證書記錄學習歷程，不是能力認證、投資資格或獲利證明。模擬結果不代表實際交易報酬。</p>
</div>`,
  });
}

/* ───────────────────────── back matter ───────────────────────── */
export function addBack(book, data) {
  const { achievements, glossary, levels } = data;
  const head = (text) => `<span class="mono">ACADEMY</span>${esc(text)}`;
  const taskPage = (taskId) => {
    try {
      return data.pageOf?.(taskId);
    } catch {
      return null;
    }
  };

  book.add({
    id: "board",
    head: head("總完成清單"),
    render: (ctx) => `<p class="eyebrow">Achievement board</p>
<h1 class="h-page mt-1">總完成清單</h1>
<p class="lead mt-2">每完成一關，在這一頁蓋上你的成就章：寫下完成日期，請講師簽名。七個成就章都完成，就是一份完整的學習歷程。</p>
<div class="board mt-4">${Object.entries(achievements)
      .map(
        ([key, item]) => `<div class="board-item">${sealFor(achievements, key, "locked", "27mm", `board-${key}`)}<b>${esc(item.en)}</b><span>${esc(item.zh)}</span><p>${esc(item.promise)}</p><div class="board-sign"><span>日期</span><i></i><span>講師</span><i></i></div></div>`,
      )
      .join("")}</div>
<p class="tiny mt-auto">成就章是講義上的學習標記，不是系統的雲端徽章，也不代表能力認證。</p>`,
  });

  book.add({
    id: "practice-log",
    head: head("練習紀錄表"),
    render: () => `<p class="eyebrow">Practice log</p>
<h1 class="h-page mt-1">練習紀錄表</h1>
<p class="small mt-1">每完成一輪就寫一列。這張表就是你的學習歷程：從第 1 輪到第 8 輪，看看自己改變了什麼。</p>
<table class="record log mt-3"><thead><tr><th style="width:10mm">輪</th><th style="width:18mm">日期</th><th style="width:22mm">交易日／主題</th><th>計畫摘要</th><th style="width:16mm" class="num">委託／成交</th><th style="width:20mm" class="num">本輪損益</th><th>下一次只改一件事</th></tr></thead>
<tbody>${Array.from({ length: 10 }, (_, index) => `<tr><td class="mono">${index + 1}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("")}</tbody></table>
<p class="tiny mt-auto">提示：系統每個交易日只保留最新一輪的完成畫面。開始新的一輪之前，先把這一輪抄進這張表。</p>`,
  });

  const half = Math.ceil(glossary.length / 2);
  [glossary.slice(0, half), glossary.slice(half)].forEach((part, pageIndex) => {
    book.add({
      id: `glossary-${pageIndex + 1}`,
      head: head("術語表"),
      render: (ctx) => `${pageIndex === 0 ? `<p class="eyebrow">Glossary</p><h1 class="h-page mt-1">術語表</h1><p class="small mt-1">依第一次出現的順序排列；右側是第一次出現的任務與頁碼。</p>` : `<p class="eyebrow muted">Glossary · 續</p>`}
<dl class="glossary mt-2">${part
        .map(([name, taskId, text]) => {
          let pageNo = "";
          try {
            pageNo = `p.${ctx.pageOf(`${taskId}-a`)}`;
          } catch {
            pageNo = "";
          }
          return `<div><dt>${esc(name)}<small class="mono">${esc(taskId)} ${pageNo}</small></dt><dd>${ctx.rich(text)}</dd></div>`;
        })
        .join("")}</dl>`,
    });
  });

  for (const index of [1, 2]) {
    book.add({
      id: `notes-${index}`,
      head: head("心得紀錄"),
      render: () => `${index === 1 ? `<p class="eyebrow">Reflection</p><h1 class="h-page mt-1">心得紀錄</h1><p class="small mt-1">寫下每一關最有感覺的一件事、想問講師的問題，或下一次想試的方法。</p>` : `<p class="eyebrow muted">Reflection · 續</p>`}
<div class="lines notebook mt-3">${"<i></i>".repeat(index === 1 ? 28 : 31)}</div>`,
    });
  }

  book.add({
    id: "colophon",
    head: head("資料來源、版本與聲明"),
    render: (ctx) => `<p class="eyebrow">Sources · version · disclaimer</p>
<h1 class="h-page mt-1">資料來源、版本與聲明</h1>
<div class="spec mt-3"><dl>
  <div><dt>系統</dt><dd>當沖大富翁（Day Trade Tycoon）講師帶班模擬交易教室 · release ${esc(data.edition.release)}</dd></div>
  <div><dt>截圖</dt><dd>${esc(data.edition.captured)} 以 Playwright 在本機教學環境（全新暫存資料庫、只綁定本機）以全新學員帳號實際操作擷取；不是設計稿或示意圖。</dd></div>
  <div><dt>行情資料</dt><dd>Yahoo Finance 歷史 1 分鐘 OHLC（2026/10/05、10/06，台積電、鴻海、聯發科、廣達、台達電，09:00–10:30）。每分鐘結束後才揭露；缺漏不以生成價格補齊。昨收由證交所日資料核對。</dd></div>
  <div><dt>教學模擬</dt><dd>五檔價量、委買委賣為教學生成，不是真實委託簿或成交量。紙上成交以下一分鐘開盤價撮合，沒有真實排隊、滑價深度或券商回報。</dd></div>
  <div><dt>費用</dt><dd>手續費 0.0855%（1.425‰ × 六折，每筆最低 20 元）、交易稅 0.15%（教材以當沖稅率估算），逐筆四捨五入。實際費率以你的券商為準。</dd></div>
  <div><dt>每日一題</dt><dd>大廳的「今天的一題」使用前一交易日的真實 1 分 K，是選修的每日練習，不在本手冊的關卡內。</dd></div>
  <div><dt>原始碼</dt><dd>${esc(data.edition.repo)} · 講義原始檔與產生腳本位於 courseware/academy/</dd></div>
</dl></div>
<div class="box warn mt-3"><span class="label">Disclaimer<b>聲明</b></span><p class="small">本手冊與教室系統僅供教學與紙上模擬，不是投資建議、獲利保證或代操服務，也不能下真實委託。當沖交易風險高，可能在短時間內造成重大虧損。模擬成績、成就章與證書都不代表能力認證或未來報酬。</p></div>
<p class="tiny mt-auto">© 當沖大富翁 Trading Academy · Edition ${esc(data.edition.version)} · 供本教室課程使用</p>`,
  });
}
