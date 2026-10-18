#!/usr/bin/env node
// Builds the per-figure screenshot audit table (read only). For every screenshot the workbook places:
// where it appears (PDF pages, web view), which feature it shows, which release and capture run it came from,
// whether that capture run's checks passed, and whether the independent journey completed the same task.
//
//   node qa/acceptance/shot_audit.mjs --academy <courseware/academy> --pdf <pages.json> --journey <journey.json>
//        --release <production release id> --out <markdown file>
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const academy = resolve(option("academy"));
const pdf = option("pdf") && existsSync(option("pdf")) ? JSON.parse(readFileSync(option("pdf"), "utf8")) : null;
const journey = option("journey") && existsSync(option("journey")) ? JSON.parse(readFileSync(option("journey"), "utf8")) : null;
const production = option("release");
const out = option("out");

const shots = JSON.parse(readFileSync(join(academy, "assets", "shots", "shots.json"), "utf8"));
const summary = JSON.parse(readFileSync(join(academy, "verification", "capture-summary.json"), "utf8"));
const FEATURES = {
  "01-1": "進入教室（入場碼）", "01-2": "學員帳號", "01-3": "作戰計畫 · 模擬重播開始", "01-4": "工作台地圖 · 新手教學 · 模擬重播",
  "01-5": "自選股清單 · 切換股票", "01-6": "股票報價位置", "02-1": "自選股清單 · 漲跌", "02-2": "行情（開盤／最高／最低）",
  "02-3": "分時及 K 線切換", "02-4": "五檔報價", "02-5": "分鐘明細", "02-6": "交易復盤", "03-1": "作戰計畫範本",
  "03-2": "模擬重播 · 快訊", "03-3": "下單面板 · 買進／賣出 · 市價／限價", "03-4": "委託確認視窗", "03-5": "委託與成交紀錄",
  "04-1": "撮合 · 成交", "04-2": "庫存與損益", "04-3": "限價留單 · 撤單流程", "04-4": "依計畫賣出", "04-5": "費稅與損益對帳",
  "04-6": "10:00 回看 · 交易復盤", "05-1": "費稅門檻", "05-2": "風險與張數", "05-3": "出場條件", "05-4": "前高與突破",
  "05-5": "等待與延伸觀察", "06-1": "復盤：選習慣", "06-2": "決策日誌", "06-3": "四份紀錄核對", "06-4": "損益與遵守計畫",
  "06-5": "失誤與改善", "06-6": "系統復盤 · 完成卡", "F-1": "期末任務簡報", "F-2": "評量方式", "F-3": "期末計畫單", "F-4": "決策日誌", "F-5": "期末報告",
};

/** Every object with a `shot` inside a task, wherever the content keeps it (figures, rows, stages, map, extras). */
function shotsIn(value, found = []) {
  if (Array.isArray(value)) value.forEach((item) => shotsIn(item, found));
  else if (value && typeof value === "object") {
    if (typeof value.shot === "string") found.push({ shot: value.shot, caption: value.caption ?? value.label ?? "" });
    for (const [key, child] of Object.entries(value)) if (key !== "shot") shotsIn(child, found);
  }
  return found;
}

const contentDir = join(academy, "content");
const files = readdirSync(contentDir).filter((name) => /^(l0\d|final|digital|quick).*\.mjs$/.test(name));
const rows = [];
for (const file of files) {
  const module = await import(pathToFileURL(join(contentDir, file)).href);
  const levels = [module.default, ...Object.values(module)].filter((value) => value && typeof value === "object" && Array.isArray(value.tasks));
  const seen = new Set();
  for (const level of levels) {
    if (seen.has(level.id)) continue;
    seen.add(level.id);
    for (const task of level.tasks) {
      const pages = pdf ? pdf.pages.filter((page) => page.tasks.includes(task.id)).map((page) => page.page) : [];
      const steps = journey ? journey.records.filter((record) => record.task === task.id) : [];
      const journeyResult = !steps.length ? "未涵蓋" : steps.every((record) => record.ok) ? `通過 ${steps.length}/${steps.length}` : `失敗 ${steps.filter((r) => !r.ok).length}/${steps.length}`;
      for (const { shot, caption } of shotsIn(task)) {
        const meta = shots[shot];
        const problems = [];
        if (!meta) problems.push("shots.json 沒有這張圖");
        if (summary.release !== production) problems.push(`擷取版本 ${summary.release} ≠ 正式站 ${production}`);
        if (summary.failed?.length) problems.push(`擷取檢查失敗 ${summary.failed.length} 項`);
        if (!existsSync(join(academy, "assets", "shots", meta?.image ?? `${shot}.png`))) problems.push("圖片檔不存在");
        if (steps.some((record) => !record.ok)) problems.push(steps.filter((record) => !record.ok).map((record) => `${record.does}：${record.actual.slice(0, 60)}`).join("；"));
        rows.push({
          pages: pages.join(", ") || "—",
          task: task.id,
          feature: FEATURES[task.id] ?? task.title,
          shot,
          caption: String(caption).replace(/\s+/g, " ").slice(0, 40),
          release: summary.release,
          takenAt: meta?.takenAt ?? "—",
          url: meta?.url ?? "—",
          clock: meta?.clock ?? "—",
          // Same release as production, the capture run's checks all passed, and the image is in the workbook.
          consistent: meta && existsSync(join(academy, "assets", "shots", meta.image ?? `${shot}.png`)) && summary.release === production && !summary.failed?.length ? "是" : "否",
          operable: journeyResult,
          problems: problems.join("；") || "—",
        });
      }
    }
  }
}
// Every screenshot in shots.json must be accounted for: those not placed by a task (warm-up page, quick
// mission, cover pages) are found by searching the content and layout source for their name.
import { readdirSync as listDir } from "node:fs";
const sources = [];
for (const dir of ["content", "build", join("build", "lib")]) {
  for (const name of listDir(join(academy, dir)).filter((file) => /\.(mjs|js)$/.test(file))) sources.push([`${dir}/${name}`, readFileSync(join(academy, dir, name), "utf8")]);
}
const placed = new Set(rows.map((row) => row.shot));
const quickIds = { "q-today": "Q", "q-plan": "Q", "q-desk": "Q", "q-quote": "Q" };
for (const [shot, meta] of Object.entries(shots)) {
  if (placed.has(shot)) continue;
  const where = sources.filter(([, text]) => text.includes(`"${shot}"`)).map(([file]) => file);
  const task = quickIds[shot] ?? (where.some((file) => file.includes("student") || file.includes("pages")) ? "版面頁" : "—");
  const pages = pdf ? pdf.pages.filter((page) => page.tasks.includes(task)).map((page) => page.page) : [];
  const problems = [];
  if (!where.length) problems.push("沒有任何頁面使用（未印出）");
  if (summary.release !== production) problems.push(`擷取版本 ${summary.release} ≠ 正式站 ${production}`);
  rows.push({
    pages: pages.join(", ") || (where.length ? `見 ${where.join("、")}` : "—"),
    task,
    feature: task === "Q" ? "課前小任務（訪客路徑）" : shot.startsWith("try-") ? "課前暖身（免費體驗頁）" : shot.startsWith("phone") ? "手機版畫面" : "版面頁圖片",
    shot,
    caption: "",
    release: summary.release,
    takenAt: meta.takenAt ?? "—",
    url: meta.url ?? "—",
    clock: meta.clock ?? "—",
    consistent: where.length && existsSync(join(academy, "assets", "shots", meta.image ?? `${shot}.png`)) && summary.release === production && !summary.failed?.length ? "是" : where.length ? "否" : "未使用",
    operable: journey ? (task === "Q" ? "（旅程未單獨走訪客路徑；作者擷取 quick 10/10）" : "—") : "—",
    problems: problems.join("；") || "—",
  });
}
// Per task, the five checks the acceptance asks for. "Image exists + capture passed" is only check ① (traceable);
// it is never reported as consistency on its own.
//   --reviewed <pages the acceptor looked at enlarged, comma separated>  --pairs <tasks with side-by-side sheets>
//   --marks <the author's marks-qa.json>
const reviewed = new Set((option("reviewed") ?? "").split(",").filter(Boolean).map(Number));
const paired = new Set((option("pairs") ?? "").split(",").filter(Boolean));
const marks = option("marks") && existsSync(option("marks")) ? JSON.parse(readFileSync(option("marks"), "utf8")) : null;
const taskRows = [];
for (const file of files) {
  const module = await import(pathToFileURL(join(contentDir, file)).href);
  const levels = [module.default, ...Object.values(module)].filter((value) => value && typeof value === "object" && Array.isArray(value.tasks));
  const seen = new Set();
  for (const level of levels) {
    if (seen.has(level.id)) continue;
    seen.add(level.id);
    for (const task of level.tasks) {
      if (taskRows.some((row) => row.task === task.id)) continue;
      const figures = rows.filter((row) => row.task === task.id);
      const pages = pdf ? pdf.pages.filter((page) => page.tasks.includes(task.id)).map((page) => page.page) : [];
      const desk = journey ? journey.records.filter((record) => record.task === task.id && record.level !== "WORKBOOK") : [];
      const book = journey ? journey.records.filter((record) => record.task === task.id && record.level === "WORKBOOK") : [];
      const expectSteps = desk.filter((record) => record.expected && task.expect && record.expected === task.expect);
      const recoveries = desk.filter((record) => record.kind === "recovery").length;
      const traceable = figures.every((row) => row.consistent === "是");
      const one = !figures.length ? "無截圖" : traceable ? `是（${figures.length} 張；${summary.release}；擷取 ${summary.passed}/${summary.checks}）` : `否：${figures.filter((row) => row.consistent !== "是").map((row) => row.shot).join("、")}`;
      const two = !figures.length
        ? "—"
        : [summary.release === production ? "同正式站 release" : "release 不同", desk.length ? (desk.every((record) => record.ok) ? "旅程在同一 release 走過且通過" : "旅程有失敗") : "旅程未操作此畫面", paired.has(task.id) ? "並排圖已目視" : null].filter(Boolean).join("；");
      const three = !figures.length
        ? "無標號圖"
        : [marks ? `作者 qa_marks：壓字 ${marks.flagged?.length ?? 0}、被裁 ${marks.cutOff?.length ?? 0}、重疊 ${marks.overlapping?.length ?? 0}（全書）` : null, "驗收方看過全部頁面總覽", pages.some((page) => reviewed.has(page)) ? `放大抽查 p.${pages.filter((page) => reviewed.has(page)).join("、")}` : null].filter(Boolean).join("；");
      const four = desk.length
        ? `${desk.every((record) => record.ok) ? "通過" : "失敗"} ${desk.filter((record) => record.ok).length}/${desk.length}${recoveries ? `（含 ${recoveries} 個錯誤與復原）` : ""}`
        : book.length
          ? "不需操作系統（講義作答）"
          : "未涵蓋";
      const five = expectSteps.length
        ? `${expectSteps.every((record) => record.ok) ? "相符" : "不符"}（逐字對照講義 EXPECTED，#${expectSteps.map((record) => record.n ?? "-").join("、#")}）`
        : desk.length
          ? `步驟檢查通過，沒有逐字比對 EXPECTED`
          : "—";
      const workbook = book.filter((record) => /寫下/.test(record.does));
      const six = workbook.length ? (workbook.every((record) => record.ok) ? "完成" : "未完成") : "—";
      taskRows.push({ task: task.id, pages: pages.join(", ") || "—", figures: figures.length, one, two, three, four, five, six });
    }
  }
}
const taskHeader = "| 講義頁面 | 任務 | 截圖 | ① 可追溯 | ② 與新介面一致 | ③ 標號／箭頭 | ④ 步驟可完成 | ⑤ 預期結果 | 數位版作品 |\n|---|---|---|---|---|---|---|---|---|";
const taskLines = taskRows.map((row) => `| ${row.pages} | ${row.task} | ${row.figures} | ${row.one} | ${row.two} | ${row.three} | ${row.four} | ${row.five} | ${row.six} |`);
const header = "| 講義頁面 | 任務 | 對應功能 | 截圖 | 系統版本 | 擷取時間（UTC） | 畫面／時鐘 | ① 可追溯（同 release＋擷取通過＋檔案存在） | 操作可完成 | 問題 |\n|---|---|---|---|---|---|---|---|---|---|";
const lines = rows.map((row) => `| ${row.pages} | ${row.task} | ${row.feature} | ${row.shot} | ${row.release} | ${row.takenAt.replace("T", " ").slice(0, 19)} | ${row.url} ${row.clock ?? ""} | ${row.consistent} | ${row.operable} | ${row.problems.replace(/\|/g, "／")} |`);
writeFileSync(out, `## 每個任務的五項檢查\n\n${taskHeader}\n${taskLines.join("\n")}\n\n## 每張截圖的來源（只證明可追溯，不代表一致）\n\n${header}\n${lines.join("\n")}\n`);
console.log(JSON.stringify({ tasks: taskRows.length, figures: rows.length, traceable: rows.filter((row) => row.consistent === "是").length, unused: rows.filter((row) => row.consistent === "未使用").length, captureRelease: summary.release, production }, null, 2));
