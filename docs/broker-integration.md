# 真實 API 串接邊界

2026-10-23 更新：使用者已確認首階段為**本人自己的台股證券帳戶，國票與富邦**。完整雙券商架構、異常處理、實作範圍、驗收與啟用條件以 [雙券商串接與可靠性計畫](./broker-live-readiness-2026-10-23.md) 為準。

後續已發布本人使用的富邦盤中唯讀行情，入口 `/morning?feed=fubon`，詳見 [操作、維運與驗收紀錄](./fubon-readonly-2026-10-23.md)。自選、五檔、權限與真實斷線重連已驗證；開盤前取得的是前一交易日資料，盤中新成交與長時間驗收仍待完成。獨立訂單持久紀錄尚未接上交易 SDK；`liveBroker.ready=false`，`/api/broker/order` 回 501 / `LIVE_LOCKED` / `retryable:false`，設定 BROKER_BASE_URL 不會開啟交易。

下列保留原本富邦分層說明；官方來源本次已重新核對，SDK 的實際版本與原始欄位對映仍需在接入時鎖定驗收。

## 富邦對應與實作範圍

以下官方文件於 **2026-10-23** 重新核對；實作時需鎖定實際 SDK 版本並再次核對規格。Node.js 方法名稱只用來定位官方介面，交易呼叫尚未加入本專案。

| 教室需要的能力 | 富邦官方介面 | 串接時的處理 |
| --- | --- | --- |
| 分時成交、江波圖價格資料 | WebSocket `trades`，含價格、數量、時間、流水號 | 保存來源、交易日與接收時間；圖表只用已收到的有效資料，不以未來資料補出轉折。標記為真實行情時不得混入教室生成行情。[Trades](https://www.fbs.com.tw/TradeAPI/docs/market-data/websocket-api/market-data-channels/trades/) |
| 買賣最佳五檔 | WebSocket `books` 的 bids / asks | 獨立判斷五檔新鮮度；五檔數量不代表自己的排隊位置或保證可成交量。[Books](https://www.fbs.com.tw/TradeAPI/docs/market-data/websocket-api/market-data-channels/books/) |
| 委託、查單、改單、刪單 | 證券交易 SDK；`stock.placeOrder`、`stock.getOrderResults` 等 | 伺服器負責格式轉換與非同步委託狀態；教室的張數轉成官方要求的股數，並另核對整股、零股及當沖交易類別。[交易教學](https://www.fbs.com.tw/TradeAPI/docs/trading/guide/trade_example/) |
| 委託、異動、成交推播 | `setOnOrder`、`setOnOrderChanged`、`setOnFilled` | 分開記錄接受、異動與成交，不能將送單回應當作成交；依正式回報欄位設計去重鍵，不假設富邦必有名為 executionId 的欄位。[主動回報](https://www.fbs.com.tw/TradeAPI/docs/trading/guide/report_example/) |
| 庫存及損益核對 | `accounting.inventories` 等帳務查詢 | 以券商可委託庫存與帳務為準；可用資金、額度、交割資訊的完整介面仍須逐項確認。[帳務](https://www.fbs.com.tw/TradeAPI/docs/trading/guide/account_example/) |

行情連線需先登入、初始化再訂閱；官方提供 Normal / Speed 模式。本期唯讀使用已安裝 SDK 的預設 Speed 模式與 trades、books 頻道，搭配 REST 完整快照。[WebSocket 開始使用](https://www.fbs.com.tw/TradeAPI/docs/market-data/websocket-api/getting-started/)

## Windows 主機整合路徑（尚未實作）

沿用目前 Windows / Node.js 部署，新增獨立的伺服器 broker worker，透過限制存取的本機 IPC 與教室後端往來，由 worker 管理 SDK 登入、行情、委託回報及重連。SDK、憑證與帳戶秘密不進瀏覽器、離線教材、public、Git 或前端 build。worker 不另開外網入口；教室後端仍需逐筆驗證使用者與被授權帳戶。

盤中 worker 建議優先使用獨立 Python 環境，沿用既有資料管線的語言經驗，但不改用盤後 collector 執行交易。官方 Node.js `fubon-neo` 也是可選介面；選定實際 SDK、Windows 架構與語言版本後，隔離驗收並鎖定套件雜湊。官方列出支援不等於本主機相容性已驗收。[安裝與版本相容性](https://www.fbs.com.tw/TradeAPI/docs/install-compatibility/)

worker 的憑證、秘密、原始回報與委託日誌規劃放在受限 runtime 的獨立區域，分開保存模擬紀錄與真實帳務；任何備份都需保護帳戶資料。重連時重新註冊 callbacks、重建行情訂閱，先查單與對帳再恢復新增委託。建立統一節流器，依官方限制和實際帳戶條件核對，不能由每個手機分頁各自重連或輪詢。[斷線重連](https://www.fbs.com.tw/TradeAPI/docs/trading/guide/advance/reconnect/)、[速率限制](https://www.fbs.com.tw/TradeAPI/docs/trading/trade-rate-limit/)

目前網站仍由使用者登入後的排程啟動；新增 worker 也不會自動變成免登入、全天候的 Windows 系統服務。實盤前需另驗收主機重啟、睡眠、登出、網路中斷與故障恢復，部署限制見 [本機對外服務](./self-hosting.md)。

## 開發前必備條件

- 帳戶本人完成富邦證券開戶、有效數位憑證、API 使用聲明及連線測試；由本人完成身分驗證與申請，不把憑證或密碼貼進聊天。這些是官方列出的前置條件。[事前準備](https://www.fbs.com.tw/TradeAPI/docs/trading/prepare/)
- 向富邦確認本產品的教學用途、收費服務、行情展示、保存、重播及多位學員存取的使用授權。**個人 API 可讀行情，不代表可以把該行情轉授全班或公開網站。** 目前沒有取得此項授權的證據。[行情服務與使用規範入口](https://www.fbs.com.tw/TradeAPI/docs/market-data/intro/)
- 確認首階段商品、整股／零股、現股當沖資格、交易額度，以及單一帳戶或每位學員自有帳戶的方案。講師身份不包含操作學員券商帳戶的權限。
- 富邦官方目前已提供測試環境，並註明暫僅提供證券測試帳號；本專案尚未申請、登入或完成該環境驗收。這修正 10/04 文件中「尚未確認測試環境」的舊結論。[官方測試環境](https://www.fbs.com.tw/TradeAPI/docs/welcome/#測試環境)

## 已有的分層與需要改造之處

- `src/components/order-ticket.tsx` 收集委託並顯示五檔估算，估算不是券商成交承諾。
- `src/lib/broker/types.ts` 的 OrderIntent 已含通路、帳號、商品、方向、價格、張數與 TIF。目前 BrokerPort 為同步模擬介面，不能把其 ok=true 直接當成真實 API 成交。
- `src/lib/broker/index.ts` 負責模擬引擎與尚未串接的實盤分流。券商格式轉換需另加伺服器 adapter，不能將密鑰或帳戶授權交給前端。
- `src/lib/market/engine.ts`、execution.ts 負責教室生成五檔、成交和模擬庫存。正式帳戶的委託與庫存必須以券商回報及查詢為準，不能讓此引擎替正式帳戶產生成交。

## 富邦正式串接的實作順序（基礎模組已開始，正式流程待接線）

1. 確認官方 API 版本、交易商品、行情授權、測試環境、委託與取消規格。股票張數與券商股數／期貨口數需明確轉換；費率、稅額、商品檔距與交易時段依該市場規格另行核對。
2. 建立伺服器的帳戶授權與秘密保存；登入教室不等於取得券商帳戶權限。每個下單／查單／取消請求皆核對本人與對應授權帳戶，講師檢視課堂資料不授予代下單權限。
3. 在送出前持久保存委託意圖、帳戶、不可重用的 clientOrderId、冪等鍵與稽核時間。相同冪等鍵重試回同一筆；不同內容重用鍵則拒絕。
4. 引入非同步狀態：待送出、送出中、券商接受、部分成交、全部成交、取消中、已取消、拒單、結果待確認。API HTTP 成功僅表示取得回應，不能當成交；取消中仍可能收到成交回報。
5. 逾時、斷線或重啟後先按委託編號查詢。結果待確認時凍結該筆重送，直到券商查單／對帳解決；不能用一般 HTTP 自動重試生成第二張單。
6. 成交回報按券商帳戶、交易日與經官方欄位確認的成交唯一鍵去重，再映射成本地 executionId；處理亂序與重播，保留委託、成交、費用、取消及拒單原始證據。重連後核對待單、累計成交、現金與庫存；有差異則停止新增委託並保留取消／查詢途徑。
7. 伺服器送單前驗證商品、交易時段、行情新鮮度、數量、價格、可用資金、庫存及預留額度，執行帳戶限額與停用開關。行情未知或過期時不使用教室生成五檔補值。
8. 完成本地隔離測試後，使用富邦已公開提供的證券測試環境完成整段驗收，再依帳戶本人的明確設定啟用正式通路。本專案尚未完成官方測試環境驗收。手機頁需始終清楚顯示環境與帳戶，切換時清除待送草稿，避免模擬單被帶入正式通路。

## 必須通過的串接情境

同一筆重按送單、送單回覆遺失、已接受但尚無成交、部分成交後取消、取消與成交交錯、拒單、FOK 不足量、IOC 部分成交、重複回報、亂序回報、重連、程序重啟、行情過期、帳戶權限錯誤、資金／庫存對帳不符。每個情境都需核對券商查詢和本地持久紀錄，不以畫面提示代替。

目前教室模型仍為生成五檔，沒有真實市場的完整佇列、開收盤集合競價、瞬間價格穩定措施、網路延遲或券商風控。ROD／IOC／FOK 的基本語義與價優、時優參考 [證交所交易制度](https://www.twse.com.tw/zh/products/system/trading.html)，不宣稱完整重現交易所。費稅維持教室逐成交設定，不能代替券商帳單。
