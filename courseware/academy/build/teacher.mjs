// Instructor guide (講師版教學手冊): course design, session plans, per-level answer keys, the full final
// rubric with a reference record, data appendices and the acceptance summary.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Book } from "./lib/book.mjs";
import { esc, rich, BRAND_SVG, seal } from "./lib/markup.mjs";
import { label, renderFigures } from "./lib/pages.mjs";
import { academy, project, htmlDocument, loadLevels, loadShots, coverArt, applyCaptureEdition, renderStudent } from "./render.mjs";
import { buildReference } from "./reference.mjs";
import * as course from "../content/course.mjs";
import * as teacher from "../content/teacher.mjs";

const HEAD = (text) => `<span class="mono">INSTRUCTOR</span>${esc(text)}`;

function quoteTable(day, clock, ctx) {
  const rows = day.quotes
    .map((quote) => {
      const at = quote.at.find((item) => item.clock === clock);
      const tone = at.change > 0 ? "up" : at.change < 0 ? "down" : "";
      return `<tr><td style="color:var(--ink);font-weight:500">${esc(quote.name)} ${esc(quote.code)}</td><td class="num">${quote.previousClose}</td><td class="num"><b>${at.last}</b></td><td class="num ${tone}">${at.change > 0 ? "▲" : at.change < 0 ? "▼" : ""}${Math.abs(at.change)}</td><td class="num ${tone}">${esc(at.percent)}</td><td class="num">${at.open} / ${at.high} / ${at.low}</td><td class="num">${at.bid1} / ${at.ask1}</td></tr>`;
    })
    .join("");
  return `<table class="record ref answer mt-1"><thead><tr><th>股票</th><th class="num">昨收</th><th class="num">最新價</th><th class="num">漲跌</th><th class="num">漲跌幅</th><th class="num">開／高／低</th><th class="num">買1／賣1（模擬）</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function reentryRows() {
  const data = JSON.parse(readFileSync(join(project, "server", "data", "morning-2026-10-06.json"), "utf8"));
  const bars = data.bars["2330"];
  return [20, 22, 26, 29, 31].map((cursor) => ({ clock: `09:${String(cursor).padStart(2, "0")}`, open: bars[cursor].o }));
}

export async function renderTeacher() {
  const capture = applyCaptureEdition();
  const { pageMap } = await renderStudent();
  const studentPage = (id) => pageMap[id] ?? "?";
  const levels = await loadLevels();
  const shots = loadShots();
  const reference = await buildReference(project);
  const facts = existsSync(join(academy, "assets", "shots", "capture-facts.json"))
    ? JSON.parse(readFileSync(join(academy, "assets", "shots", "capture-facts.json"), "utf8"))
    : {};
  const book = new Book({ kind: "teacher", title: "講師版教學手冊", legal: "講師版教學手冊 · 含期末參考紀錄，請勿發給學員", imageBase: "../../assets/shots/" });
  const day6 = reference.days.find((day) => day.date === "2026-10-06");
  const day5 = reference.days.find((day) => day.date === "2026-10-05");

  book.add({
    id: "t-cover",
    bare: true,
    className: "cover teacher-cover",
    render: () => `<svg class="art" viewBox="0 0 210 297" preserveAspectRatio="none" aria-hidden="true">${coverArt()}</svg>
<div class="inner">
  <div class="brandline">${BRAND_SVG}<div><b>${esc(course.edition.brand)}</b><span>DAY TRADE TYCOON</span></div></div>
  <div class="academy">INSTRUCTOR GUIDE</div>
  <h1>講師版<br>教學手冊</h1>
  <p class="subtitle">六個關卡與期末任務的教學目標、示範流程、操作答案、常見錯誤與評分規準。<br>內含期末參考紀錄：請妥善保管，不要發給學員。</p>
  <div class="levels"><span>COURSE DESIGN</span><span>SESSION PLAN</span><span>ANSWER KEYS</span><span class="final">FINAL RUBRIC</span></div>
  <div class="owner"><div>講師</div><div>班級／梯次</div></div>
  <div class="colophon"><span>EDITION ${esc(course.edition.version)} · 系統版本 ${esc(course.edition.release)}</span><span>CONFIDENTIAL · 講師專用</span></div>
</div>`,
  });

  book.add({
    id: "t-howto",
    head: HEAD("講師版使用說明"),
    render: (ctx) => `<p class="eyebrow">For instructors</p><h1 class="h-page mt-1">講師版使用說明</h1>
<p class="lead mt-2">這本講師版搭配《學員實戰闖關手冊》使用。學員版負責「照著做」；講師版負責「怎麼教、怎麼看、怎麼評」。兩本的關卡、任務編號與截圖完全對應。</p>
<div class="cols-2 mt-4">
  <div class="stack">${label("Inside", "內容")}
    <ul class="checks mt-1">
      <li><span class="mono num-dot">1</span><span>課程設計與課綱對照：系統六課、原期末考與講義關卡的關係</span></li>
      <li><span class="mono num-dot">2</span><span>六堂課授課節奏與開課前準備</span></li>
      <li><span class="mono num-dot">3</span><span>系統現況與已知限制（請在第一堂課前讀完）</span></li>
      <li><span class="mono num-dot">4</span><span>每一關：教學目標、示範流程、操作答案、常見錯誤、完成判定、想一想引導</span></li>
      <li><span class="mono num-dot">5</span><span>期末任務：執行指引、評分規準、評分表、參考紀錄</span></li>
      <li><span class="mono num-dot">6</span><span>附錄：兩日行情參考表、快訊時間表、驗收紀錄、講義維護</span></li>
    </ul>
  </div>
  <div class="stack">${label("Answers", "操作答案從哪裡來")}
    <p class="small">表格中的價格、漲跌、買1／賣1，由教室程式本身的函式（報價摘要、教學五檔、費用計算）直接讀取教材檔案算出；成交、手續費與損益，來自 ${esc(course.edition.captured)} 在本機教學環境以全新學員帳號實際操作的紀錄。沒有任何手動輸入的行情數字。</p>
    <p class="small">學員的回放是固定的歷史資料：在同一個時間看同一檔股票，畫面數字應該和本手冊完全相同。若學員在不同時間送單，成交價會不同——本手冊另提供核對方法。</p>
  </div>
</div>
<div class="box warn mt-4"><span class="label">Confidential<b>保密</b></span><p class="small">「期末參考紀錄」與評分規準的細項只放在講師版。學員版只提供期末任務的規則與評量面向，不含示範答案。請不要把講師版的 PDF 放在學員可以下載的位置。</p></div>
<div class="spec mt-4"><dl>
  <div><dt>手冊版本</dt><dd>Edition ${esc(course.edition.version)} · 講師版</dd></div>
  <div><dt>系統版本</dt><dd>release ${esc(course.edition.release)}；截圖與操作紀錄擷取於 ${esc(course.edition.captured)}</dd></div>
  <div><dt>驗收</dt><dd>${capture ? `Playwright 逐關操作 ${capture.checks} 項檢查，${capture.passed} 項通過${capture.failed?.length ? `，${capture.failed.length} 項失敗` : ""}；詳見附錄 C` : "見附錄 C"}</dd></div>
</dl></div>`,
  });

  book.add({
    id: "t-design",
    head: HEAD("課程設計與課綱對照"),
    render: (ctx) => `<p class="eyebrow">Course design</p><h1 class="h-page mt-1">課程設計與課綱對照</h1>
<p class="lead mt-2">系統的六課（練習主題）與原課綱期末考<b>沒有被修改</b>。講義把它們排成一條能力階梯：前四關練操作（照圖做），第五關起練決策（自己判斷），最後用期末任務整合。</p>
<table class="record design-map mt-3"><thead><tr><th>關卡</th><th>系統課程</th><th>回合／交易日</th><th>學員版</th></tr></thead><tbody>${course.mapping
      .map((row) => {
        const id = row.level === "FINAL" ? "FINAL" : `L${row.level}`;
        return `<tr><td><b class="mono">${row.level === "FINAL" ? "FINAL" : `LEVEL ${esc(row.level)}`}</b><br>${esc(row.title)}</td><td>${esc(row.lesson)}</td><td>${esc(row.round)} · ${esc(row.day)}${row.template !== "—" ? `<br>範本「${esc(row.template)}」` : ""}</td><td class="mono">約 ${row.minutes} 分</td></tr>`;
      })
      .join("")}</tbody></table>
<div class="cols-2 mt-4">
  <div class="stack">${label("Why", "為什麼這樣對應")}
    <p class="small"><b>第 1 課跨 LEVEL 01–04。</b>第 1 課「第一筆有計畫的委託」要求先寫條件、條件成立才送單，並分別核對委託與成交。對完全沒有經驗的學員，第一輪先用系統內建的「先看不做」範本熟悉畫面（L01–02），第二輪再用「回測平盤」範本完成一筆完整交易（L03–04）。</p>
    <p class="small"><b>第 2–5 課集中在 LEVEL 05。</b>四課都是「決策品質」：部位與風險、出場條件、進場理由、等待。學員在這一關開始自己寫計畫。</p>
    <p class="small"><b>第 6 課＝LEVEL 06；期末考＝FINAL MISSION。</b>期末沿用原課綱「自己執行規則、獨立完成一次復盤」的精神；原期末考的 500 萬、2 倍額度屬於已停用的生成情境，改用現行設定。</p>
  </div>
  <div class="stack">${label("Principles", "四個教學原則")}
    <ol class="rules mt-1">
      <li><span class="mono">1</span><span><b>操作在前、決策在後。</b>L01–04 的截圖就是學員會看到的畫面；L05 起示範畫面取自另一天，避免照抄。</span></li>
      <li><span class="mono">2</span><span><b>不以損益評分。</b>完成卡、成就章與期末評分都看紀律與紀錄，賺錢不加分、虧錢不扣分。</span></li>
      <li><span class="mono">3</span><span><b>只用已揭露資料。</b>教材只有兩天；重看時要求學員誠實記錄，評量程序而非「猜對」。</span></li>
      <li><span class="mono">4</span><span><b>一次只改一件事。</b>每一輪復盤只留下一個可以從紀錄核對的改善。</span></li>
    </ol>
  </div>
</div>`,
  });

  book.add({
    id: "t-sessions",
    head: HEAD("六堂課授課節奏"),
    render: (ctx) => `<p class="eyebrow">Session plan</p><h1 class="h-page mt-1">六堂課授課節奏</h1>
<p class="small mt-1">每堂 90 分鐘的建議安排。學員進度不同時，以「完成判定」為準，不必全班同步。</p>
<div class="sessions mt-3">${teacher.sessions
      .map(
        (session) => `<section><header><b class="mono">${String(session.no).padStart(2, "0")}</b><div><h3>${esc(session.levels)}</h3><p>${esc(session.rounds)}</p></div><span class="mono">${session.minutes} 分</span></header><ol>${session.plan.map((item) => `<li>${esc(item)}</li>`).join("")}</ol></section>`,
      )
      .join("")}</div>`,
  });

  book.add({
    id: "t-prep",
    head: HEAD("開課前準備與系統限制"),
    render: (ctx) => `<p class="eyebrow">Before class</p><h1 class="h-page mt-1">開課前準備</h1>
<ul class="checks big mt-2">${teacher.prep.map((item) => `<li><span class="checkbox"></span><span>${rich(item)}</span></li>`).join("")}</ul>
<h2 class="h-section mt-4">系統現況與已知限制</h2>
<p class="small mt-1">以下是 ${esc(course.edition.captured)} 實際操作時確認的系統行為。請在第一堂課前讀完，避免在課堂上對學員做出系統做不到的承諾。</p>
<table class="trouble mt-2"><tbody>${teacher.limits.map(([name, text]) => `<tr><th>${rich(name)}</th><td>${rich(text)}</td></tr>`).join("")}</tbody></table>`,
  });

  for (const level of levels.filter((item) => item.id !== "FINAL")) {
    const info = teacher.levels[level.id];
    const day = day6;
    book.add({
      id: `t-${level.id}-a`,
      level: level.id,
      head: `<span class="mono">LEVEL ${esc(level.code)}</span>${esc(level.title)}`,
      render: (ctx) => `<p class="eyebrow">Level ${esc(level.code)} · Instructor notes</p>
<h1 class="h-page mt-1">${esc(level.title)}</h1>
<p class="small mt-1">對應學員版 p.${studentPage(`${level.id}-open`)}–${studentPage(`${level.id}-done`)}。</p>
<div class="cols-2 mt-3" style="grid-template-columns:1fr 1.15fr">
  <div>${label("Objectives", "教學目標")}<ol class="rules mt-1">${info.objectives.map((item, index) => `<li><span class="mono">${index + 1}</span><span>${rich(item)}</span></li>`).join("")}</ol></div>
  <div>${label("Demo", "示範流程（約 15 分鐘）")}<ol class="timeline demo mt-1">${info.demo.map(([time, text]) => `<li><b class="mono">${esc(time)}</b><span>${rich(text)}</span></li>`).join("")}</ol></div>
</div>
<div class="mt-3">${label("Answer key", "操作答案")}<p class="tiny mt-1">${esc(info.answerNote)}</p>${quoteTable(day, info.answerClock, ctx)}</div>
${info.extraAnswers ? `<table class="trouble mt-2"><tbody>${info.extraAnswers.map(([name, text]) => `<tr><th>${rich(name)}</th><td>${rich(text)}</td></tr>`).join("")}</tbody></table>` : ""}
${level.id === "L03" ? `<p class="small mt-2">${rich(info.reentryNote)}</p><table class="record ref mt-1"><thead><tr><th>錯過後的送單時間</th>${reentryRows().map((row) => `<th class="num">${row.clock}</th>`).join("")}</tr></thead><tbody><tr><td>市價買進成交價（該分鐘開盤）</td>${reentryRows().map((row) => `<td class="num">${row.open}</td>`).join("")}</tr></tbody></table>` : ""}
${level.id === "L05" ? `<div class="mt-2">${thresholdMini(reference)}</div>` : ""}
${info.verifyNote ? `<div class="box note mt-2"><p class="small">${rich(info.verifyNote)}</p></div>` : ""}`,
    });
    book.add({
      id: `t-${level.id}-b`,
      level: level.id,
      head: `<span class="mono">LEVEL ${esc(level.code)}</span>${esc(level.title)}`,
      render: (ctx) => `<p class="eyebrow muted">Level ${esc(level.code)} · ${esc(level.title)}</p>
<div class="cols-2 mt-2">
  <div>${label("Key points", "關鍵注意事項")}<ul class="checks mt-1">${info.keyPoints.map((item) => `<li><span class="mono num-dot">!</span><span>${rich(item)}</span></li>`).join("")}</ul></div>
  <div>${label("Tips", "授課建議")}<ul class="checks mt-1">${info.tips.map((item) => `<li><span class="mono num-dot">+</span><span>${rich(item)}</span></li>`).join("")}</ul></div>
</div>
<div class="mt-3">${label("Common mistakes", "常見錯誤與處理")}<table class="trouble mt-1"><tbody>${info.mistakes.map(([problem, fix]) => `<tr><th>${rich(problem)}</th><td>${rich(fix)}</td></tr>`).join("")}</tbody></table></div>
<div class="mt-3">${label("Done when", "完成判定（客觀、可核對）")}<ul class="checks mt-1">${info.completion.map((item) => `<li><span class="checkbox"></span><span>${rich(item)}</span></li>`).join("")}</ul></div>
<div class="mt-3">${label("Think", "「想一想」引導")}<table class="trouble mt-1"><tbody>${info.think.map(([id, text]) => `<tr><th class="mono" style="width:16mm">${esc(id)}</th><td>${rich(text)}</td></tr>`).join("")}</tbody></table></div>`,
    });
  }

  const finalLevel = levels.find((item) => item.id === "FINAL");
  book.add({
    id: "t-final-guide",
    level: "FINAL",
    head: `<span class="mono">FINAL MISSION</span>期末任務`,
    render: (ctx) => `<p class="eyebrow">Final mission · Instructor</p><h1 class="h-page mt-1">期末任務：講師執行指引</h1>
<div class="cols-2 mt-3">
  <div>${label("Before", "開始前")}<ul class="checks mt-1">
    <li><span class="checkbox"></span><span>指定交易日與練習主題（建議：交易日用學員較少練習的一天；主題用第 6 課）。</span></li>
    <li><span class="checkbox"></span><span>說明規則：計畫單先寫完、條件成立才送單、張數不超過預算、結束前處理部位。</span></li>
    <li><span class="checkbox"></span><span>強調：模擬損益不計分；評的是紀律與紀錄。</span></li>
    <li><span class="checkbox"></span><span>提醒誠實原則：記得後面走勢也要只依當下資料判斷，並在報告寫明。</span></li>
  </ul></div>
  <div>${label("Collect", "收件與核對")}<ul class="checks mt-1">
    <li><span class="checkbox"></span><span>看學員畫面上的完成卡（含復盤全文）——講師工作台目前看不到真實早盤復盤。</span></li>
    <li><span class="checkbox"></span><span>核對系統「本輪作戰計畫」與期末計畫單是否一致。</span></li>
    <li><span class="checkbox"></span><span>核對委託、成交、庫存分頁與決策日誌的時間是否對得上。</span></li>
    <li><span class="checkbox"></span><span>用成交分頁驗算期末報告的淨損益。</span></li>
  </ul></div>
</div>
<div class="box warn mt-3"><span class="label">Integrity<b>公平性</b></span><p class="small">同一天重練時，學員可能記得後面的走勢。評分時不要用「有沒有賺」或「有沒有抓到高低點」判斷；請看事前條件是否清楚、執行是否一致、紀錄是否完整。若學員的進出場「太完美」而事前條件模糊，請在紀律與復盤面向依證據評分。</p></div>
<div class="mt-3">${label("Timing", "時間建議")}<ol class="timeline mt-1">${finalLevel.tasks[0].timeline.map(([time, text]) => `<li><b class="mono">${esc(time)}</b><span>${esc(text)}</span></li>`).join("")}</ol></div>`,
  });

  book.add({
    id: "t-final-rubric",
    level: "FINAL",
    head: `<span class="mono">FINAL MISSION</span>評分規準`,
    render: (ctx) => `<p class="eyebrow">Final mission · Rubric</p><h1 class="h-page mt-1">期末評分規準</h1>
<p class="small mt-1">四個面向共 100 分。每個面向依證據落在「優秀／達成／待加強」三個區間，再在區間內給分。模擬損益不計分。</p>
${teacher.rubric
      .map(
        (part) => `<div class="rubric-full mt-2"><header><b>${esc(part.name)}</b><span class="mono">${part.weight}%</span><span class="bands"><i>優秀 ${esc(part.bands[0])}</i><i>達成 ${esc(part.bands[1])}</i><i>待加強 ${esc(part.bands[2])}</i></span></header>
<table class="record rubric-table"><thead><tr><th style="width:34mm">項目</th><th>優秀</th><th>達成</th><th>待加強</th></tr></thead><tbody>${part.criteria
          .map((row) => `<tr>${row.map((cell, index) => `<td${index === 0 ? ' style="color:var(--ink);font-weight:500"' : ""}>${rich(cell)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      )
      .join("")}`,
  });

  book.add({
    id: "t-final-sheet",
    level: "FINAL",
    head: `<span class="mono">FINAL MISSION</span>評分表`,
    render: (ctx) => `<p class="eyebrow">Final mission · Scoring sheet</p><h1 class="h-page mt-1">期末評分表</h1>
<div class="cols-3 mt-3 short-fields">
  <div class="field"><span class="field-label">學員</span><div class="lines"><i></i></div></div>
  <div class="field"><span class="field-label">交易日／主題</span><div class="lines"><i></i></div></div>
  <div class="field"><span class="field-label">評分日期</span><div class="lines"><i></i></div></div>
</div>
<table class="record score mt-3"><thead><tr><th>面向</th><th>證據（勾選已看到的）</th><th class="num">得分</th></tr></thead><tbody>${teacher.rubric
      .map(
        (part) => `<tr><td style="width:30mm;color:var(--ink);font-weight:700">${esc(part.name)}<br><span class="mono" style="font-weight:400;color:var(--blue)">${part.weight}%</span></td><td>${part.criteria
          .map((row) => `<span class="ev"><i class="checkbox"></i>${esc(row[0])}</span>`)
          .join("")}</td><td class="num" style="width:22mm">／${part.weight}</td></tr>`,
      )
      .join("")}<tr><td colspan="2" style="text-align:right;color:var(--ink);font-weight:700">總分</td><td class="num">／100</td></tr></tbody></table>
<div class="field mt-3"><span class="field-label">給學員的一句回饋<small>先說做到的，再說下一次只改的一件事</small></span><div class="lines"><i></i><i></i><i></i></div></div>
<div class="signoff"><div>講師簽名</div><div>日期</div><div>證書編號</div></div>`,
  });

  const final = facts.final;
  book.add({
    id: "t-final-reference",
    level: "FINAL",
    head: `<span class="mono">FINAL MISSION</span>參考紀錄`,
    render: (ctx) => `<p class="eyebrow">Final mission · Reference record · Confidential</p><h1 class="h-page mt-1">期末參考紀錄（講師專用）</h1>
<p class="small mt-1">這是 ${esc(course.edition.captured)} 在本機教學環境實際完成的一場期末任務，用來示範「好的紀錄長什麼樣子」。學員可以選不同的股票與條件，<b>沒有標準答案</b>；評分請依規準看證據。</p>
<div class="spec mt-3"><dl>
  <div><dt>交易日／主題</dt><dd>2026/10/05 · 第 6 課 用紀錄完成復盤</dd></div>
  <div><dt>股票</dt><dd>2317 鴻海（昨收 251）</dd></div>
  <div><dt>理由</dt><dd>鴻海開在昨收之上，練習完整執行自己的規則。</dd></div>
  <div><dt>進場條件</dt><dd>收價站穩 255（連續兩分鐘不低於 255）才買進 1 張；可承受模擬損失 3,000 元。</dd></div>
  <div><dt>出場條件</dt><dd>收價跌破 254 就賣出；10:00 前一定處理完部位。</dd></div>
</dl></div>
${final ? `<table class="record ref mt-3"><thead><tr><th>時間</th><th>方向</th><th class="num">張數</th><th class="num">成交價</th><th class="num">手續費</th><th class="num">交易稅</th></tr></thead><tbody>${final.fills
      .map((fill) => `<tr><td class="num">${minute(fill.t)}</td><td>${fill.side === "buy" ? "買進" : "賣出"}</td><td class="num">${fill.shares / 1000}</td><td class="num">${fill.price}</td><td class="num">${fill.fee.toLocaleString("en-US")}</td><td class="num">${fill.tax.toLocaleString("en-US")}</td></tr>`)
      .join("")}</tbody></table>
<p class="small mt-2">淨損益：（${final.fills[1].price} − ${final.fills[0].price}）× 1,000 − ${final.fills[0].fee} − ${final.fills[1].fee} − ${final.fills[1].tax} = <b>${final.pnl.toLocaleString("en-US")}</b> 元（＝系統本輪損益）。結束時庫存 0。</p>` : `<p class="small mt-3">（執行 capture 後會自動填入成交紀錄。）</p>`}
<div class="box example mt-3">${label("Exemplary report", "優秀報告的寫法（示範）")}<p class="small"><b>計畫：</b>站穩 255 才買 1 張，跌破 254 賣出，可承受 3,000 元；費稅門檻約 2 檔（每股約 0.81 元，一檔 0.5 元）。<b>執行：</b>09:00–09:02 收價都是 255，09:03 依條件送出市價買進，以 09:03 開盤價成交；之後收價在 254–256 之間，09:24 收在 253.5 跌破 254，09:25 依條件賣出。<b>結果：</b>價差 −1,000 元、費稅 816 元，淨損益 −1,816 元，在 3,000 元預算內；結束時庫存 0。<b>改善：</b>進場條件「站穩」只看兩分鐘，太快進場；下一次只改一件事——把「站穩」定義成三分鐘，並在計畫單寫明。</p></div>
<p class="tiny mt-2">評分示意：操作正確性 25、紀律 30、風險理解 18（滑價說明可再具體）、復盤品質 23。此為示意，不是固定答案。</p>`,
  });

  book.add({
    id: "t-appendix-a1",
    head: HEAD("附錄 A 兩日行情參考表"),
    render: (ctx) => appendixDay(day6, "附錄 A-1", "2026/10/06"),
  });
  book.add({
    id: "t-appendix-a2",
    head: HEAD("附錄 A 兩日行情參考表"),
    render: (ctx) => appendixDay(day5, "附錄 A-2", "2026/10/05"),
  });
  book.add({
    id: "t-appendix-b",
    head: HEAD("附錄 B 快訊時間表"),
    render: (ctx) => `<p class="eyebrow">Appendix B</p><h1 class="h-page mt-1">快訊時間表</h1>
<p class="small mt-1">快訊列只顯示最新一則。下表是每個時鐘時間快訊列上顯示的內容（只列出有變化的時間），由教室的快訊函式依已揭露資料計算。</p>
<div class="cols-2 mt-3">${[day6, day5]
      .map(
        (day) => `<div>${label(day.date, "快訊")}<table class="record ref mt-1"><thead><tr><th style="width:16mm">時鐘</th><th>快訊列顯示</th></tr></thead><tbody>${day.timeline
          .map((item) => `<tr><td class="num">${item.clock}</td><td>${esc(item.text)}</td></tr>`)
          .join("")}</tbody></table></div>`,
      )
      .join("")}</div>`,
  });
  book.add({
    id: "t-appendix-c",
    head: HEAD("附錄 C 驗收紀錄"),
    render: (ctx) => {
      const checks = existsSync(join(academy, "assets", "shots", "capture-checks.json"))
        ? JSON.parse(readFileSync(join(academy, "assets", "shots", "capture-checks.json"), "utf8"))
        : [];
      const groups = [...new Set(checks.map((item) => item.scope))];
      return `<p class="eyebrow">Appendix C</p><h1 class="h-page mt-1">驗收紀錄摘要</h1>
<p class="small mt-1">講義的每一個操作步驟，都用 Playwright 在全新的本機教學環境（暫存資料庫、只綁定 127.0.0.1）以全新學員帳號實際走過一次，並在每一步檢查畫面是否如講義所寫。</p>
<div class="spec mt-3"><dl>
  <div><dt>系統版本</dt><dd>${esc(capture?.release ?? "")}</dd></div>
  <div><dt>執行時間</dt><dd>${esc(capture?.startedAt ?? "")} → ${esc(capture?.finishedAt ?? "")}（UTC）</dd></div>
  <div><dt>結果</dt><dd>${capture ? `${capture.checks} 項檢查、${capture.passed} 項通過、${capture.failed.length} 項失敗；擷取 ${capture.shots} 張畫面；測試資料庫${capture.serverClosedCleanly ? "已正常關閉" : "未確認關閉"}` : ""}</dd></div>
</dl></div>
<table class="record ref checks-table mt-3"><thead><tr><th style="width:18mm">範圍</th><th class="num" style="width:16mm">項目</th><th>檢查重點（節錄）</th></tr></thead><tbody>${groups
        .map((scope) => {
          const items = checks.filter((item) => item.scope === scope);
          const passed = items.filter((item) => item.ok).length;
          return `<tr><td class="mono">${esc(scope)}</td><td class="num">${passed}/${items.length}</td><td>${items
            .slice(0, 4)
            .map((item) => esc(item.label))
            .join("；")}${items.length > 4 ? "…" : ""}</td></tr>`;
        })
        .join("")}</tbody></table>
<p class="tiny mt-2">完整逐項紀錄：courseware/academy/verification/。未測試的裝置（實體 iPhone、Android 手機、平板）與實體 A4 列印效果，請見製作報告的「未驗證項目」。</p>`;
    },
  });
  book.add({
    id: "t-appendix-d",
    head: HEAD("附錄 D 講義維護"),
    render: (ctx) => `<p class="eyebrow">Appendix D</p><h1 class="h-page mt-1">講義維護：系統更新後重新製作</h1>
<p class="small mt-1">講義的文字、截圖與排版全部由原始檔產生。系統畫面改版後，依下列步驟重新擷取與輸出，截圖與頁碼會自動更新。</p>
<ol class="steps mt-3">
  <li><span class="n">1</span><span class="t">重新擷取：<span class="mono">node courseware/academy/capture/run.mjs</span><span class="sub">自動啟動暫存教室（預設使用主機目前上線的 release），以全新學員走完全部關卡，逐步檢查並擷取畫面。</span></span></li>
  <li><span class="n">2</span><span class="t">更新圖庫：<span class="mono">python courseware/academy/build/shots.py …</span><span class="sub">把擷取結果放進 assets/shots/，同時保存擷取摘要。</span></span></li>
  <li><span class="n">3</span><span class="t">輸出講義：<span class="mono">node courseware/academy/build/build.mjs</span><span class="sub">產生學員版、講師版 PDF 與數位互動版；任何一頁溢出版面就會停止並列出頁碼。</span></span></li>
  <li><span class="n">4</span><span class="t">品質檢查：<span class="mono">python courseware/academy/build/qa_pdf.py …</span><span class="sub">檢查 A4、字型嵌入、文字可搜尋、圖片解析度，並輸出頁面預覽。</span></span></li>
</ol>
<div class="box note mt-3"><p class="small">若系統按鈕文字改變，擷取腳本的檢查會失敗並指出是哪一步——先修正 content/ 中對應的講義文字，再重新擷取。詳細說明見 courseware/academy/README.md。</p></div>`,
  });

  const body = book.render();
  const html = htmlDocument({ title: `${course.edition.brand}｜講師版教學手冊`, body, css: ["../../design/print.css", "../../design/teacher.css"] });
  return { html, pages: book.pages.length };
}

function minute(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function thresholdMini(reference) {
  const day = reference.days.find((item) => item.date === "2026-10-06");
  return `${label("Threshold", "費稅門檻（以 10/06 昨收估算）")}<table class="record ref mt-1"><thead><tr><th>股票</th><th class="num">1 張金額</th><th class="num">來回費稅</th><th class="num">每股成本</th><th class="num">一檔</th><th class="num">至少幾檔</th></tr></thead><tbody>${day.quotes
    .map((quote) => `<tr><td>${esc(quote.name)}</td><td class="num">${quote.lot.toLocaleString("en-US")}</td><td class="num">${quote.roundTrip.toLocaleString("en-US")}</td><td class="num">${quote.perShare.toFixed(2)}</td><td class="num">${quote.tick}</td><td class="num"><b>${quote.ticksToBreakEven}</b></td></tr>`)
    .join("")}</tbody></table>`;
}

function appendixDay(day, code, date) {
  const clocks = day.quotes[0].at.map((item) => item.clock);
  return `<p class="eyebrow">${esc(code)}</p><h1 class="h-page mt-1">${esc(date)} 行情參考表</h1>
<p class="small mt-1">各時鐘時間的最新價（最新完整分鐘收盤價）與漲跌幅。學員畫面在同一時間應顯示相同數字。資料：教材檔案 ${esc(day.lessonId)}。</p>
<table class="record ref appendix mt-3"><thead><tr><th>時鐘</th>${day.quotes.map((quote) => `<th class="num">${esc(quote.name)}<br><span class="mono">昨 ${quote.previousClose}</span></th>`).join("")}</tr></thead><tbody>${clocks
    .map(
      (clock) =>
        `<tr><td class="num">${clock}</td>${day.quotes
          .map((quote) => {
            const at = quote.at.find((item) => item.clock === clock);
            const tone = at.change > 0 ? "up" : at.change < 0 ? "down" : "";
            return `<td class="num"><b>${at.last}</b><br><span class="${tone}">${esc(at.percent)}</span></td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table>
<p class="tiny mt-2">開盤／最高／最低與買1／賣1（教學模擬）見各關的操作答案表。</p>`;
}
