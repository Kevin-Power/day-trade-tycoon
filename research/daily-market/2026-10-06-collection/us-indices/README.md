# 美股四指數公開資料快照

採集日期：2026-10-06。完成時間（UTC）：2026-10-06T09:15:16.840Z。資料窗：2026-07-01～2026-10-05，未補入尚未取得的 2026-10-06 美股日收。

| FRED symbol | 指數 | 有效筆數 | 日期範圍 | 最後值 | 原始頻率標示 |
|---|---|---:|---|---:|---|
| DJIA | Dow Jones Industrial Average | 67 | 2026-07-01～2026-10-05 | 51267.90 | Daily, Close |
| NASDAQCOM | NASDAQ Composite | 67 | 2026-07-01～2026-10-05 | 27477.310 | Daily, Close |
| SP500 | S&P 500 | 67 | 2026-07-01～2026-10-05 | 7773.95 | Daily, Close |
| NASDAQSOX | PHLX Semiconductor | 67 | 2026-07-01～2026-10-05 | 13172.74 | Daily |

- 原始 CSV、來源 HTML 與 SOX 官方定義檔置於 raw/；manifest.json 保存請求 URL、抓取時間、HTTP 狀態、位元組數、SHA-256 與來源限制。observations.json / observations.csv 是逐筆整理結果。
- symbol 使用 FRED 命名空間；NASDAQSOX 對應 Nasdaq 發布的 SOX 價格報酬指數，不是 ETF，也不是含股息的 XSOX。
- SOX 的 FRED 頻率只有 Daily，因此保留 daily-index-value 標籤。Nasdaq 方法文件說明收盤值可因成分價格修訂而更新至美東 17:15；本快照沒有逐筆發布時間，也沒有 OHLC，不能宣稱每筆在美東 16:00 已固定。
- 日期保留來源交易日期。availableAt 全為 null；fetchedAt 只代表本次取得時間。最新系列頁的 Updated 標籤不是逐筆歷史可得時間，資料可能事後修訂。
- 原始缺值日：2026-07-03、2026-09-07。空白或點號保留為缺值，不視為零、不補前值；數值零若出現會保留為零。
- 尚未計算 EMA11、小馬判斷或交易訊號，日 K 價格設定與初始化方式待課程契約確認。
- 所有系列頁標示版權及預先許可要求；此資料夾為本機研究佐證，公開下載不等於取得整批資料商用再散佈權利。尚未发布為課程下載或網站資料源。

## 官方來源

- [Dow Jones Industrial Average](https://fred.stlouisfed.org/series/DJIA) — S&P Dow Jones Indices LLC，FRED 官方轉載。
- [NASDAQ Composite](https://fred.stlouisfed.org/series/NASDAQCOM) — Nasdaq, Inc.，FRED 官方轉載。
- [S&P 500](https://fred.stlouisfed.org/series/SP500) — S&P Dow Jones Indices LLC，FRED 官方轉載。
- [PHLX Semiconductor](https://fred.stlouisfed.org/series/NASDAQSOX) — Nasdaq, Inc.，FRED 官方轉載。
- [SOX price-return 版本定義](https://indexes.nasdaq.com/docs/Index_Versions_SOX.pdf)
- [SOX 計算與收盤修訂時段](https://indexes.nasdaq.com/docs/methodology_SOX.pdf)
- [Nasdaq SOX 歷史頁](https://indexes.nasdaq.com/Index/History/SOX)

## 重跑

以 Node 執行此資料夾 collect.mjs 會重新擷取同日期窗並覆寫快照，fetchedAt 與 SHA 可能改變；若要保存新的 vintage，先複製到新的採集目錄。腳本不讀取金鑰、不呼叫應用程式或正式 runtime。checksums.sha256 包含其自身以外所有成果的 SHA-256。

## 10 月 6 日盤前盲練的時間限制

課程 cutoff：2026-10-06T09:00:00+08:00。本包僅作歷史參考，尚未納入嚴格盤前可用名單。

| 系列 | 原頁 sourceUpdatedAt | 換算台北時間 | 原頁更新早於 cutoff | 嚴格可用性 |
|---|---|---|---|---|
| DJIA | 2026-10-05T17:02:00-05:00 | 2026-10-06T06:02:00.000+08:00 | 是 | 未驗證 |
| NASDAQCOM | 2026-10-05T22:38:00-05:00 | 2026-10-06T11:38:00.000+08:00 | 否 | 未驗證 |
| SP500 | 2026-10-05T19:01:00-05:00 | 2026-10-06T08:01:00.000+08:00 | 是 | 未驗證 |
| NASDAQSOX | 2026-10-05T22:44:00-05:00 | 2026-10-06T11:44:00.000+08:00 | 否 | 未驗證 |

NASDAQCOM 與 NASDAQSOX 原頁更新已晚於 09:00，因此不得因前一美股交易日收盤就推定它們盤前已在 FRED 可得。另兩系列原頁更新較早，仍沒有逐筆 first-publication/vintage 佐證。NASDAQCOM 的 2026-09-07 整列未出現在原始 CSV，另三系列同日有空值列；整理保留原貌，不自行增加或補齊。

再次整理既有原始檔可加 --normalize-only，會核對原始 SHA、保留原 fetchedAt，不重新請求來源。
