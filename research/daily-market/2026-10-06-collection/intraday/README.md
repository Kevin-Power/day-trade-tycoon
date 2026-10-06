# 台股早盤分鐘資料：首次採集

查核與採集日：2026-10-06（Asia/Taipei）。本目錄僅是研究採集成果，沒有加入正式教室、修改應用或接通券商。

## 已取得的資料

- 主包：`normalized/2026-10-06/`；備選：`normalized/2026-10-05/`。
- 五檔：2330、2317、2454、2382、2308。均是**技術驗證用候選，非波哥推薦**。
- 來源：Yahoo Finance 公開 chart 回應，正常 GET、無帳戶、無 token、無瀏覽器 cookie；五次 HTTP 200。每份原始回應包含 1,891 個 timestamp，`exchangeTimezoneName=Asia/Taipei`、`gmtoffset=28800`、`dataGranularity=1m`。
- 共同可用日期：2026-09-24、09-29、09-30、10-01、10-02、10-05、10-06。主包與備選各 300 根：5 檔 × 60 根。
- 本資料為 **1 分鐘 OHLCV，不是逐筆成交、五檔或日 OHLC 插值**。沒有生成 K 棒內的價格先後路徑、補值、四捨五入或人工改量。

Yahoo 實際請求形式：`https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?range=7d&interval=1m&includePrePost=false`，其他股票僅替換代碼。完整每次請求、HTTP 狀態、抓取時間、原始回應路徑與 SHA-256 見 `requests.json`；原始 bytes 在 `raw/`。該公開端點可用，不等於已取得穩定 API 合約或商用授權。

## 時間窗與防止提前揭露

取來源 timestamp 在 **[09:00:00, 10:00:00)** 的 60 根，每根間距 60 秒。保留來源 Unix 秒、UTC、台北時間、原始列索引與一分鐘間隔。來源 10:00 的棒存在，但本包明確排除，不能把其後一分鐘的結果視為 10:00 前已知資訊。

回放採保守規則：將來源分鐘標籤視為起點，`replayAvailableAt = timestamp + 60 秒`；09:00 的完整 OHLC 最早 09:01 揭露，09:59 的最早 10:00 揭露。這是教材用的 K 棒完成門檻；來源未提供當時發布或到達本機的時間，故不是實際市場延遲保證，也不可用來證明某價格當時可成交。

## 品質檢查與缺口

兩日五檔均通過：60 根數量、每分鐘時間格、嚴格遞增、沒有重複／空值／非有限數、價格正值與 OHLC 包絡、無負成交量。各檔 `manifest.json` 記錄每項結果及檔案 SHA-256，合併資料為 `bars.json`，另有每檔 CSV。

**兩日五檔的 09:00 棒，來源 volume 全為 0。** 原值保留，已列於 `zeroVolumeTimestamps`，不能推論那一分鐘沒有成交，也不能稱成交量完整。量的單位維持 `provider-native`，未獨立核對；結構檢查通過不代表價格／量已獲交易所逐筆驗證。教材若比較開盤量、計算 VWAP 或重建成交，須另取得完整授權資料，不能以這批零值代替。

目前只有研究用候選資料；Yahoo 資料的收費教學展示、重播、再散布與保存權限未核定，**不自動部署到公開網站或付費教室**。Yahoo 官方說明也指出歷史資料下載功能有訂閱及資料授權限制。[Yahoo 歷史資料說明](https://help.yahoo.com/kb/finance/certain-amounts-sln2311.html)

## 官方與授權 API 調查

| 來源 | 查核結果 | 本次取得情況 |
| --- | --- | --- |
| 富邦 Historical Candles | 支援 `timeframe=1`；分 K 自 2023-05-23 起；單次日期區間少於一年，盤後 16:30 前更新；整股分 K 量為張。SDK 官方例需先登入取得行情權限。[官方文件](https://www.fbs.com.tw/TradeAPI/docs/market-data/http-api/historical/candles/) | 沒有登入、使用憑證或呼叫受授權保護的行情介面。文件範例不算已取得市場資料。 |
| 富邦 Intraday Candles / Trades | 日內 K 線可選 1 分鐘；成交明細提供時間／流水號、offset／limit，但文件未提供任意歷史日期參數。不能把 intraday trades 當成任意過去日期 tick 下載。[Candles](https://www.fbs.com.tw/TradeAPI/docs/market-data/http-api/intraday/candles/)、[Trades](https://www.fbs.com.tw/TradeAPI/docs/market-data/http-api/intraday/trades/) | 需要帳戶登入與行情權限，本輪未登入。富邦歷史分鐘 K 是之後正式串接的優先路徑。 |
| 富邦前置 | 需本人帳戶、憑證、API 聲明及連線測試；行情的課程使用和再散布權另待確認。[事前準備](https://www.fbs.com.tw/TradeAPI/docs/trading/prepare/) | 無 SDK 下載、無憑證搜尋、無登入、無交易。 |
| FinMind `TaiwanStockKBar` / `TaiwanStockPriceTick` | 官網列分 K 為 Sponsor、逐筆為 Backer／Sponsor 權限。[技術資料](https://finmind.github.io/tutor/TaiwanMarket/Technical/) | 以無授權資訊的正常 GET 各查一次 2330、2026-10-05，均回 HTTP 400，明示 free 等級需升級。原始拒絕回應與 SHA 已保存；沒有重試其他代碼以繞限制，沒有付費或使用其他專案金鑰。 |

相關官方頁面快照及 SHA 見 `source-snapshots.json`、`sources/`。富邦、FinMind 與 Yahoo 圖表說明快照皆 HTTP 200；Yahoo 歷史資料下載說明已由網頁查核工具讀得，但另存原始 HTML 時回 HTTP 503，保留的是錯誤回應，不能當作成功頁面快照。所有文件頁都只作規格證據；其中範例資料不會混入本包行情。

## 重現

`normalize.mjs` 只讀已保存的原始 bytes，先核 SHA 再產出兩日資料與檢查，不重新下載行情。`collect.mjs` 是原始採集腳本；若 raw 目錄已有檔案就拒絕重新抓取，避免覆寫本次證據，下一次採集應複製到新的日期目錄。`capture-sources.mjs` 保存此次使用的官方說明。
