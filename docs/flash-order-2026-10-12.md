# 模擬五檔與閃電下單 — 2026-10-12

已套用本機 Cloudflare 正式服務，版本 `20261012T083158916Z`。
入口：<https://rich.yilutek.com/morning?panel=trade>。

## 操作與成交規則

- 右側「五檔」預設開啟，紅色賣方報價點價買進，綠色買方報價點價賣出。每筆可選 1–3 張。
- 預設點價先核對；開啟「閃電即送」後，點價格直接送出指定價位的模擬限價委託。一般委託也可切換市價／限價、輸入價格或增減一檔。
- 五檔價量由已揭露分鐘收價及固定規則生成，明示「教學生成，非真實委託簿」。不使用未揭露 K 線，也不冒充即時券商報價。漲跌停範圍外不補造價位。
- 每次推進一分鐘，使用該分鐘開盤價檢核：買進開盤價不高於限價、賣出不低於限價才成交；成交採該開盤價。沒有逐筆或排隊資料，不從分鐘高低價推算盤中成交，生成的五檔量也不決定成交。
- 未達價繼續留單，可撤回；教材結束自動取消未成交委託。仍為只賣已持有庫存、同時一筆待撮合，保留原資金、費稅與版本檢核。
- 切換商品、張數或行情分頁會關閉閃電；元件也監聽離開視窗及隱藏事件解除閃電。預設不記住開啟狀態。雙擊及按鍵連發有前端防重，伺服器繼續檢核 revision、requestId 與資料庫交易。
- 手機點價後會自動帶到完整核對區或待撮合／撤單區。手機價位按鈕至少 44px，長輩模式至少 56px。

## 實作與相容

新增 `morning-order-book.tsx`、`morning-book.ts`、`morning-flash.css`，整合 `morning-quotes.tsx`、`morning-trading.tsx` 與 `morning-practice.tsx`。`morning.ts` 與 `morning-engine.ts` 的委託新增可選 `limitPrice`、`entryMode`。

舊市價請求不加入預設新欄位，保留既有請求雜湊與重試行為。資料仍在既有 JSONB 狀態內，無資料庫結構遷移。兩日 900 根歷史分鐘 OHLC、lessonId、既有學員帳戶及交易紀錄保留。

## 驗證

TypeScript、修改元件的 ESLint、正式與離線包建置通過。完整測試 548 項：546 通過、2 略過、0 失敗。最終 release 的登入與 morning HTTP integration 2/2 通過，涵蓋未達價留單、合法價位、同 requestId 並發防重、變價重試拒絕、重新啟動持久化、撤回與較有利開盤價成交。

所有瀏覽器驗收均使用外部 Chrome，交易操作採臨時 PGlite、正常登入的隔離測試帳戶，僅綁定 loopback 18800／18801。未操作正式學員的交易資料。

- 1366×900 桌機：五檔、K 線、庫存及閃電面板同屏，整頁 1366×900，沒有水平溢出。
- 820×900 平板、375×812 手機、320×700 窄螢幕及長輩模式：沒有水平溢出，手機價位高 44px、長輩 56px。這是響應式 Chrome 驗收，不代表實體 iPhone／iPad 或 Safari 驗收。
- 實際點賣一價 2585 買進 1 張，開啟閃電後雙擊也只新增 1 筆；後續分鐘開盤 2580 成交。點買一 2575 賣出 1 張，後續開盤 2580 成交，庫存、資金與費稅同步。
- 2320 買進限價未達價，前進後仍為待撮合；重新整理保留同筆委託，撤回後顯示「已撤回」。委託表同時顯示委託價、成交價及閃電標示。
- 張數、商品及行情分頁切換確實解除閃電；無庫存商品與超過持有張數的賣出操作停用。
- 上述主要交易及響應式操作先在候選版 `20261012T082620175Z` 完成；最終版只再修正確認區與新待撮合區的自動捲動。最終版重新核對手機確認區完整可見、送單後待撮合按鈕可見，再以手機雙擊點價完成買進並由 API 回讀：cursor 28、委託 3／成交 3、最後限價 2585／成交 2580、現金 2,248,378、庫存 3,000 股。

最終版本隔離帳戶截圖：

![五檔閃電下單桌機](../artifacts/flash-order-20261012/desktop-final.png)

![手機待撮合](../artifacts/flash-order-20261012/mobile-pending-final.png)

其餘畫面與原始測試證據保存在 `artifacts/flash-order-20261012/`，包含 `browser-orders-initial.json`、`browser-orders-final.json`、`mobile-confirm-final.png`、`tablet.png`、`mobile-320.png`、`senior-320.png`。

## 正式發布

- 原服務正常停止，資料庫關閉確認 `lastCleanShutdown: true`。
- 備份 `C:\Users\kevin\YilutekServices\DayTradeTycoon\backups\2026-10-12T08-34-57-756Z`，1043 檔逐檔驗證。
- 候選 release 175 檔雜湊驗證，只切換 `hosting.json.appEntry`，保留原版 `20261012T060308205Z`。
- 由原排程任務 `DayTradeTycoonHost` 啟動，健康檢查 HTTP 200，服務仍只綁定 `127.0.0.1:8790`。
- 公開 47 個 JS/CSS 的 SHA256 與 manifest 一致；除 appEntry 外設定一致，3 個秘密檔案雜湊不變。公開入口、試閱與原存取限制檢查通過。
- 外部 Chrome 確認正式入口可載入。正式瀏覽器停在教室入場頁，未代登入正式帳號做交易；完整互動驗證使用同一發布版本的隔離帳戶。
- 兩個隔離 QA 服務都取得資料庫正常關閉回覆，18800／18801 已停止；暫時 Chrome 尺寸覆寫已重設。

發布證據為同一目錄的 `stop.json`、`backup.json`、`activation.json`、`start.json`、`public-health.json`、`release-verification.json` 與 `final-status.json`。回復時應正常停止服務並確認資料庫關閉，將 appEntry 指回保留版本，保持目前資料庫不被覆寫。
