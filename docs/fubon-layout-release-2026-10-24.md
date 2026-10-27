# 富邦五檔窄螢幕修正與正式發布

台北時間 2026-10-24 完成。正式入口：<https://rich.yilutek.com/morning?feed=fubon>。

最終版本 `20261024T002006781Z`；正式本人登入、自選切換、四欄五列與四種尺寸驗收通過。真實下單持續 `LIVE_LOCKED`，沒有向正式站送出任何測試或真實委託。盤中與整日仍待 10/27，這次休市檢查不能代替。

## 修正與畫面證據

大字模式根字級 20px，五檔數字 22px，原先四欄 padding 與 nowrap 撐出 309px 表格，被 291px 內容容器裁掉約 17px。本次只縮小窄螢幕五檔的水平留白，保留字級、完整數字與買賣四欄；另加獨立、可聚焦的橫向捲動區，避免未來超長數量被外層裁切。自選表格的隱藏欄規則不套到五檔。

| 正式 Chrome 尺寸 | 文字模式 | 五檔可用／實際寬 | 結果 |
| --- | --- | --- | --- |
| 1366×900 | 標準 | 486／486px | 四欄五列完整，無欄內溢出 |
| 820×900 | 標準 | 779／779px | 四欄五列完整，無欄內溢出 |
| 375×812 | 標準 | 350／350px | 四欄五列完整，無欄內溢出 |
| 320×700 | 大字 | 291／291px | 右欄右緣 302px，在面板右緣 303px 內 |

四種尺寸都無整頁水平溢出。正式本人帳號讀取 2330／2317／2454／6488，切換後名稱、成交及五檔對應正確；資料時間為 10/22 13:30，顯示收盤、舊資料與非即時警示。結束恢復原本 2330／2317／2454、自選台積電、標準字級及正常視窗尺寸。

- 原 `artifacts/fubon-fixed-final-ui-2026-10-24.json` 因驗收 helper 保留前物件，遺漏 viewport 陣列；交叉核對已發現並保留原件。重新量測四尺寸後，另存下列完整收據，明確驗證 4 viewports／4 stocks。
- 正式 UI 收據：`artifacts/fubon-fixed-final-ui-complete-2026-10-24.json`。
- 桌面／平板／手機／大字圖：`artifacts/fubon-fixed-final-desktop-2026-10-24.png`、`fubon-fixed-final-tablet-2026-10-24.png`、`fubon-fixed-final-phone-book-2026-10-24.png`、`fubon-fixed-final-senior-book-2026-10-24.png`。
- 上櫃大字圖：`artifacts/fubon-fixed-final-senior-tpex-2026-10-24.png`。
- 本機排版壓力測試使用明確標記的非即時快照與合成 12 位數量：表格 481px、容器 291px，鍵盤向右捲到 190px 後完整顯示最後欄；數字沒有省略或改單位。收據 `artifacts/fubon-layout-predeploy-2026-10-24.json`。此測試不是市場資料驗收。

## 發布完整性與修復過程

中間版 `20261024T001419062Z` 的 UI 已通過，但真實行情程序第一次 import 時在 release 產生 `credentials/__pycache__/credentials.cpython-312.pyc`，導致檔案數從 316 變 317，完整性檢查未通過。保留中間版與失敗收據 `artifacts/fubon-layout-manifest-failure-2026-10-24.json`，沒有刪除新增檔來改寫結果。

最終版的 Python 子程序固定設 `PYTHONDONTWRITEBYTECODE=1`。隔離測試透過實際 `FubonFeed` 啟動本機 Python、匯入臨時 helper，確認旗標生效且無 pycache；不載入 SDK、不讀真實憑證、不連券商。最終新 release 在本人行情頁啟動後再次完整比對，仍為 316 檔，沒有 bytecode 檔案。

- 本次正式程式變更：五檔 wrapper／CSS；禁止 Python 子程序寫入 bytecode；收納既有 `sourceEvent` 觀測欄位供 10/27 區分 WS data／snapshot。無下單 adapter 或權限放寬。
- 兩次切換都先取得 DB 正常關閉確認，再以逐檔大小與 SHA 驗證備份；只改 `hosting.json.appEntry`，經既有 `DayTradeTycoonHost` 排程啟動。
- 最終備份：`C:/Users/kevin/YilutekServices/DayTradeTycoon/backups/2026-10-24T00-20-15-651Z`，1,061 檔驗證成功。第一次換版前備份亦保留於 `.../backups/2026-10-24T00-14-52-075Z`。
- 保留本次修正前版本 `20261022T230320858Z` 作回退參考；中間版因完整性失敗不作本次驗收通過版本。
- 最終版啟動瞬間公開 health 曾回 502（隧道尚未就緒），08:21:05 重查為 200，之後完整公開檢查通過；此短暫狀態保存在 `artifacts/fubon-layout-final-tunnel-ready-2026-10-24.json`，不聲稱換版零中斷。

## 檢查與限制

- 建置、TypeScript、53 項券商保護測試、25 項整日驗收／證據／基線測試及 1 項 Python 子程序回歸測試通過。
- 全工作目錄 `npm run lint` 掃到既有 `.claude/worktrees` 與地端產物而失敗；未修改這些副本。對正式 `src` 與本次 preflight 腳本執行 lint 為 0 errors、5 項既有 fast-refresh warnings；本次新增 bytecode 檔案範圍 lint 0 errors／0 warnings。不是宣稱整個工作目錄 lint 全綠。
- 最終建置的隔離 HTTP 驗證 12 項通過，包括未入場 403、未登入 401、學員／跨來源 403、行情寫入 405、下單 501。假帳號與測試 DB 僅在隔離環境；未在正式站建立代用帳號。
- 公開 health／教室保護／試用／離線 ZIP／PDF 檢查通過；158 個公開 assets 實際 HTTPS 回應 SHA 全數吻合。正式編譯 order handler 仍直接回 501／`LIVE_LOCKED`，沒有透過送單驗證。
- 發布 manifest 315 個內容檔案 SHA 全數吻合，加 manifest 本身共 316 檔。前後 tree SHA：`2fa65932e965446306d08b8882f898667e0a55c34e50e9d5e3c82630a639de5b`。
- 封存基線：`artifacts/fubon-layout-baseline-2026-10-24.json`，SHA256：`dda6a8c888e90528ef455122186f902b3b68fcf04ee3b7cea774c18afabd32ba`。
- 前後預檢：`artifacts/fubon-layout-preflight-2026-10-24.json`、`artifacts/fubon-layout-final-post-ui-2026-10-24.json`；正式 health 200、匿名行情 403、私有 worker 404 均通過。預檢本身不代替本人瀏覽器紀錄。
- 本機排版服務 18825 與隔離 HTTP 18824 均已關閉，正式本人 Chrome 分頁保留。所有舊失敗與收據保留。

## 10/27 驗收

heartbeat `10-27` 保持 ACTIVE，週二台北時間 08:50 不變；08:55 起連續蒐集，09:00–13:30 驗收，10:30 只中斷獨立 collector 自己的 verification socket，13:35 收尾。既有排程 prompt 會讀取更新後的 `docs/fubon-session-acceptance-2026-10-27.md`；此文件已改用新 release、sealed baseline 路徑及 SHA 參數，不再拿舊版作基準。

這次只證明正式部署、休市本人資料讀取與畫面修正。新成交、五檔跳動、斷線恢復及整日覆蓋仍須依當日原始證據判定，真實下單持續關閉。
