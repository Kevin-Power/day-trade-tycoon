# 真實早盤教材擴充：2026-10-05 可用，10-02／10-07 缺來源

這批只新增 `server/data/morning-2026-10-05.json`：台積電 2330、鴻海 2317、聯發科 2454、廣達 2382、台達電 2308，每檔 09:00–10:29 共 90 根原始分鐘 K，最後一根完成於 10:30，合計 450 根。既有 10/06 的 450 根教材未修改；合計兩個可用交易日、900 根。

10/05 分鐘來源直接取自已保留的 `2026-10-06-collection/intraday/raw/` Yahoo 原檔；既存請求紀錄與 SHA-256 均核對。昨收與前五日均值使用 `2026-10-06-strategy-supplement/daily-prices/raw/` 中保留的 TWSE 官方日價，依欄名讀取，採 09/24、09/29、09/30、10/01、10/02，沒有使用 Yahoo 多日期回應的整段昨收欄位。日資料只用於先前收盤參考，不代表官方逐分鐘驗真。

| 未開放日期 | 原始缺口 | 處理 |
|---|---|---|
| 10/02 | 聯發科 2454 的 09:45、09:51、10:01，OHLCV 均為 null | 整份五檔教材不產生、不開放 |
| 10/07 | 台積電 2330 的 10:07、聯發科 2454 的 09:42，OHLCV 均為 null | 整份五檔教材不產生、不開放 |

10/07 只做五個有界 Yahoo 請求，每檔一次，15 秒逾時、不重試、未使用券商憑證，沒有新增 TWSE／TPEx 請求。原始回應即使在指定時窗外另帶 13:30 資料，也只保存為私有來源證據，不放入教材。來源缺根不插值、不複製前價、不以日 OHLC 推算，也不為湊齊五檔而事後更換標的。

分鐘量保留原值（包括零），但量單位與完整性未核對，`volumeVerified=false`，不顯示量柱、VWAP 或量能訊號。10/05 當日盤前背景與影音未蒐集，catalog 明示缺資料，未沿用 10/06 的背景。所有保存資料均為事後取得，不聲稱當時盤前可得。

可重跑的離線命令（不連網）：

```powershell
node scripts/prepare-morning-expansion.mjs --check
node --experimental-strip-types --test scripts/prepare-morning-expansion.test.mjs src/lib/morning-expansion-source.test.ts
```

不加 `--check` 才會重建新教材及本目錄的 `verification-report.json`。檢查會先鎖定既有 10/06 教材雜湊，並要求缺來源日期不存在 server dataset；`--check` 通過代表「可用／不可用」報告與原始證據一致，不代表所有候選日期都可用。

`collect-yahoo.mjs` 是本次一次性採集紀錄的重現說明，有既存 requests 或 raw 時拒絕再抓／覆寫。新增資料批次應使用新目錄，不能覆蓋本次證據。根目錄 `.gitattributes` 僅對本次新 raw、JSON 與 server 教材停用文字換行轉換，保留 byte SHA。

未揭露的完整教材、raw 與報告不得搬到 public、前端 bundle 或離線下載包。本次檔案產生與來源測試不代表已部署；可用課程目錄、權限與伺服器逐分钟揭露由主線整合驗收。
