# 圖表銳利度與字體自架正式發布 — 2026-10-12

使用者要求提升交易畫面的畫質、自架字體並部署到正式站。同一份經過驗證的程式（提交 `a5842b1`，分支 `codex/course-handover`）已發布到 `https://rich.yilutek.com`，仍由既有 Cloudflare Tunnel 轉送至 `127.0.0.1:8790`。

以下時間為 Asia/Taipei（UTC+8）。`<runtime>` 指 `%USERPROFILE%\YilutekServices\DayTradeTycoon`。

## 發布結果

- 舊 release：`20261012T091008729Z`，保留可供回退。
- 新 release：`20261012T124901246Z`，181 個檔案雜湊核對通過（前一版 175 個，多出的 6 個是三個字重的 woff2 與 woff 字體檔）。
- 20:49:40 舊服務正常停止，收到資料庫關閉確認（`lastCleanShutdown=true`、資料庫鎖已釋放、8790 無監聽）。
- 20:49:46 一致備份：`<runtime>\backups\2026-10-12T12-49-46-666Z`，1,043 個檔案逐檔核對通過。
- 20:49:59 僅修改 `hosting.json` 的 `appEntry`。切換前再次核對備份與原始檔案一致，沒有替換資料庫或重設帳號。
- 20:50:12 由既有 `DayTradeTycoonHost` 排程啟動（`launchMode=scheduled-task`），新 instance 為 `a9029dcc-f45d-4f74-b698-7768ebd46d02`。20:50:24 首次健康檢查通過。
- 停機到恢復約 **45 秒**。完成檢查時 `healthFailures=0`、`restartCount=0`；實際 app PID 2528 使用新 release，8790 listener 僅綁定 `127.0.0.1`。

保留原本 HTTPS、認證秘密、班級資料與 Tunnel 設定。三個秘密檔案的 SHA-256 與停機備份一致；除 `appEntry` 外所有 hosting 設定值均一致。未更動其他產品服務、DNS 或防火牆。

## 這次發布的內容

### 圖表銳利度（`src/components/charts.tsx`、`src/lib/market/chart-data.ts`）

- 格線、參考線與虛線、K 線影線與實體、成交量柱、十字線及讀值框全部對齊到整數裝置像素。影線與實體寬度奇偶一致，影線永遠落在實體正中。
- 上一版把 K 線圖畫布固定為至少 2 倍。螢幕不是 2x 時，瀏覽器必須重新縮放畫布，所有細線因此變糊。現在畫布大小與螢幕實際像素一致：優先採用 `ResizeObserver` 的 `devicePixelContentBoxSize`，只在它與 `devicePixelRatio` 相符（誤差一個裝置像素內）時才使用，否則退回四捨五入。Playwright 的 DPR 模擬會讓該值回報 CSS 像素，所以必須有這道檢查。
- 虛線長度也對齊到整數裝置像素，避免小數倍率下每段虛線的端點被抗鋸齒。
- 使用不透明的 2D context 以取得較銳利的文字；第一個時間標籤不再被左邊緣切掉。
- 走勢小圖的昨收虛線改為 non-scaling stroke。

### 文字與邊框（`src/terminal-polish.css`、`src/terminal-premium.css`）

- 可見文字不再小於 11px：短標籤 11px、整句說明 12px。手機版原本 7px 的英文副標題無法閱讀，改為隱藏。長輩模式維持原有字級。
- 大字價格的負字距收斂到 `-0.01em`。
- 2x 以上螢幕，面板與標頭等結構性分隔線改為半像素；按鈕、選單等互動元件的外框維持 1px。
- 圖表上下幾條非互動文字列的留白略縮，圖表高度維持（184 → 181px）。

### 字體自架

- IBM Plex Mono 拉丁字集（400、500、600）改由本站提供（新增依賴 `@fontsource/ibm-plex-mono@^5.3.0`），離線版與地端版的數字字型因此一致。Google Fonts 請求只剩 Noto Sans TC。
- CSP 沒有限制字體來源，建置腳本也沒有副檔名白名單，不需調整。

## 驗證

### 發布前（隔離環境，正式服務未受影響）

- 新 release 在隔離資料庫通過 2/2 真實 HTTP 整合測試：講師初始化與帳號登入、角色隔離、回饋與詢問、重啟持久化；真實分鐘資料揭露、紙上委託與次分鐘成交、持久化。
- 全部測試 554 項：552 通過、2 略過、0 失敗。`tsc --noEmit` 通過；`eslint src` 無錯誤。完整建置（含離線版驗證）通過。
- 圖表銳利度以「抗鋸齒混色像素」占繪製像素的比例量測，使用 Chrome 的真實裝置縮放（`--force-device-scale-factor`），在實際交易畫面上對照已部署版本與新版：

  | 螢幕倍率 | 已部署版本 | 新版 |
  |---|---|---|
  | 1x | 42.5% | 0% |
  | 1.25x | 56.4% | 0% |
  | 1.5x | 44.7% | 0% |
  | 2x | 30.7% | 0% |

- 低於 11px 的可見文字：桌機 57 → 0、手機 25 → 0、長輩模式 8 → 0。1366×900、820×900、375×812、320×700 及兩種長輩模式尺寸都沒有水平溢出、文字截斷或超出畫面的元素。
- 擋掉 Google Fonts 後，三個字重仍從本站載入，數字寬度為 Plex 的 600（退回字體為 500）。

### 發布後（正式站）

- 外網 HTTPS 健康檢查回覆 200。公開 JS/CSS 共 47 個檔案的 SHA-256 與新 release manifest 一致。
- 三個字體檔由正式站提供：`ibm-plex-mono-latin-400/500/600-normal-*.woff2` 皆回覆 200，`font/woff2`，大小 14,708／14,888／15,620 bytes。
- 未入場時 `/api/morning` 與 `/api/download/offline` 回覆 403；私人來源 `/server/index.mjs` 回覆 404；`/morning?panel=trade` 與 `/try` 回覆 200。
- 在瀏覽器開啟 `/try`：字體從 `/assets/` 載入且實際生效，頁面主控台沒有錯誤。

## 未驗證

- 沒有以學員或講師帳號登入正式站。登入後的交易畫面（圖表、字級、版面）是在隔離環境用同一份程式驗證，正式站只驗證公開頁面、資產雜湊與字體。
- 只在 Chrome 驗證。沒有實體 iOS、iPad 或 Safari 驗收；Safari 會走四捨五入的備援路徑，該路徑有單元測試，但沒有在實機上看過。
- 舊版生成桌面（`terminal.tsx`）與手機行情頁（`mobile-market.tsx`）同樣使用 `TapeChart`，會套用新的像素對齊，但沒有在真實畫面逐頁檢查。

## 已知事項

- 此提交同時包含前一個工作階段尚未提交的成果（畫面改版、閃電下單與五檔、地端打包及其文件），詳見 `terminal-polish-2026-10-12.md`、`flash-order-2026-10-12.md`、`onprem-package-2026-10-09.md`。
- 中文字體 Noto Sans TC 仍從 Google Fonts 載入；完整自架會增加數 MB，這次沒有做。
- `terminal-premium.css` 內約 300 個寫死的色碼沒有整理，字級下限只套用在目前實際生效的規則。
- 完整 `npm run lint` 會報錯，來源是未追蹤的建置輸出（地端部署包資料夾與 `tmp/`），不在此提交內；`src` 本身無錯誤。
- `npm audit` 回報一個高風險項目 `source-map-js`（建置工具的相依套件），與這次改動無關。

## 回退

先依 `scripts/hosting/host.ps1 stop` 正常停止並確認資料庫關閉，重新備份；再將 `<runtime>\hosting.json` 的 `appEntry` 指回舊 release `20261012T091008729Z` 的 `server\index.mjs`，用 `host.ps1 start` 由既有排程啟動，並重做外網驗證。保留目前正式資料庫；本次沒有資料格式變更，不需用舊備份覆寫停機之後新產生的學員資料。

## 證據

發布過程的原始紀錄在 `artifacts/deploy-20261012-chart-fonts/`（此資料夾被 git 忽略）：`build.log`、`stage.json`、`integration.log`、`preflight.json`、`stop.json`、`backup.json`、`activate.out`、`start.json`、`final-status.json`、`verify.out`。
