# 富邦盤中唯讀整日驗收

2026-10-27 結案：原場 08:55–13:35 自然完成，270 分鐘採樣完整；原始判定 `REVIEW_REQUIRED`，正式本人當日畫面未驗證。詳見 [當日驗收結果](fubon-session-results-2026-10-27.md)。以下準備與歷史驗收紀錄保留。

準備日期：2026-10-24。狀態：**已排程；320 像素大字五檔裁切已修正，正式本人登入、自選報價、五檔及四種尺寸重驗通過。盤中新更新與整日仍待 10/27 驗收。**

使用者授權範圍：自己的台股證券帳戶，富邦自選報價與五檔，驗證盤中新成交、五檔跳動、斷線重連與整日穩定性；正式網站本人登入後畫面另行確認。真實下單持續關閉。國票未啟用。

## 日期、排程與前置條件

- 指定交易日為 **2026-10-27（二），Asia/Taipei**。10/26（一）依 TWSE 年度表補假休市。當日 08:50 仍須查官方臨時休市公告；年度表不能排除颱風等臨時休市。
- Codex 本聊天 heartbeat：`10-27`，名稱「富邦 10/27 盤中唯讀整日驗收」，首次週二 08:50。啟動時改為每 15 分鐘接續；13:35 後保留結果並暫停，不繼續下週空轉。不是 Windows 排程或新聊天。
- 電腦須保持開機、連網、不休眠，Codex app 運行；工作目錄仍可存取。排程延遲或電腦未運作可能漏掉開盤，必須如實標記缺漏。
- 10/24 主機就緒檢查已完成，詳見 `docs/fubon-host-readiness-2026-10-24.md`：一般閒置睡眠與螢幕逾時原為永不，隱藏 `UNATTENDSLEEP` 已由 AC／DC 120 秒改為 0 並讀回確認。08:50 再以 `powercfg /getactivescheme`、`powercfg /qh SCHEME_CURRENT SUB_SLEEP`、`powercfg /query SCHEME_CURRENT SUB_VIDEO` 確認作用計畫與三項逾時未被改回；以 `scripts/hosting/host.ps1 status` 確認服務健康。Windows task 是本人登入觸發且不會喚醒睡眠中的主機，須保持 Windows 本人登入及 Codex 運行；不能只見 task 存在就認定排程會執行。不要把這次準備檢查標成當日定時派送或整日通過。
- 08:55 開始獨立 collector，09:00–13:30 為完整性驗收窗口，13:35 收尾。人工查詢 heartbeat 只追蹤 collector，不能代替連續取樣。
- 先確認既有 collector 的 PID、鎖及 run 目錄，避免同時開第二份。憑證僅沿用本機既有檔案，不顯示內容、不放進聊天、參數、日誌或 Git。
- 檢查正式 release 是否仍為 `20261024T002006781Z`，及來源 SHA 是否符合本次發布基線。若有變更先查明原因；不要把舊收據套到新版本。驗收日期、08:50 heartbeat、08:55 collector 及 13:35 收尾均未變更。

## 驗收範圍與判定

| 項目 | 證據與判定 |
| --- | --- |
| 三檔實際來源 | 2330、2317、6488；各自的 trades、books 重新訂閱 ACK 與當日來源時間 |
| 新成交 | 僅 WS `event=data`、非試撮、有效且畫面資料存放層採用的交易；時間／序號前進，排除重複與亂序 |
| 五檔跳動 | 僅 WS `event=data`、有效完整五檔及新的來源時間；內存比較價量內容真的變化，排除同影像重送 |
| 快照與心跳 | WS snapshot、REST snapshot、heartbeat 分開計數，不作新成交或五檔跳動證據 |
| 整日覆蓋 | 保存每分鐘的秒級取樣覆蓋、事件數、訂閱／連線狀態、來源時間、延遲、過期及異常數；不得用平均值掩蓋缺口 |
| 程序與時鐘 | 起迄、單一 run、單調時鐘與壁鐘差、最長取樣間隔及來源檔案 SHA；晚啟動、提早結束、休眠或缺分鐘不能給整日通過 |
| 斷線恢復 | 10:30 僅斷此 collector 自己的 verification socket 一次，記錄舊／新世代、兩通道 ACK 與各股新資料恢復；不能只看 connected |
| 自然故障 | 和注入中斷分開統計，保留原因、持續時間及結果；不可清空錯誤、覆寫或重啟以消除失敗 |
| 收盤時段 | 保留 13:25–13:30 覆蓋；集合競價期間沒有新成交不直接當成連線故障。盤中暫緩／停牌或漲跌停亦需人工解讀 |
| 正式 UI | 獨立紀錄本人登入後的正式網址操作與畫面，不能用 probe 或隔離假帳號代替 |

collector 的固定門檻會保存在每個 run manifest；不因結果不好而放寬。無成交／五檔長時間未變可導致需要檢查，不能逕稱網路故障。此次為三檔指定來源的觀測品質驗收，**不能證明全市場、每筆成交零遺漏、正式服務全日或瀏覽器全日無故障**。

## 正式網站本人畫面

入口：https://rich.yilutek.com/morning?feed=fubon 。只用外部 Chrome；不可用才 Edge，禁止 iab。

2026-10-24 初次檢查只有教室入場成功，行情仍要求個人帳號登入；保留 `artifacts/fubon-owner-ui-login-check-2026-10-24.json` 的未通過紀錄。本人後續自行登入後，已經由正式 `/morning` 的「富邦唯讀行情」入口成功取得行情。未匯出 cookie/token、建立代用帳號、重設密碼或繞過權限。

當日首次正式本人驗收收據為 `artifacts/fubon-owner-ui-2026-10-24.json`，歷史結果 `PARTIAL_PASS_DISPLAY_DEFECT`：

- 本人權限與真實行情讀取通過，台積電 2330、鴻海 2317、聯發科 2454 及暫時加入的上櫃環球晶 6488 均有報價及完整五檔，切換商品會更換對應委託簿。
- 資料時間皆為 10/22 13:30:00，正確標示收盤、舊資料及非即時。週六的這次驗收沒有盤中新成交或五檔跳動證據。
- 桌面 1366×900、平板 820×900、手機 375×812、大字 320×700 均無整頁水平溢出；但 **320 大字模式五檔表格寬 309px、容器內容寬 291px，最右委賣量被容器裁切約 17px**。不得用整頁沒有溢出作為五檔欄位完整可見的證據。此缺陷代碼 `FUBON_SENIOR_BOOK_CLIP`，在首次檢查時尚未修正／換版，後續修正如下。
- 證據圖：`artifacts/fubon-owner-desktop-2026-10-24.png`、`artifacts/fubon-owner-tpex-2026-10-24.png`、`artifacts/fubon-owner-phone-book-2026-10-24.png`、`artifacts/fubon-owner-senior-book-2026-10-24.png`。大字頂部另有 `fubon-owner-senior-ready-2026-10-24.png`。
- 已移除本次暫加的 6488，恢復原本 2330／2317／2454、台積電選取、標準字級並清除 Chrome 尺寸覆寫；正式行情分頁保留。未送任何實際或測試委託。
- 首次檢查時正式 release 仍為 `20261022T230320858Z`，07:52 的完整檔案雜湊與基線一致，07:55 再確認 entry 未變；編譯下單路由仍固定 501／`LIVE_LOCKED`。歷史預檢收據 `artifacts/fubon-owner-ui-preflight-2026-10-24.json`。

2026-10-24 08:20 後修正發布：正式版本 `20261024T002006781Z`。五檔窄版縮小欄距、維持大字數字 22px；獨立可聚焦捲動區保護超長價量，不隱藏委賣欄、不省略數字。正式本人四尺寸與 2330／2317／2454／6488 切換重驗通過，320 大字五檔寬 291px、右緣 302px，在面板右緣 303px 內，沒有欄內溢出。新 UI 收據為 `artifacts/fubon-fixed-final-ui-complete-2026-10-24.json`；仍為 10/22 收盤資料，不能代替 10/27 盤中驗收。

中間版 `20261024T001419062Z` 的 UI 通過，但實際行情啟動後發現 Python 自動新增 `__pycache__`，未通過不可變 release 核對；完整保留 `artifacts/fubon-layout-manifest-failure-2026-10-24.json` 與中間版，未刪除檔案改寫結果。最終版子程序禁止 bytecode 寫入，並重做備份、發布與實際行情啟動後的檔案核對。詳細紀錄見 `docs/fubon-layout-release-2026-10-24.md`。

**10/27 必須使用新版基線參數，不使用腳本為相容歷史而保留的舊預設。** 新 sealed baseline：`artifacts/fubon-layout-baseline-2026-10-24.json`，檔案 SHA256 `dda6a8c888e90528ef455122186f902b3b68fcf04ee3b7cea774c18afabd32ba`。315 個 manifest 檔案加 manifest 本身共 316 檔，公開 assets 158/158 SHA 相符；本人 UI 啟動 worker 後完整 tree 再驗不變，沒有 pycache。前後收據：`artifacts/fubon-layout-preflight-2026-10-24.json`、`artifacts/fubon-layout-final-post-ui-2026-10-24.json`。collector 的最新離線準備收據：`artifacts/fubon-layout-collector-dryrun-2026-10-24.json`；工作區／正式 worker 完全相同，均包含 `sourceEvent` 觀測欄位。

開盤後須重新驗證本人有效 session、新行情及下列項目；上述休市驗收不取代當日驗收。

開盤後約 09:05、重連測試後約 10:35、收盤前約 13:20 及收尾時確認：

1. 登入後確實看到「富邦盤中行情／唯讀」工作區與三檔自選，不是教室入場或隔離 localhost。
2. 觀察一段連續畫面，記錄成交時間前進、價量變化、五檔時間與切換股票後的正確商品。成交價格未變但時間／成交序號前進仍可能有新成交，不用紅綠閃爍次數代表完整成交數。
3. 保存資料時間、連線狀態與舊資料警示的對應關係。背景分頁後返回應恢復讀取，不能沿用舊資料卻標成最新；背景時主動暫停輪詢是目前設計。
4. 桌面 1366×900、平板 820×900、手機 375×812、320×700 大字，確認報價、五檔、資料時間、可操作區域、整頁水平溢出。結束清除外部 Chrome 尺寸覆寫，恢復原文字大小和原自選清單。
5. 截圖保留行情區及必要狀態，避免帶出帳號或其他不必要個人資料。實際正式本人 UI 結果另列 `authenticatedProductionUi` 與時間、來源網址；未登入就維持待驗。

不送出委託測試下單封鎖。以既有封鎖程式、離線測試與正式版本指紋佐證，確認 UI 沒有真實送單入口。這次 collector 完全不導入交易 adapter。

## 發布前已完成的準備檢查（歷史）

- heartbeat 已建立並由 app view 確認；Windows 時區 Taipei Standard Time。
- `verify-fubon-preflight.mjs` 通過：正式健康 200、匿名行情 403、私有 worker 網址 404；保存完整 release 檔案 SHA 清單及 tree SHA。基線是 `artifacts/fubon-session-preflight-full-2026-10-24.json`，加上指定 release 與基線比對後的通過收據為 `artifacts/fubon-session-preflight-checked-2026-10-24.json`。
- 工作區 worker 僅增加 `sourceEvent` 觀測欄位，以區分 WS data 與訂閱 snapshot；與正式 worker 的正規化比對通過，其他邏輯相同。正式 release 未因此換版；報告須區分獨立 probe 與正式部署。
- worker AST 語法檢查通過；`live-order-response.test.ts` 1 項通過，設定 broker URL 仍回 `LIVE_LOCKED`。已唯讀檢視正式 `server/_ssr/router-CsM8CvRX.mjs` 的 order handler，仍直接回 501／`LIVE_LOCKED`，本次未送 HTTP 委託。
- collector 10 項、證據讀取器 9 項離線測試全通過；另有只讀獨立審查。合成測試資料不計入真實盤中驗收。`artifacts/fubon-session-dry-run-2026-10-24.json` 確認 Python、worker、憑證檔存在及 worker 僅觀測欄位差異；不代表當日登入已通過。
- 現階段未啟動新的券商連線，未宣稱盤中或整日通過。

## 當日執行與留存

離線準備命令（不連券商）：

```powershell
node --test scripts/lib/fubon-session.test.mjs scripts/lib/fubon-artifact.test.mjs
node --experimental-strip-types scripts/verify-fubon-session.mjs --date 2026-10-27 --dry-run
```

只有實際 **10/27 08:50 起**、完成官方開市與來源預檢後，才執行：

```powershell
$fubonRoot = 'C:\Users\kevin\Documents\ChatGPT\當沖大富翁'
$fubonStamp = Get-Date -Format 'yyyyMMddTHHmmssfff'
$fubonNode = (Get-Command node).Source
$fubonOut = Join-Path $fubonRoot "artifacts/fubon-session-$fubonStamp.stdout.log"
$fubonErr = Join-Path $fubonRoot "artifacts/fubon-session-$fubonStamp.stderr.log"
$fubonProcess = Start-Process -FilePath $fubonNode -ArgumentList @('--experimental-strip-types','scripts/verify-fubon-session.mjs','--date','2026-10-27','--live') -WorkingDirectory $fubonRoot -WindowStyle Hidden -RedirectStandardOutput $fubonOut -RedirectStandardError $fubonErr -PassThru
$fubonProcess.Id
```

08:50–08:55 啟動會先等待到 08:55，再建立自身行情連線。預設 13:35 自動關閉自己的 feed。使用 `--stop-at HH:mm` 提早結束只能得到不完整結果。`--output` 是輸出基底，每次自動新建日期、時間與 UUID 的 run 子目錄；此場使用預設 `artifacts/fubon-session`。

先確認 `artifacts/fubon-session/2026-10-27.active.json` 和對應 PID、程序啟動時間、命令列／runId；有鎖不可另開。異常殘留鎖只在確認原程序已不存在後保留原件並人工處理，不因 PID 重用誤殺其他程序，也不要自動刪除。各 run 保留 `manifest.json`、逐分鐘雜湊鏈 `events.jsonl`、完成 `summary.json` 或中斷 `aborted.json`。沒有 summary 代表未完成，不把程序退出推論為成功。

只在修改或失敗後重跑必要離線測試；正常每 15 分鐘追蹤不反覆跑全套測試。任何正式版本／來源 SHA 變更都先查明。不得改動正在蒐證的來源檔案、門檻或 evidence。

08:50 與 13:35 各跑一次唯讀預檢，傳入全新檔名：

```powershell
node scripts/verify-fubon-preflight.mjs artifacts/fubon-preflight-2026-10-27-before.json --baseline artifacts/fubon-layout-baseline-2026-10-24.json --baseline-sha256 dda6a8c888e90528ef455122186f902b3b68fcf04ee3b7cea774c18afabd32ba
node scripts/verify-fubon-preflight.mjs artifacts/fubon-preflight-2026-10-27-after.json --baseline artifacts/fubon-layout-baseline-2026-10-24.json --baseline-sha256 dda6a8c888e90528ef455122186f902b3b68fcf04ee3b7cea774c18afabd32ba
```

兩次的 `releaseTreeSha256` 必須比對；正式服務中途換版／程序重啟須單獨記錄，不隱藏。這個預檢不登入網站，`authenticatedProductionUi=NOT_CHECKED`，不取代正常瀏覽器驗收。

收盤後對實際 run 目錄執行證據讀取器：

```powershell
node scripts/verify-fubon-session-artifact.mjs <實際run目錄>
```

讀取器確認完整 JSONL 雜湊鏈、manifest／summary 身分與門檻、來源雜湊、分鐘覆蓋及起迄時間，並列出三個證據檔的 SHA。`integrityVerified=true` 僅表示檔案一致性；仍須看 `recordedSessionStatus`，不能把完整保留下來的 INCOMPLETE 報告誤當市場驗收 PASS。沒有 summary 或鏈中斷即退出失敗，保留原檔。

收尾報告列出三項獨立結論：盤中新資料與重連、獨立 collector 整日覆蓋、正式本人 UI。列實際起迄、覆蓋秒數／分鐘、最長缺口、每檔 WS 新成交／五檔變化數、來源時間差及中斷恢復。來源時間差並非經時鐘同步證明的交易所到瀏覽器精準網路延遲。未完整就標未完成或需檢查，不把排程、快照、短測或舊驗收改標全日通過。原始資料、失敗 run、舊報告完整保留。

官方依據：[TWSE 115 年開休市表](https://www.twse.com.tw/holidaySchedule/holidaySchedule?queryYear=115&response=html)、[TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html)、[TPEx 逐筆交易](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/continuous.html)、[OpenAI 排程說明](https://learn.chatgpt.com/docs/automations?surface=app)。
