# 當沖大富翁 Trading Academy · 學員實戰闖關手冊（教材原始檔）

這個資料夾是講義的**可維護原始檔**：文字、截圖、設計樣式、擷取腳本與輸出腳本都在這裡。系統畫面更新後，照「重新製作」四個步驟跑一次，截圖、頁碼與 PDF 會一起更新。

## 交付物

| 檔案 | 說明 |
|---|---|
| `output/當沖大富翁-學員實戰闖關手冊.pdf` | 學員版（A4 直式）：封面、目錄、學習地圖、六關、期末任務、完成清單、術語表、心得紀錄 |
| `output/當沖大富翁-講師版教學手冊.pdf` | 講師版：課綱對照、授課節奏、每關操作答案與常見錯誤、期末評分規準與參考紀錄、附錄（**請勿發給學員**） |
| `output/web/` | 數位互動版（`index.html` + `assets/`）：手機與桌機閱讀、放大截圖、勾選完成項目（勾選只存在該瀏覽器） |
| `verification/` | 驗收紀錄：Playwright 逐關檢查、PDF 品質檢查、製作報告 |

## 資料夾結構

```
content/        講義文字（每關一個檔案；course.mjs 是全書共用設定、術語表；teacher.mjs 是講師版內容）
capture/        Playwright 擷取：以全新學員走完全部關卡、逐步檢查畫面、擷取截圖與元素座標
assets/shots/   講義使用的真實截圖（PNG）與 shots.json（每張圖上各元素的位置，用來畫標號與框線）
design/         print.css（A4 印刷）、teacher.css（講師版）、web.css／web.js（數位互動版）
build/          render.mjs（產生 HTML）、pdf.mjs（列印 PDF＋溢版檢查）、build.mjs（一鍵輸出）
                fonts.py（字型子集）、shots.py（整理截圖）、qa_pdf.py（PDF 品質檢查）、reference.mjs（講師版答案資料）
output/         產生的 HTML／PDF／數位版（可隨時重建）
```

## 重新製作（系統更新後）

需要：Node 24、本專案 `node_modules`（Playwright）、Python 3 與 `fonttools`、`brotli`、`Pillow`、`PyMuPDF`。

```powershell
# 1. 重新擷取：自動啟動「暫存教室」（臨時資料庫、只綁 127.0.0.1），全新學員走完全部關卡並逐步檢查
node courseware/academy/capture/run.mjs
#    預設使用教室主機目前上線的 release（讀 hosting.json，唯讀）；也可指定：
#    node courseware/academy/capture/run.mjs --app-entry <release>/server/index.mjs

# 2. 整理截圖到 assets/shots（同時保存擷取摘要、操作紀錄與檢查結果）
python courseware/academy/build/shots.py --raw courseware/academy/.cache/capture/raw --manifest courseware/academy/.cache/capture/shots.json --out courseware/academy/assets/shots

# 3. 輸出學員版、講師版 PDF 與數位互動版（任何一頁溢出版面就停止並列出頁碼）
node courseware/academy/build/build.mjs --python <有 fontTools 的 python>

# 4. PDF 品質檢查（A4、字型嵌入、文字可搜尋、截圖 ≥150 dpi、頁面預覽）
python courseware/academy/build/qa_pdf.py "courseware/academy/output/當沖大富翁-學員實戰闖關手冊.pdf" --out courseware/academy/output/qa/student
python courseware/academy/build/qa_pdf.py "courseware/academy/output/當沖大富翁-講師版教學手冊.pdf" --out courseware/academy/output/qa/teacher

# 5. 學員版不得出現期末參考答案（講師版專用字句只能出現在講師版）
python courseware/academy/build/qa_leak.py "courseware/academy/output/當沖大富翁-學員實戰闖關手冊.pdf" "courseware/academy/output/當沖大富翁-講師版教學手冊.pdf" --out courseware/academy/output/qa

# 6. 數位互動版：375／390／768／1280 寬度的溢出、破圖、翻頁、放大圖、勾選保存
node courseware/academy/build/qa_web.mjs courseware/academy/output/web/index.html courseware/academy/output/qa/web

# 7. 產生驗收紀錄 verification/ACCEPTANCE.md（只寫上面各步驟的實際結果）
node courseware/academy/build/report.mjs
```

擷取腳本只會連到本機暫存教室，**不會**連線正式站、不會動到正式資料，也不會開啟券商功能。

## 修改講義文字

- 每關的文字在 `content/l01.mjs` … `content/final.mjs`；每個任務都有固定十個部分：`goal`、`why`、`prep`、`figures`、`steps`、`expect`、`trouble`、`checks`、`think`、`next`。
- 標記：`「介面文字」`會變成灰框按鈕樣式（只用在畫面上真的出現的字）；非介面的引號用 `『』`；`**粗體**`；`` `09:20` `` 數字等寬。
- 截圖標號：`marks: [{ n: 1, target: "code", pos: "l" }]`，`target` 是 `shots.json` 裡該圖的元素名稱（由擷取腳本記錄），`pos` 是標號位置（tl/tr/bl/br/l/r/t/b/c/il/ir 或 `[x, y]` 偏移）。標號數字要對應「逐步操作」的步驟編號。
- 標號不可以壓住畫面文字：元素貼著截圖左緣時，加 `gutter: 像素`（在截圖左側加一條留白欄）並用 `pos: "gl"`，標號會放在留白欄、與元素同高；右側用 `gutterRight` 與 `"gr"`。留白寬度約為「標號直徑換算成截圖像素」再加一點：整頁寬（176 mm）約 `0.04 × 截圖寬`，半頁寬約 `0.08 × 截圖寬`。
- 細長截圖（快訊列、狀態列）不要拉成整頁寬：用 `width` 縮回原比例，`qa_pdf.py` 會擋下低於 150 dpi 的截圖。
- 系統按鈕文字改了：擷取腳本的檢查會失敗並指出哪一步，先改 `capture/capture.mjs` 的選擇器與 `content/` 的文字，再重新擷取。

## 設計原則

- 印刷版每頁都是固定 A4 版面；`pdf.mjs` 檢查每一頁是否溢出，溢出就不輸出 PDF。
- 字型：Noto Sans TC（四個靜態字重，依講義實際用字做子集）＋ IBM Plex Mono（數字）。使用靜態字重是為了讓 PDF 以標準 CID TrueType 嵌入；可變字型會被 Chrome 嵌成大量 Type 3 字型。
- 內頁以白底為主，只有封面與真實截圖是深色，降低印刷成本。
- 截圖全部是系統實際畫面；標號與框線是向量疊加，位置來自擷取時記錄的元素座標。

## 已知限制

- 教材只有 2026/10/05、10/06 兩個交易日；系統更新教材日期後，L03–L04 的時間點（09:20、09:37）需要依新資料重寫。
- 講師工作台目前看不到真實早盤的復盤；講義以學員畫面與紙本紀錄為準。
- 數位互動版的勾選只存在該瀏覽器的 localStorage，不會上傳。
