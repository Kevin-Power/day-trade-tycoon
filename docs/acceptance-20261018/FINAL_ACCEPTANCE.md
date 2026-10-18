# 最終驗收：當沖大富翁 Trading Academy 2026.10-r2.3

驗收日期：2026-10-18（UTC）。分工：
- 教材製作：工作階段「當沖大富翁實戰講義製作」；
- 獨立驗收：工作階段「產品畫質提升」；
- 另有 Fable 5.1 唯讀審查（r2.1）與使用者提供的 r2.1 獨立複驗。

全程沒有 push、merge 或 deploy，沒有修改交易核心，也沒有用真實帳戶送單。

## 結論（只在寫明的範圍內）

| 範圍 | 判定 | 理由 |
|---|---|---|
| 學員版 PDF＋數位版，用於**講師在場的小班試讀** | **CONDITIONAL PASS** | 學生走得完：模擬學生從 L01 到期末，139/139 步。作品存得住：用 file:// 開、關閉瀏覽器再打開，桌面與手機尺寸都是 64/64。關鍵畫面和新介面一致（7 組並排）。條件與限制見 §6 |
| 講師版 PDF（螢幕閱讀） | **PASS** | 26 頁、A4、和學員版同一版號；只有版本字串和 r2.2 不同 |
| 正式全面發放、宣告跨平台可用 | **還不能判定** | 真實手機、Safari／Firefox、macOS／Linux 解壓、印刷、真人試讀都**沒有驗證** |

「學生無法完成、作品無法保存、關鍵步驟和新介面不一致」三種會判 FAIL 的情況，這一版**都沒有發生**。

## 1. 版本清單（同一版本）

| 項目 | 值 |
|---|---|
| 教材版號 | **2026.10-r2.3**（PDF 第 1、2、94 頁與數位版都有標示） |
| 應用程式 release | `20261018T022941927Z`，由 `a59952e` 建置。GitHub `codex/course-handover` HEAD 是 `d4b4540`，和 `a59952e` 只差一份文件。CSS 不能從乾淨 clone 逐位元組重現，見 UI_VERSION_VERIFICATION §2 |
| 截圖來源 | 正式站同一個 release；擷取時間 05:01:41Z → 05:13:08Z；檢查 139/139；88 張。r2.3 沒有重新擷取 |
| 教材原始檔 | `SOURCE_MANIFEST`（06:48:29Z）：139 個檔，樹雜湊 `9F641A38…26277`；驗收方重算全部相符。r2.2 → r2.3 改了：<br>• `content/course.mjs`（只有版本字串）<br>• `design/web.js`（只有 `validate()`）<br>• `build/qa_web.mjs`、`build/manifest.mjs`、README、CHANGELOG<br>• 新增 `build/package.py` |
| 學員版 PDF | `當沖大富翁-學員實戰闖關手冊-2026.10-r2.3.pdf`：06:45:46Z，19,492,997 bytes，SHA-256 `344B8D0D9AA4CF9864DFC138957FAC5C9CC7EFF296BE801323E365DE4ABD47FA` |
| 講師版 PDF | `當沖大富翁-講師版教學手冊-2026.10-r2.3.pdf`：06:45:49Z，1,031,948 bytes，SHA-256 `56406D8917B8F4890166C3A6D483711CED774E1637129F9B91523E9BB13EEAD1` |
| 數位互動版 ZIP | `當沖大富翁-數位互動版-2026.10-r2.3.zip`：06:48:08Z，20,164,508 bytes，SHA-256 `DBC72DE4503813A9FACF6F7343D4DA28CD1574AEF707B4E7137674482F916562`。內含 77 個檔，樹雜湊 `C1B67F4C…277C16` |
| 驗收快照 | 06:49:38Z。三個 SHA-256 由驗收方自己重算，和製作方回報相同 |

**r2.2 → r2.3 驗收方另外比對**
- 兩本 PDF 的頁數、圖片位元組、內部連結（148 個）都相同，文字只有版本字串不同（`pdf-r22-vs-r23-acceptance.json`）。
- 所以 r2.2 上做過的畫面一致性、模擬學生旅程、PDF 版面與數位版版面檢查，都適用於 r2.3。

## 2. 兩項修正的證據

**R21-01 ZIP 路徑（P1）**

| | r2.1 | r2.3 |
|---|---|---|
| 原始成員名稱（`ZipInfo.orig_filename`）含反斜線 | 76／77 | **0／77**；絕對路徑 0、`..` 0、CRC 正常 |
| Windows：PowerShell 5.1 `Expand-Archive` 解到全新目錄 | — | 77 個檔，樹雜湊和 `output/web` 相同 |
| POSIX 工具：Info-ZIP UnZip 6.00（MSYS）解到全新目錄 | — | 77 個檔，樹雜湊相同 |
| 用 file:// 開兩個解壓目錄 | — | 兩邊結果相同，全部可用：<br>• 入口與 CSS 已套用，JS 已載入<br>• 51 個畫面、123 張圖（66 張不重複）都沒有壞圖<br>• 7 個字型都已載入<br>• 75 個資產引用都找得到，0 個載入失敗<br>• 205 個頁內連結都沒有斷鏈 |

製作方的 `build/package.py` 打包後會自動檢查成員名稱；用它檢查 r2.1 的 ZIP 會被擋下。
**未驗證**：在真的 Linux、macOS、iPhone、Android 上解壓與開啟。MSYS 的 unzip 是 POSIX 工具，但跑在 Windows 上，不能代替這些環境。

**R21-02 匯入格式（P1）**：同一組 11 個檔案，在學生已有作品（185 欄、83 個勾選）的狀態下匯入。

| 檔案 | r2.2 | r2.3 |
|---|---|---|
| 不是 JSON、下載中斷的半個檔、別的程式的 JSON（錯誤 schema）、不支援的版本 | 拒絕 | 拒絕 |
| `{}`、`{"hello":"world"}`、容器型別錯誤 | **進入取代確認**（修正前） | **在確認之前就拒絕**：「匯入失敗…目前的紀錄沒有被更動」 |
| 有效 v2、合法空白 v2、有效 v1、合法空白 v1（`{"checks":{},"notes":{}}`） | 進入確認 | 進入確認，按取消後紀錄不變 |

**既有資料沒有被破壞**
- 用 r2.2 學生自己的瀏覽器設定檔打開 r2.3：185 欄、83 個勾選，0 遺失。
- 舊版（r1）留在瀏覽器裡的紀錄，打開 r2.3 會自動轉換，畫面有提示，舊資料保留不刪（`upgrade-check-r23.json`）。
- 製作方 qa_web 的匯入格式情境（11 個檔）：通過。

## 3. 真實保存測試（最終 ZIP，用 Expand-Archive 解壓後以 file:// 開啟）

流程：
1. 同一位模擬學生寫入在系統上實際看到的作品：報價、委託與成交、風險表、決策日誌、復盤、期末三份作業，共 185 欄；
2. 看到「已保存」；
3. 關閉整個瀏覽器，再打開；
4. 作品都在；
5. 寫完最後一句立刻關閉，再打開；
6. 匯出；
7. 匯入上面 11 個檔案；
8. 換一個全新的瀏覽器設定檔，匯入還原。

| 環境 | 結果 |
|---|---|
| **桌面**：Windows 11、Google Chrome 155（Playwright 驅動、headless、持久設定檔）、1440×900 | **64/64**（`save-r23-desktop/`） |
| **手機尺寸**：同一個 Chrome 的裝置模擬（390×844、DPR 3、觸控） | **64/64**（`save-r23-mobile/`）。**這不是真實手機** |
| 真實 iPhone／Android、Safari、Firefox、Edge、由真人操作的有介面 Chrome、用網站方式提供 | **未驗證** |

## 4. 必要回歸（r2.3）

數位版回歸：12/13。

| 情境 | 結果 |
|---|---|
| Level 06 只選一個習慣，06-4 答否／不適用並寫原因 → 本關完成 | 通過 |
| 期末 F-3／F-4／F-5：填寫、重整、匯出、在新瀏覽器匯入（先確認） | 通過 |
| 最新輸入、保存失敗、損毀紀錄、繼續上次學習 | 通過 |
| 圖片縮放 | 桌機滑鼠拖曳：通過。手機 390：放大 ×3.72、手指拖曳、還原、鍵盤都正常；**但「適合螢幕」時貼邊的 4 個標號往內偏最多 4.9px（標準 0.5%），判定不通過**。放大到 100% 時都準確。這是製作方為了不切掉標號做的取捨（B-32），r2.2 也一樣 |
| 手機目錄（390、360，觸控） | 通過 |
| 術語連結、預設留白 | 通過 |
| 成果冊與成就感（課前小任務、能力卡、成果冊） | 通過 |

**系統上的模擬學生流程**（journey-r22c，在正式 release 上執行）：
- 139/139 步；
- 每筆成交都從畫面讀取，並和已發布的行情檔比對；
- 04-3 的兩種超賣情境都被擋下，也沒有送出委託；
- F-1 照講義按「返回修改」，處理了重試後殘留的確認卡（B-07）。

r2.3 的講義內容和 r2.2 只差版本字串，所以這份結果適用於 r2.3。詳細在 STUDENT_JOURNEY_TEST.md。

## 5. 關鍵畫面對照

`artifacts/交付-2026.10-r2.3/關鍵畫面對照/` 有 7 組講義 r2.3 頁面和系統畫面的並排：新版大廳、等級進度、完成卡、下單確認、復盤完成卡、復盤四份紀錄、期末報告。

逐張比對的結論在 WORKBOOK_SCREENSHOT_AUDIT.md；同一份檔案也列出 39 個任務各自的五項檢查。我們不因為 metadata 寫了 release ID，就宣稱和正式站一致。

## 6. 試讀前的條件與剩餘未驗證

**是否適合學生試用：適合講師在場的小班試讀（2–3 位初學者）。** 條件：
1. 上課用桌機的 Chrome。手機只當閱讀講義的輔助，因為實機沒有驗證過。
2. 期末任務前，講師口頭提醒：按「重試這次操作」後，舊的確認卡如果還在，就按「返回修改」。B-07 的系統修正 `b198bce` 還沒部署。
3. 每次下課前請學生匯出備份檔。
4. 試讀時記錄：
   - 找不找得到按鈕；
   - 看不看得清楚圖片；
   - 需要幾次提示；
   - 能不能找回自己的作品；
   - 課前小任務花了幾分鐘。

成功與否不看模擬損益。

**未驗證**
- 真人學習體驗；「5 分鐘」是設計目標，沒有被證實。
- 真實手機。
- Safari／Firefox／Edge。
- macOS／Linux 解壓。
- 實際印刷與列印成果冊的頁邊界。

**已知限制**

| 編號 | 內容 |
|---|---|
| B-07 | 系統尚未部署修正 |
| B-32 | 「適合螢幕」時標號偏內 |
| B-23 | 正式站 CSS 不能逐位元組重現；受測畫面沒有看到影響；本輪照指示不重新部署 |
| B-24 | 教材原始檔還沒提交到分支，目前靠 SOURCE_MANIFEST 識別 |
| 獨立複驗的非阻塞觀察（未修改） | F-5 可以同時保留成交列又勾「沒有成交」 |
| CHANGELOG 已列 | 版面留白、全畫面縮圖字小、9 頁截圖低於 200 dpi |

## 7. 證據索引

| 證據 | 位置 |
|---|---|
| 交付成品（可直接開啟） | `artifacts/交付-2026.10-r2.3/成品/` |
| 版本與來源清單 | `artifacts/交付-2026.10-r2.3/版本與來源/SOURCE_MANIFEST.{md,json}` |
| 關鍵畫面並排 | `artifacts/交付-2026.10-r2.3/關鍵畫面對照/` |
| 驗收快照 | `artifacts/acceptance-20261018/r23-snapshot/`（唯讀複本） |
| ZIP 成員名稱 | `zip-names-r23.json` |
| ZIP 開箱檢查 | `zip-open-r23-expand.json`、`zip-open-r23-unzip.json` |
| PDF r2.2 對 r2.3 | `pdf-r22-vs-r23-acceptance.json` |
| 保存與匯入（桌面、手機尺寸） | `save-r23-desktop/`、`save-r23-mobile/`（`journey.json`、`environment.json`、截圖）；修正前：`save-r22-desktop/`、`save-r22-mobile/` |
| 既有資料升級 | `upgrade-check-r23.json` |
| 數位版回歸 | `web-regression-r23/`、`web-regression-r23.log` |
| 系統上的模擬學生流程 | `journey-r22c/`（139 步，每步操作前後截圖，含 `evidence-*.png`） |
| 版面掃描（r2.2，510 組合全部 0） | `visual-r22/`、`visual-r22-sheets/` |
| PDF 逐頁 | `r22-pdf-student/`、`r22-pdf-teacher/`、`r23-pdf-student/`、`r22-zoom/` |
| Fable 5.1 審查（r2.1） | `fable-review/FABLE_REVIEW.md` |
| 建置差異原始清單 | `docs/acceptance-20261018/evidence/build-compare-*.txt` |

除了標明在 `docs/` 或 `artifacts/交付-2026.10-r2.3/` 的，上表路徑都在 `artifacts/acceptance-20261018/` 底下。

**分項報告**（同一資料夾）：
- UI_VERSION_VERIFICATION.md：版本與建置差異
- STUDENT_JOURNEY_TEST.md：模擬學生流程，含每一輪的失敗與分類
- VISUAL_QA_REPORT.md：視覺
- BUG_FIX_REPORT.md：缺陷、分類、測試腳本缺陷
- WORKBOOK_SCREENSHOT_AUDIT.md：逐任務五項檢查

**重跑方式**：都在 `.worktrees/workbook`，分支 `claude/workbook-revision`。

```
node qa/acceptance/zip_open_check.mjs <新解壓的資料夾> <輸出.json>
node qa/acceptance/journey.mjs --replay <journey.json> --content <快照>/content --web <新解壓的資料夾> --file [--mobile] --port-web 18887 --out <輸出>
node qa/acceptance/web_regression.mjs <新解壓的資料夾> <輸出>
node qa/acceptance/journey.mjs --content <快照>/content --web <新解壓的資料夾> --out <輸出>
```

第 4 行是完整的系統旅程，會開一間拋棄式教室。
