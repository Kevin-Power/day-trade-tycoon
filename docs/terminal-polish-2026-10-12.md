# 交易工作台畫面品質提升 — 2026-10-12

已正式套用本機 Cloudflare 服務，版本 `20261012T091008729Z`。
入口：<https://rich.yilutek.com/morning?panel=trade>。

## 畫面變更

- 深石墨色底、分層面板、較安靜的邊框與淡紫選取標示，減少原本密集的藍色框線。
- 放大商品、價格、資金與庫存數字，統一間距、圓角及字體層級。
- 買方與賣方五檔左右並排，每側從第一檔排列到第五檔；價格、模擬量與深度底色分開顯示。點買方價格賣出、點賣方價格買進，標示保留。
- 商品選擇移到下單行情標頭；保留一般委託的方向、類型與張數加減，移除重複的商品資訊與快捷張數列。
- K 線採至少 2 倍、最高 3 倍 canvas 繪製倍率，改用較細 K 棒、右側價格刻度、目前收價線，加入最新已完成分鐘的開高低收讀值。
- 手機五檔價位高至少 44px；長輩模式改為單欄、大字與至少 56px 價位按鈕，修正啟用中開關的對比。

本次只調整視覺與控制項布局。歷史 OHLC、按進度揭露、伺服器撮合、費稅、身份與持久化規則沒有改動；五檔仍明示為教學生成。

主要檔案為 `src/terminal-polish.css`、`src/styles.css`、`src/components/charts.tsx`、`morning-practice.tsx`、`morning-order-book.tsx`、`morning-quotes.tsx` 與 `morning-trading.tsx`。新樣式以 `.studio-terminal.pro-terminal` 限定範圍，圖表新增可選 terminal presentation，其他圖表保留原呈現方式。

## 驗證

TypeScript、修改元件 ESLint、正式 build 通過。完整測試 548 項：546 通過、2 略過、0 失敗；最終 release 的登入與 morning HTTP integration 為 2/2 通過。

交易與畫面操作使用外部 Chrome、獨立臨時 PGlite 與隔離測試帳戶，不操作正式學員紀錄。

- 桌機 1366×900、平板 820×900、手機 375×812、窄螢幕 320×700 及長輩模式沒有水平溢出。桌機完整頁高 984px，部分一般委託控制需在右欄捲動；點價後核對區會帶入可視範圍。這是 Chrome 響應式驗收，未宣稱實體 iOS 或 Safari 驗收。
- 桌機 canvas 顯示寬 733px、繪製寬 1466px；320px 手機的 canvas 顯示寬 287px、繪製寬 574px。左右方向鍵仍能讀取歷史分鐘 OHLC。
- 一般點價會先核對價格和張數；返回修改不送單。開啟閃電後雙擊賣一 2585 只建立一筆買單，下一分鐘開盤 2580 成交。
- 點買一 2575 建立賣單後可撤回；手機再次點買一 2575 賣出 1 張，下一分鐘開盤 2580 成交。API 回讀 cursor 29、委託 5、成交 4、現金 4,822,302、庫存 2,000 股。
- 切換商品解除閃電，沒有持有庫存的商品停用賣出操作。

上述完整互動與各尺寸先在候選版 `20261012T090102365Z` 驗收；最終版僅再加入長輩開關啟用狀態的 5 行對比樣式。最終版重新 build、執行 HTTP integration，並再次檢查桌機、長輩模式與高清 canvas，保存截圖。

最終版本隔離帳戶的實際畫面：

![新版桌機工作台](../artifacts/terminal-polish-20261012/desktop-final.png)

![長輩模式對比修正](../artifacts/terminal-polish-20261012/senior-320-final.png)

測試與其餘畫面位於 `artifacts/terminal-polish-20261012/`，包含 `tests.log`、`build.log`、`integration-final.log`、`browser-orders-final.json`、`tablet-final.png`、`mobile-375-final.png`、`mobile-320-final.png`。

## 正式發布

- 原服務正常停止並收到資料庫關閉確認。
- 一致備份為 `C:\Users\kevin\YilutekServices\DayTradeTycoon\backups\2026-10-12T09-12-12-815Z`，1043 檔逐檔核對。
- 候選 release 175 檔雜湊一致，只切換 `hosting.json.appEntry`；保留前版 `20261012T083158916Z`。
- 由既有排程啟動，健康檢查 HTTP 200，仍只監聽 `127.0.0.1:8790`。
- 公開 47 個 JS/CSS 的 SHA256 與 manifest 一致；除 appEntry 外設定一致，3 個秘密檔案雜湊不變。公開試閱及既有下載／登入限制驗證通過。
- 外部 Chrome 確認正式入口可載入。目前正式分頁停在入場頁；完整已登入的 UI 驗收採同一發布程式的隔離帳戶，沒有代登入正式帳號交易。
- 臨時 QA 服務取得資料庫正常關閉回覆，18800／18801 停止，Chrome 暫時尺寸已重設。

發布原始證據為同一目錄的 `preflight.json`、`stop.json`、`backup.json`、`activation.json`、`start.json`、`public-health.json`、`release-verification.json`、`public-entry.png` 與 `final-status.json`。

若需回復程式，先正常停止服務並確認資料庫關閉，再將 appEntry 指回保留版本；不要用舊備份覆蓋現有學員資料。
