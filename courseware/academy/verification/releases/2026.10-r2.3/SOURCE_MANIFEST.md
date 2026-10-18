# 來源識別與交付紀錄 · 2026.10-r2.3

> 由 `build/manifest.mjs` 產生（2026-10-18T06:48:29.002Z）。courseware 沒有進 git，以每個來源檔的 SHA-256 識別版本；完整清單在 `SOURCE_MANIFEST.json`。

## 成品（驗收請只用這幾個檔）

| 檔案 | 大小 | 修改時間（UTC） | SHA-256 |
|---|---|---|---|
| `output/drive-upload/當沖大富翁-學員實戰闖關手冊-2026.10-r2.3.pdf` | 18.6 MB | 2026-10-18T06:45:46Z | `344B8D0D9AA4CF9864DFC138957FAC5C9CC7EFF296BE801323E365DE4ABD47FA` |
| `output/drive-upload/當沖大富翁-數位互動版-2026.10-r2.3.zip` | 19.2 MB | 2026-10-18T06:48:08Z | `DBC72DE4503813A9FACF6F7343D4DA28CD1574AEF707B4E7137674482F916562` |
| `output/drive-upload/當沖大富翁-講師版教學手冊-2026.10-r2.3.pdf` | 1.0 MB | 2026-10-18T06:45:49Z | `56406D8917B8F4890166C3A6D483711CED774E1637129F9B91523E9BB13EEAD1` |

建置產物（交付檔由這些檔複製或壓縮而成）：

| 產物 | 修改時間（UTC） | SHA-256 |
|---|---|---|
| 學員版 PDF（`output/當沖大富翁-學員實戰闖關手冊.pdf`） | 2026-10-18T06:45:46Z | `344B8D0D9AA4CF9864DFC138957FAC5C9CC7EFF296BE801323E365DE4ABD47FA` |
| 講師版 PDF（`output/當沖大富翁-講師版教學手冊.pdf`） | 2026-10-18T06:45:49Z | `56406D8917B8F4890166C3A6D483711CED774E1637129F9B91523E9BB13EEAD1` |
| 數位版 index.html（`output/web/index.html`） | 2026-10-18T06:45:40Z | `09DBEEFDF5219C5C71332CAB1A4C8D8258BE4624060ED1BF01E188E6963FFF9A` |
| 數位版 web.js（`output/web/assets/web.js`） | 2026-10-18T06:40:46Z | `98CA251263CC1E8AFE7B1C4221321D9EAB910659EEB8F8443384FDBB8E8ED61C` |
| 數位版整個資料夾（77 個檔，`output/web/`） | — | 樹雜湊 `C1B67F4CFF760ABAC58846D4BE9F57F2A5B1A726A8F070CBF1637B2701277C16` |

## 來源

- 教材原始檔：`courseware/academy/` 的 139 個檔（content、build、capture、design、assets/shots 含 shots.json 與 capture-*.json、README、CHANGELOG、.gitignore）。樹雜湊（「SHA-256␣␣路徑」逐行串接後再取 SHA-256）：`9F641A389664EFD1B63757213073A73B94102E02A272A232A015498182526277`。
- 建置時讀取的系統檔（教學五檔、報價摘要、快訊、費用函式與教材行情）：工作區 commit `e069fe213c3db23938c49ac81c1ba36e00cdb55c`
  - `src/lib/morning-quote.ts` `CA9FACBB8063981A2FD94DEB347506AF327DF10565AC175E52B160D441E3E12F`
  - `src/lib/morning-book.ts` `69C11C2BD2688D3AEFBC3E0631F8AFCD497FBE3F9334E08006E8A4FD34DF1091`
  - `src/lib/morning-alerts.ts` `ACBEEACA805909538FA514AA56F5801379BB6F4732BEC903957D65BCB0E8F056`
  - `src/lib/market/ticks.ts` `7F259B3537808C7E15CFE8C66AC753C65CD729E057BF9F725220CB4E1F2C237C`
  - `server/data/morning-2026-10-05.json` `8B2F03A01C6212E2FBF9849863C3DF19967B0C17B41064874BA85C84F924251C`
  - `server/data/morning-2026-10-06.json` `71B5294B2F484708E7506506688195EEB0E07C346D68C2FEB9FE22797DF4490A`
- 截圖擷取：release `20261018T022941927Z`，2026-10-18T05:01:41.838Z → 2026-10-18T05:13:08.414Z；139/139 項檢查通過、88 張畫面、停滯 0 次。
- 工具：Node v24.15.0、Google Chrome 155.0.8059.80（Playwright 驅動）。

## 建置指令

```
node courseware/academy/capture/run.mjs
python courseware/academy/build/shots.py --raw courseware/academy/.cache/capture/raw --manifest courseware/academy/.cache/capture/shots.json --out courseware/academy/assets/shots
node courseware/academy/build/build.mjs --python <python with fontTools, brotli>
python courseware/academy/build/qa_pdf.py <student pdf> --out courseware/academy/output/qa/student …
python courseware/academy/build/qa_pdf.py <teacher pdf> --out courseware/academy/output/qa/teacher …
python courseware/academy/build/qa_leak.py <student pdf> <teacher pdf> --out courseware/academy/output/qa
node courseware/academy/build/qa_web.mjs courseware/academy/output/web/index.html courseware/academy/output/qa/web
node courseware/academy/build/qa_before_after.mjs courseware/academy/.cache/review-baseline/web/index.html courseware/academy/output/web/index.html courseware/academy/verification/revision-2/evidence
node courseware/academy/build/report.mjs
node courseware/academy/build/qa_marks.mjs --python <python with Pillow>
python courseware/academy/build/package.py 2026.10-r2.3
node courseware/academy/build/manifest.mjs 2026.10-r2.3
```

## 本版的檢查結果

- 擷取：139/139
- 學員版 PDF：94 頁、0 個問題、截圖最低 175 dpi
- 講師版 PDF：26 頁、0 個問題
- 期末答案外洩檢查：通過（7 個字句）
- 數位版回歸測試：120/120（2026-10-18T06:47:58.351Z）
- 修正前後對照：10/10 已修正（2026-10-18T06:47:06.473Z）
- 數位版 ZIP 成員名稱（`build/package.py`）：當沖大富翁-數位互動版-2026.10-r2.3.zip：77 個成員；反斜線 0、絕對路徑 0、「..」0（通過）
- 截圖標號：256 個（紙本 141、手機 390 寬 115；手機總覽圖 57 個不計壓字）；壓字 0、裁掉 0、重疊 0；例外 plan-observe.png|6（2 次）、courses.png|2（2 次）

## 核對完成卡文字與 04-3 賣出張數的擷取檢查

- ✓ [L02] 保存後出現完成卡
- ✓ [L02] 完成卡列出「寫下自己的計畫」與「完成這一輪復盤」
- ✓ [L02] 完成卡顯示練習分（當天第一輪）
- ✓ [L04] 04-3：買進時可以設成 2 張
- ✓ [L04] 04-3：切到「賣出」後，張數自動變成可賣出庫存 1 張
- ✓ [L04] 04-3：賣出時「增加一張」是灰色（不能超過庫存）
- ✓ [L04] 04-3：張數等於庫存時沒有「賣出張數超過庫存」訊息
- ✓ [L05-1] 第 2 課：先看到上一輪的完成卡
- ✓ [L05-2] 第 3 課：先看到上一輪的完成卡
- ✓ [L05-3] 第 4 課：先看到上一輪的完成卡
- ✓ [L05-4] 第 5 課：先看到上一輪的完成卡
- ✓ [L05-4] 完成卡：整輪等待也列出「照計畫的股票操作」「收盤前不留倉」
- ✓ [L05-4] 同一天再練：練習分只算最好的一輪
- ✓ [L06] 第 6 課：先看到上一輪的完成卡
- ✓ [FINAL] F-1：換到已練過的 10/05，先出現那一天上一輪的完成卡

## 注意

- `build/manifest.mjs` 只產生這份紀錄，不參與輸出；若它在成品建置之後才加入，雜湊清單仍會列出它。
- 這份紀錄只描述本機產生的檔案與本機執行的檢查；沒有實體手機、Safari、實體列印或真人試教的結果。
