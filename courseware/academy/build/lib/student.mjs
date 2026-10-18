// The student workbook: front matter, levels (opener → tasks → completion), final mission, back matter.
import { esc, BRAND_SVG, label, renderFigures } from "./pages.mjs";

const FRONT_HEAD = (text) => `<span class="mono">ACADEMY</span>${esc(text)}`;

/* ───────────────────────── front matter ───────────────────────── */
export function addFront(book, data) {
  const { edition, notices, anatomy, loop, mapping, achievements, prep, shots, cover } = data;

  book.add({
    id: "cover",
    bare: true,
    className: "cover",
    render: () => `<svg class="art" viewBox="0 0 210 297" preserveAspectRatio="none" aria-hidden="true">${cover}</svg>
<div class="inner">
  <div class="brandline">${BRAND_SVG}<div><b>${esc(edition.brand)}</b><span>DAY TRADE TYCOON</span></div></div>
  <div class="academy">TRADING ACADEMY</div>
  <h1>學員實戰<br>闖關手冊</h1>
  <p class="subtitle">從第一個報價，到第一場完整的模擬當沖。<br>六個關卡與一場期末任務，每一步都在真實的教室系統上完成。</p>
  <div class="levels">${["01", "02", "03", "04", "05", "06"].map((code) => `<span>LEVEL ${code}</span>`).join("")}<span class="final">FINAL MISSION</span></div>
  <div class="owner"><div>姓名</div><div>班級</div></div>
  <div class="colophon"><span>EDITION ${esc(edition.version)} · 系統版本 ${esc(edition.release)}</span><span>模擬交易教學 · 非投資建議</span></div>
</div>`,
  });

  book.add({
    id: "notice",
    head: FRONT_HEAD("使用前必讀"),
    render: (ctx) => `<p class="eyebrow">Before you start</p>
<h1 class="h-page mt-1">使用前必讀</h1>
<p class="lead mt-2">這本手冊帶你在「當沖大富翁」交易教室裡，一關一關完成模擬交易的基本功：看懂報價、送出委託、完成買賣、控制風險、寫好復盤。開始前，請先讀完這一頁。</p>
<div class="cols-2 mt-4" style="row-gap:5mm">${notices
      .map(
        (notice, index) => `<div class="stack"><p class="mono" style="font-size:8pt;color:var(--blue);letter-spacing:.12em">0${index + 1}</p><h3 class="h-section" style="font-size:11.5pt">${esc(notice.title)}</h3><p class="small">${ctx.rich(notice.body)}</p></div>`,
      )
      .join("")}
<div class="stack"><p class="mono" style="font-size:8pt;color:var(--blue);letter-spacing:.12em">06</p><h3 class="h-section" style="font-size:11.5pt">遇到困難，先停下來</h3><p class="small">${ctx.rich("每個任務都有『遇到問題』對照表；仍然卡住時，按「暫停」、記下畫面上的訊息，再請講師協助。模擬回放不會因為你停下來而錯過行情。")}</p></div>
</div>
<div class="spec mt-4"><dl>
  <div><dt>手冊版本</dt><dd>Edition ${esc(edition.version)} · 學員版</dd></div>
  <div><dt>系統版本</dt><dd>當沖大富翁 release ${esc(edition.release)}；全部截圖於 ${esc(edition.captured)} 在本機教學環境實際操作擷取</dd></div>
  <div><dt>練習資料</dt><dd>2026/10/05、2026/10/06 兩個交易日 · 各 5 檔（台積電、鴻海、聯發科、廣達、台達電）· 09:00–10:30</dd></div>
  <div><dt>封面曲線</dt><dd>五檔教材股票在 2026/10/06 09:00–10:30 的實際分鐘收盤價漲跌幅；藍線為台積電 2330</dd></div>
</dl></div>`,
  });

  book.add({
    id: "howto",
    head: FRONT_HEAD("怎麼使用這本手冊"),
    render: (ctx) => `<p class="eyebrow">How this workbook works</p>
<h1 class="h-page mt-1">怎麼使用這本手冊</h1>
<p class="lead mt-2">每一關都用同一個節奏前進。你不需要老師站在旁邊，只要照著圖、一步一步做，做完立刻就能檢查自己有沒有做對。</p>
<div class="loop mt-4">${loop
      .map((step, index) => `<div class="loop-step"><span class="mono">0${index + 1}</span><b>${esc(step)}</b></div>`)
      .join('<span class="loop-arrow">→</span>')}</div>
<div class="cols-2 mt-4">
  <div>${label("Anatomy", "每個任務的十個部分")}
    <ol class="anatomy mt-1">${anatomy.map(([name, text], index) => `<li><span class="mono">${String(index + 1).padStart(2, "0")}</span><b>${esc(name)}</b><span>${esc(text)}</span></li>`).join("")}</ol>
  </div>
  <div>${label("Legend", "圖上的標示")}
    <ul class="legend-list mt-1">
      <li><span class="demo"><b class="marker static">1</b></span><span><b>藍色圓形數字</b>：步驟編號，對應『逐步操作』的同一個數字。</span></li>
      <li><span class="demo"><i class="ring static"></i></span><span><b>藍色框</b>：要看或要按的位置；虛線框代表『可以看看』的選做項目。</span></li>
      <li><span class="demo"><b class="marker letter static">A</b></span><span><b>白底字母</b>：補充說明，不是操作步驟。</span></li>
      <li><span class="demo"><span class="ui">進入教室</span></span><span><b>灰框文字</b>：畫面上的按鈕或標籤，照字面找就對了。</span></li>
      <li><span class="demo"><span class="term-sample">名詞小卡</span></span><span><b>名詞小卡</b>：第一次出現的專有名詞，用白話說明；完整解釋在書末術語表。</span></li>
      <li><span class="demo"><span class="checkbox" style="display:inline-block"></span></span><span><b>勾選框</b>：做完就打勾。每關最後請講師在完成頁簽名。</span></li>
    </ul>
  </div>
</div>
<div class="mt-4">${label("Example", "標號怎麼對照")}<div class="howto-example mt-1">${renderFigures([{ shot: "gate", crop: { around: ["agree", "enter"], pad: 14, padLeft: 28 }, marks: [{ n: 2, target: "agree", pos: "l" }, { n: 3, target: "enter", pos: "l" }] }], data.shots, ctx, "0-")}<ol class="steps"><li><span class="n">2</span><span class="t">讀完聲明後，勾選同意。</span></li><li><span class="n">3</span><span class="t">按「進入教室」。<span class="sub">圖上的 3 號圓點和藍框，就是這一步要按的位置。</span></span></li></ol></div></div>
<div class="box note mt-auto"><p class="small"><b>也可以用手機讀：</b>數位互動版有同樣的內容，可以放大截圖、勾選完成項目。勾選紀錄只存在你自己的瀏覽器裡，換裝置或清除瀏覽器資料就會消失，也不會傳給講師；正式紀錄仍以這本手冊與教室系統為準。</p></div>`,
  });

  book.add({
    id: "toc",
    head: FRONT_HEAD("目錄"),
    render: (ctx) => {
      const front = [
        ["使用前必讀", "notice"],
        ["怎麼使用這本手冊", "howto"],
        ["學習地圖", "map"],
        ["開課前準備", "prep"],
        ["課前暖身：三分鐘免費體驗", "warmup"],
      ];
      const levels = data.levels
        .filter((level) => book.pages.some((page) => page.id === `${level.id}-open`))
        .map((level) => {
          const items = level.tasks
            .map((task) => `<li><span class="mono">${esc(task.id)}</span><span>${esc(task.title)}</span><span class="pg">${ctx.pageOf(`${task.id}-a`)}</span></li>`)
            .join("");
          return `<section><h3><span class="mono">${level.id === "FINAL" ? "FINAL" : `LEVEL ${esc(level.code)}`}</span><span>${esc(level.title)}</span><span class="pg">${ctx.pageOf(`${level.id}-open`)}</span></h3><ul>${items}</ul></section>`;
        })
        .join("");
      const back = (data.backToc ?? [])
        .filter(([, id]) => book.pages.some((page) => page.id === id))
        .map(([name, id]) => `<li><span class="mono">·</span><span>${esc(name)}</span><span class="pg">${ctx.pageOf(id)}</span></li>`)
        .join("");
      return `<p class="eyebrow">Contents</p><h1 class="h-page mt-1">目錄</h1>
<div class="toc mt-4">
  <section><h3><span class="mono">START</span><span>開始之前</span><span class="pg">${ctx.pageOf("notice")}</span></h3><ul>${front
        .map(([name, id]) => `<li><span class="mono">·</span><span>${esc(name)}</span><span class="pg">${ctx.pageOf(id)}</span></li>`)
        .join("")}</ul></section>
  ${levels}
  ${back ? `<section><h3><span class="mono">END</span><span>附錄與紀錄</span><span class="pg"></span></h3><ul>${back}</ul></section>` : ""}
</div>`;
    },
  });

  book.add({
    id: "map",
    head: FRONT_HEAD("學習地圖"),
    render: (ctx) => `<p class="eyebrow">Learning map</p>
<h1 class="h-page mt-1">學習地圖</h1>
<p class="lead mt-2">六個關卡加一場期末任務，每一關只多學一項新操作。右欄是這一關在教室系統裡要選的「練習主題」——系統的六課沒有被改動，講義只是告訴你每一關用哪一課來練。</p>
<ol class="map-list mt-3">${mapping
      .map((row) => {
        const key = Object.keys(achievements).find((name) => achievements[name].code === row.level);
        const item = achievements[key];
        const levelId = row.level === "FINAL" ? "FINAL" : `L${row.level}`;
        const hasPage = book.pages.some((page) => page.id === `${levelId}-open`);
        return `<li>
  <div class="map-code"><span class="mono">${row.level === "FINAL" ? "FINAL" : "LEVEL"}</span><b class="mono">${row.level === "FINAL" ? "★" : esc(row.level)}</b></div>
  <div class="map-main"><h3>${esc(row.title)}</h3><p>${esc(item.promise)}</p><p class="ach"><span class="mono">★ ${esc(item.en.toUpperCase())}</span> ${esc(item.zh)}</p></div>
  <div class="map-sys"><p><b>${esc(row.lesson)}</b></p><p>${esc(row.round)} · ${esc(row.day)}${row.template !== "—" ? ` · 範本「${esc(row.template)}」` : ""}</p><p class="mono">約 ${row.minutes} 分鐘${hasPage ? ` · p.${ctx.pageOf(`${levelId}-open`)}` : ""}</p></div>
</li>`;
      })
      .join("")}</ol>
<div class="box note mt-4"><p class="small"><b>什麼是『一輪』？</b>在教室系統裡，一輪練習 = 寫作戰計畫 → 逐分鐘回放 09:00–10:00（可延伸到 10:30）→ 保存復盤。每個交易日同時只會有一輪進行中；保存復盤後，才能用新的計畫或另一個練習主題「再練一輪」。</p></div>`,
  });

  book.add({
    id: "prep",
    head: FRONT_HEAD("開課前準備"),
    render: (ctx) => `<p class="eyebrow">Get ready</p>
<h1 class="h-page mt-1">開課前準備</h1>
<p class="lead mt-2">第一堂課開始前，花五分鐘確認下面這些事。全部打勾，就可以開始 LEVEL 01。</p>
<ul class="checks big mt-3">${prep.devices.map((item) => `<li><span class="checkbox"></span><span>${ctx.rich(item)}</span></li>`).join("")}</ul>
<div class="box warn mt-3"><span class="label">Safety<b>安全提醒</b></span><p class="small">${ctx.rich(prep.safety)}</p></div>
<div class="mt-4">${label("Round", "每一輪練習的流程")}
  <div class="flow mt-2">
    <div><span class="mono">01</span><b>寫作戰計畫</b><p>選範本或自己寫：關注哪一檔、什麼條件才操作、什麼情況代表計畫失效。</p></div>
    <div><span class="mono">02</span><b>逐分鐘回放</b><p>用「+1 分」或「播放」前進。只看得到已經走完的分鐘；10:00 會停下來提醒你回看計畫。</p></div>
    <div><span class="mono">03</span><b>委託與核對</b><p>條件成立才送出紙上委託；每次成交後核對委託、成交與庫存。</p></div>
    <div><span class="mono">04</span><b>保存復盤</b><p>寫下這一輪看到的事與下次要改進的一件事，按「保存復盤，完成這一輪」。</p></div>
  </div>
</div>
<div class="mt-4">${label("Notebook", "我的教室資訊（不要寫密碼）")}
  <table class="record mt-1"><tbody>
    <tr><td style="width:34mm;color:var(--ink-2)">教室網址</td><td></td></tr>
    <tr><td style="color:var(--ink-2)">帳號信箱</td><td></td></tr>
    <tr><td style="color:var(--ink-2)">班級代碼</td><td></td></tr>
    <tr><td style="color:var(--ink-2)">上課時間</td><td></td></tr>
  </tbody></table>
</div>`,
  });

  book.add({
    id: "warmup",
    head: FRONT_HEAD("課前暖身"),
    render: (ctx) => `<p class="eyebrow">Warm-up · 3 minutes</p>
<h1 class="h-page mt-1">課前暖身：三分鐘免費體驗</h1>
<p class="lead mt-2">${ctx.rich("還沒拿到入場碼，也可以先熱身。入場頁的「先體驗模擬操作」是一段固定範例：不用帳號、不用行情，三個小問題帶你走過『確認委託 → 查看成交 → 看懂成本』。")}</p>
${renderFigures(
      [
        {
          row: [
            { shot: "try-review", label: "第 1 步 · 確認委託", caption: "先看清楚這一張範例委託：1 張是 1,000 股。", crop: { around: ["order", "action"], pad: 16, padTop: 120 }, gutter: 58, rings: [{ target: "question", soft: true }], marks: [{ n: 1, target: "order", pos: "gl" }, { n: 2, target: "action", pos: "gl" }] },
            { shot: "try-complete", label: "完成", caption: "三步完成後的畫面。", crop: { around: ["done"], pad: 6, padBottom: 0 }, marks: [{ n: 3, target: "done", pos: "tl", ring: false }] },
          ],
        },
      ],
      shots,
      ctx,
      "0-",
    )}
<ol class="steps mt-3">${[
    "在入場頁按「先體驗模擬操作」（或請講師給你體驗頁網址）。看範例委託卡，回答「這張範例委託的數量是多少？」",
    "選好答案後按「確認並送出範例委託」，接著回答「接下來先做哪件事？」",
    "看完成交與平倉後，算出「扣除這筆範例成本後，結果是多少？」，按「確認結果，完成體驗」。",
  ]
    .map((text, index) => `<li><span class="n">${index + 1}</span><span class="t">${ctx.rich(text)}</span></li>`)
    .join("")}</ol>
<div class="box note mt-2"><p class="small">這段體驗是固定的教學範例：每股 100 元、成本假設 100 元，不是真實費率，也不計入任何成績。真正的練習從 LEVEL 01 開始。</p></div>
<div class="checks-inline mt-auto"><span class="checkbox"></span><span class="small">${ctx.rich("我完成了三分鐘體驗，看到「完成了！你剛剛練習了這三件事」。")}</span></div>`,
  });
}

export { addLevel, addBack } from "./student-levels.mjs";
