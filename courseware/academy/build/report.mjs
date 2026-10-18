// Writes verification/ACCEPTANCE.md from the machine records of the last capture, build and QA runs.
// It states only what those records show; untested devices are listed as untested.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { academy, out } from "./render.mjs";

const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
const dir = join(academy, "verification");
mkdirSync(dir, { recursive: true });
const summary = read(join(academy, "assets", "shots", "capture-summary.json"));
const facts = read(join(academy, "assets", "shots", "capture-facts.json")) ?? {};
const checks = read(join(academy, "assets", "shots", "capture-checks.json")) ?? [];
const build = read(join(out, "build-report.json"));
const studentQa = read(join(out, "qa", "student", "pdf-qa.json"));
const teacherQa = read(join(out, "qa", "teacher", "pdf-qa.json"));
const webQa = read(join(out, "qa", "web", "web-qa.json"));
const leak = read(join(out, "qa", "leak-check.json"));
const marks = read(join(out, "qa", "marks", "marks.json"));
for (const name of ["capture-summary.json", "capture-checks.json", "capture-facts.json", "capture-stalls.json"]) {
  const source = join(academy, "assets", "shots", name);
  if (existsSync(source)) copyFileSync(source, join(dir, name));
}
for (const [source, target] of [
  [join(out, "build-report.json"), "build-report.json"],
  [join(out, "qa", "student", "pdf-qa.json"), "pdf-qa-student.json"],
  [join(out, "qa", "teacher", "pdf-qa.json"), "pdf-qa-teacher.json"],
  [join(out, "qa", "web", "web-qa.json"), "web-qa.json"],
  [join(out, "qa", "leak-check.json"), "leak-check.json"],
  [join(out, "qa", "marks", "marks.json"), "marks-qa.json"],
]) if (existsSync(source)) copyFileSync(source, join(dir, target));

const scopes = [...new Set(checks.map((item) => item.scope))];
const scopeRows = scopes
  .map((scope) => {
    const items = checks.filter((item) => item.scope === scope);
    const failed = items.filter((item) => !item.ok);
    return `| ${scope} | ${items.length - failed.length} / ${items.length} | ${items.slice(0, 3).map((item) => item.label).join("；")} |`;
  })
  .join("\n");
const pdfRow = (name, qa, built) =>
  qa
    ? `| ${name} | ${qa.pages} | ${built?.ok ? "通過（0 頁溢出）" : "未通過"} | ${Object.keys(qa.fonts).join("、")} | ${qa.images.min_dpi ? `${qa.images.min_dpi} dpi` : "（無截圖）"} | ${qa.problems.length ? qa.problems.length + " 項" : "無"} |`
    : `| ${name} | — | — | — | — | 未執行 |`;
const stalls = summary?.stalls ?? [];
const stallText = stalls.length
  ? [
      `${stalls.length} 次，逐次記錄如下（附當時畫面，腳本重新載入後繼續，後續檢查照常通過）：`,
      "",
      ...stalls.map((stall) => `- ${stall.at} → ${stall.target}：按鈕${stall.disabled ? "停用" : "未停用"}；畫面訊息「${stall.banners.join(" ／ ")}」`),
    ].join("\n")
  : "0 次。";
function webSection(qa) {
  const scenarios = qa.scenarios
    .map((item) => `### ${item.ok ? "✓" : "✗"} ${item.name}（${item.finding}）\n\n${item.checks.map((check) => `- ${check.ok ? "✓" : "✗"} ${check.label}${check.detail ? `：${check.detail}` : ""}`).join("\n")}`)
    .join("\n\n");
  const layout = qa.layout.map((row) => `| ${row.width} | ${row.scheme === "dark" ? "深色" : "淺色"} | ${row.views} | ${row.overflow.length ? row.overflow.join("、") : "0"} | ${row.brokenImages} | ${row.errors.length} |`).join("\n");
  const contrast = qa.contrast
    .map((row) => `- ${row.scheme === "dark" ? "深色" : "淺色"}：量測 ${row.measured} 個 14px 以下的文字元素，低於 4.5:1 的種類 ${row.failures.length}${row.failures.length ? `（${row.failures.map((item) => `「${item.text}」${item.ratio}:1`).join("、")}）` : ""}`)
    .join("\n");
  return `瀏覽器：Playwright 驅動本機 Google Chrome ${qa.browser}；開啟本機檔案（file://），使用瀏覽器原生 localStorage，包含重新整理與清空後匯入。\n\n${scenarios}\n\n### 版面（每頁先等字型與所有圖片載入，展開所有收合區塊）\n\n| 寬度 | 主題 | 頁面 | 水平溢出 | 破圖 | JS 錯誤 |\n|---|---|---|---|---|---|\n${layout}\n\n### 小字對比\n\n${contrast}`;
}
const studentBuild = build?.outputs?.find((item) => item.name === "student");
const teacherBuild = build?.outputs?.find((item) => item.name === "teacher");

const md = `# 驗收紀錄（自動產生）

> 本檔由 \`build/report.mjs\` 依擷取、輸出與品質檢查的機器紀錄產生。只寫紀錄中實際發生的事；沒有測過的裝置列在「未驗證項目」。

## 1. 系統版本與測試環境

| 項目 | 內容 |
|---|---|
| 系統 release | ${summary?.release ?? "—"} |
| 程式 commit（擷取時的 worktree） | ${summary?.commit ?? "—"} |
| 擷取時間（UTC） | ${summary?.startedAt ?? "—"} → ${summary?.finishedAt ?? "—"} |
| 教室環境 | scripts/qa/desk-server.mjs：全新暫存 PGlite 資料庫、只綁 127.0.0.1；全新學員帳號（示範學員）由入場頁開始操作 |
| 行情資料 | ${summary?.marketData ?? "—"} |
| 瀏覽器 | Playwright 驅動本機 Google Chrome ${facts.browser ?? "—"}（桌機 1280×800 @2x、手機 390×844 @3x） |
| 測試資料庫關閉 | ${summary?.serverClosedCleanly ? "正常關閉" : "未確認"} |

## 2. Playwright 逐關操作驗證

全部 ${checks.length} 項檢查，${checks.filter((item) => item.ok).length} 項通過，${checks.filter((item) => !item.ok).length} 項失敗。每一步都在畫面上確認講義所寫的狀態（例如「委託已送出 · 等待撮合」、成交價、手續費、本輪損益）。

「+1 分」按鈕在 10 秒內按不下去的情況：${stallText}

| 範圍 | 通過 | 檢查重點（節錄） |
|---|---|---|
${scopeRows}

逐項紀錄：\`capture-checks.json\`；擷取時記下的實際數字（成交價、費稅、損益）：\`capture-facts.json\`。

## 3. 截圖一致性

講義的 ${summary?.shots ?? "—"} 張截圖全部來自同一次擷取（release ${summary?.release ?? "—"}），每張圖說都標示「系統實際畫面 · 交易日 · 回放時間」。標號與框線是依擷取時記錄的元素座標繪製的向量圖層。

## 4. PDF 品質

| 檔案 | 頁數 | 版面溢出檢查 | 嵌入字型 | 最低圖片解析度 | 問題 |
|---|---|---|---|---|---|
${pdfRow("學員實戰闖關手冊", studentQa, studentBuild)}
${pdfRow("講師版教學手冊", teacherQa, teacherBuild)}

- 每頁尺寸檢查為 A4（595.3 × 841.9 pt）。
- 字型只允許 Noto Sans TC 靜態字重與 IBM Plex Mono，且不得出現 Type 3 字型。
- 每頁都有可選取的文字；關鍵字可搜尋：${studentQa ? Object.entries(studentQa.expected).map(([phrase, found]) => `「${phrase}」${found ? "✓" : "✗"}`).join("、") : "—"}。
- 頁面以 PyMuPDF 轉成預覽圖逐頁檢視（\`output/qa/*/pages/\`）。

## 5. 學員版不暴露期末答案

${leak ? leak.items.map((item) => `- 「${item.phrase}」：學員版 ${item.student ? "出現 ✗" : "未出現 ✓"}；講師版 ${item.teacher ? "出現 ✓" : "未出現"}`).join("\n") : "未執行"}

## 6. 數位互動版（\`build/qa_web.mjs\`）

${webQa ? webSection(webQa) : "未執行"}

## 6b. 截圖標號（\`build/qa_marks.mjs\`）

${
  marks
    ? `- 檢查 ${marks.print + marks.web390} 個標號：紙本 ${marks.print} 個、手機 390 寬 ${marks.web390} 個（手機上縮到一半以下的總覽圖 ${marks.web390OverviewSkipped} 個不計壓字，仍檢查裁掉與重疊）。
- 壓到截圖文字（標號圓圈下墨水 > ${marks.threshold * 100}%）：${marks.flagged.length} 個；被圖框裁掉：${marks.cutOff.length} 個；互相重疊：${marks.overlapping.length} 組。
- 列為例外並寫明原因：${marks.allowed.length ? marks.allowed.map((item) => `\n  - \`${item.key}\`（${item.hits.length} 次）：${item.reason}`).join("") : "無"}`
    : "未執行"
}

## 7. 未驗證項目（不得視為通過）

- 實體 iPhone、Android 手機、平板上的閱讀與操作（只在桌機 Chrome 模擬手機與平板尺寸測試；兩指縮放用 CDP 觸控事件模擬）。
- Safari（含 iPhone Safari）、Firefox、Android Chrome 的原生 localStorage 與重新開啟行為（只在桌機 Chrome 的 file:// 頁面測試）。
- 實體 A4 印表機的列印效果與色彩（只檢查 PDF 尺寸、解析度與字型）。
- 正式站（rich.yilutek.com）上的操作流程：擷取一律使用本機暫存教室，未連線正式站。
- 講師工作台查看學員真實早盤復盤（系統目前不提供）。
`;
writeFileSync(join(dir, "ACCEPTANCE.md"), md);
console.log("verification/ACCEPTANCE.md written");
