# 雙券商可靠性基礎驗證紀錄

日期：2026-10-23（台北）。基準提交：`e8f7d85`。狀態：**本機驗證完成，未部署；LIVE_LOCKED**。

需求與後續驗收門檻見 [完整接入計畫](./broker-live-readiness-2026-10-23.md)。新增程式保留在工作目錄；本次沒有提交、推送或修改正式啟動設定。

## 結果

| 驗證 | 結果 | 證據／範圍 |
| --- | --- | --- |
| `npm run test:broker` | 42 通過、0 失敗、0 略過 | `artifacts/broker-reliability-focused-2026-10-23.log` |
| `npm test`（最終版本） | 934 項：930 通過、4 略過、0 失敗；約 83.7 秒 | `artifacts/broker-reliability-tests-final-2026-10-23.log` |
| `npm run typecheck` | 通過，exit 0 | 最後兩個邊界修正後重新執行 |
| ESLint（所有本次 TS 變更） | 通過，exit 0 | reliability 目錄、live-order-response 與 API route |
| `npm run build` | 通過，exit 0 | `artifacts/broker-reliability-build-2026-10-23.log`；包含專案既有來源／建置資產檢查 |
| `git diff --check` | 通過 | Windows 換行提示不屬於空白錯誤 |
| 建置後封鎖回覆 | SSR bundle 含 `LIVE_LOCKED` 與 `retryable: false` | `.output/server/_ssr/router-Bkj6S6Wz.mjs` |
| 前端資產隔離 | frontend JS 未找到 `broker_safety_orders`、`BROKER_JOURNAL_SERVER_ONLY` | 本次 journal 沒有接入瀏覽器；此掃描不代表一般性安全稽核 |

四項略過：daily-question、guest-flow、morning-replay 的真實 HTTP 整合案例，因未提供 `CLASSROOM_TEST_RELEASE`；另有獨立地端套件 Chrome／重啟／備份案例，因未提供 `ONPREM_TEST_PACKAGE`。它們沒有被計為通過。本次未另起瀏覽器或正式服務，也未做兩家券商的外部端到端驗收。

## 已測到的故障邊界

- 8 個並行同鍵請求只建立一筆；兩個 journal 實例並行取得派送權，只有一次成功。
- 同鍵不同價格／方向／擁有人拒絕；不同券商、帳戶、環境與交易日不能混讀。
- 正式 `live` 意圖無法取得派送權；過期意圖不送。
- 送出逾時後保留 unknown；晚到 ACK 不直接解除，重試仍回原意圖。換新鍵及跨日也不能繞過同帳戶的不明單。
- 成交早於委託回報、callback／查詢重播、同成交鍵內容衝突、誤配第二張單、超量成交、不同券商委託號衝突均有檢查。
- 取消請求仍視為未確認；取消回報先於成交明細時保持待核對，後續對帳不能虛構缺少的成交。
- 無法寫入資料庫不會取得派送權；已提交派送狀態在獨立暫存資料庫關閉／重開後保留，重啟處理後仍不能重送。
- 錯股、錯來源、錯交易日、過期成交／五檔、舊 socket／心跳、微秒亂序、序號缺口、過舊快照、試撮、交叉／亂序五檔、NaN、價格界線與時鐘回撥皆有案例。
- 不把 heartbeat 當成股票新報價；真實大幅變價不任意平滑；缺少買／賣方時不製造假價。
- 多分頁共享訂閱、超額拒絕、滿額先刪後訂、已移除股票的晚到 ACK、重連世代與重試耗盡有案例。
- 格式錯誤的回報會將已知委託標為待確認，稽核紀錄不直接保存任意錯誤輸入欄位值。

## 本次未驗證

國票／富邦實際 SDK 呼叫、正式或官方測試帳戶登入、券商原始回報映射、完整資金／庫存與預留對帳、交易前授權、行情快照與串流在券商端的共同水位、實際 UI、網路故障恢復時間、雙程序／雙主機 fencing、強制斷電與檔案系統損壞。磁碟測試的正常關閉／重開不能代替電源故障測試。

本次讀取正式設定得到 `hosting.json.appEntry` 指向 release `20261022T161603264Z`，與工作目錄 `.output` 分離；建置沒有切換這個指標。這次沒有查正式站健康或外部 Chrome 畫面，不能據此宣稱正式部署驗收。

## 主要檔案 SHA-256

以下是本次驗證後工作目錄檔案的雜湊；不是正式發布 manifest。

| 檔案 | SHA-256 |
| --- | --- |
| `src/lib/broker/reliability/contracts.ts` | `FD5E3279E10C13387136509B815C03E95D49B40E9E622F863102CBA27130982E` |
| `src/lib/broker/reliability/order-journal.server.ts` | `04375E823CDDB4E4B56500F06FA41C8A65DBD7CC4F6413A2CD4E44F38EFE3793` |
| `src/lib/broker/reliability/quote-guard.ts` | `863C76CC30985E802763480E3A2666E1DD34EF70FB56D3472D8BE9F10CEA6B05` |
| `src/lib/broker/reliability/subscriptions.ts` | `C994DA2BF574DAD078E59945592E800EEA5A4D0861ECB4BAB51E2DB1D1E91BA5` |
| `src/routes/api/broker/order.ts` | `61E4C419AF6F6BCA843372CF5D485855206774B5A7FF090DCFBBDC157BA5D0C5` |
| `docs/broker-live-readiness-2026-10-23.md` | `A30FAF08B6BCA6B6711942755EBAD008D9FBCDD4340DDFDF98E071E7D611DBA7` |
