# 參考交易盤改版與發布 — 2026-10-12

已套用至既有 Windows 本機 Cloudflare 服務，正式版本 `20261012T060308205Z`。
入口：<https://rich.yilutek.com/morning?panel=trade>。

## 參考與實作

使用者指定 <https://reef-umbra-forge-umbra.grok.me>，在使用者完成入場後，以外部 Chrome 檢視桌機及手機實際交易盤。參考盤已暫停；未送出參考盤委託。取其連續分區、藍色標題列、報價小走勢及行情靠近委託的安排；沒有複製網站程式或接回舊生成行情引擎。

- 桌機採自選／走勢／下單三欄，庫存、委託、成交固定在走勢下方；教材說明由底部展開。
- 每檔自選顯示大字價格、漲跌與 SVG 小走勢，只使用伺服器已揭露的完整分鐘收價；缺分鐘處斷線，昨收以虛線標示。
- 右側提供行情摘要及最近 10 根已揭露分鐘 OHLC 明細，旁列「五檔未串接」。未建立假五檔、成交量或即時逐筆資料。
- 下單保留商品、買賣、張數、參考金額、核對、送出、撤單及下一分鐘撮合；縮減表單留白，沒有改變伺服器成交規則。
- 帳戶列新增本輪損益：帳戶估值減期初資金，含已付費稅與持倉收價估值，並非純已實現損益。
- 手機維持五個分頁與單一有效下單表單，長輩模式主要下單按鈕至少 56px。

改動檔案：`src/components/morning-practice.tsx`、`src/components/morning-trading.tsx`、`src/components/morning-quotes.tsx`、`src/terminal-premium.css`。沿用已存在的紙上成交引擎、來源資料、登入與部署機制。

## 實際驗收

所有瀏覽器操作均使用外部 Chrome，未使用 Codex 內建瀏覽器。交易測試採獨立臨時 PGlite 與正常登入的測試帳戶，僅在 loopback 18800／18801 提供服務；沒有修改正式學員的交易資料。

- 1366×900：頁面尺寸 1366×900，無整頁水平或垂直溢出；下單按鈕底緣 764px、庫存區底緣 837px；5 檔商品的小走勢與單一下單表單。
- 820×900：無水平溢出，下單按鈕底緣 875px。
- 375×812：無水平溢出，下單按鈕底緣 674px，僅一份下單表單。
- 320×700：無水平溢出；無庫存商品的賣出按鈕停用並顯示原因。
- 長輩模式：單區操作、56px 主要下單按鈕，字級與版面檢查通過。
- 自選商品會同步更新走勢與下單商品；分鐘明細、庫存／委託／成交分頁及教材說明展開收合可操作。
- 以瀏覽器完成核對、送單、撤單與賣出撮合；撤單列為「已撤回」，賣出更新庫存及費稅。前一候選版的這些流程與最終版邏輯相同，最後調整僅 CSS。
- 最終版再次完成瀏覽器買進：鴻海 2 張，09:27 開盤價 259.5 撮合，手續費 444、稅費 0；持倉、現金與帳戶估值由 API 回讀核對，沒有提前揭露後續分鐘。
- 控制台曾出現 `chrome-extension://.../content-scripts/content.js` 的 storage access 錯誤及同時的頁面副本；不宣稱控制台零錯誤。上述操作與 API 核對均成功。

截圖（正式候選版本、隔離測試帳戶）：

![桌機交易工作台](../artifacts/reference-terminal-20261012/desktop-final.png)

![手機下單](../artifacts/reference-terminal-20261012/mobile-final.png)

另存 `tablet-final.png`、`senior-final.png`、`layout-verification.json`、`browser-buy-result.json` 於同一證據目錄。這是 Chrome 響應式驗收，不代表已在實體 iPhone／iPad 或 Safari 驗收。

## 檢查與發布證據

- TypeScript 與修改元件的 ESLint 通過。
- `npm test`：542 項，540 通過、2 略過、0 失敗。
- 離線包與正式建置通過；來源核對仍為兩日 900 根分鐘 K。
- 對最終 release 執行登入與 morning HTTP integration：2/2 通過。
- 停止正式服務取得 `lastCleanShutdown: true`，再產生並逐檔驗證備份：`C:\Users\kevin\YilutekServices\DayTradeTycoon\backups\2026-10-12T06-06-26-794Z`，1043 檔。
- 發布前驗證候選版 174 檔，只修改 `hosting.json.appEntry`，舊版 `20261011T030009879Z` 保留。
- 由原排程任務啟動，健康檢查 HTTP 200。服務只綁定 `127.0.0.1:8790`。
- 公開站 47 個 JS/CSS 的 SHA256 全部與 release manifest 一致；3 個秘密設定檔雜湊不變。
- 公開入口、試閱與原存取限制的檢查通過。正式學員登入後的畫面沒有代登入重做交易；完整交易流程以上述隔離帳戶驗證。

原始證據：`artifacts/reference-terminal-20261012/` 的 `tests.log`、`integration.log`、`build.log`、`stop.json`、`backup.json`、`activation.json`、`start.json`、`public-health.json`、`release-verification.json`。

回復時應正常停止服務，確認資料庫關閉後，再使用既有發布程序將 `hosting.json.appEntry` 指回上列保留版本。不要覆蓋目前資料庫。
