# 10/27 富邦唯讀驗收：主機就緒檢查

檢查時間：2026-10-24 08:59–09:07，Asia/Taipei。結論：目前主機、排程設定、正式服務與本人登入畫面均就緒；已修正隱藏的無人操作睡眠逾時。10/27 實際定時觸發、盤中新資料、重連與整日覆蓋仍待當日驗收。

## Windows 電源與時間

作用中的電源計畫為 `Remote High Performance`，GUID `098757a5-3f76-4399-95c8-dfd2b734007c`。

| 項目 | 檢查前 AC／DC | 檢查後 AC／DC |
| --- | --- | --- |
| 一般閒置睡眠 `STANDBYIDLE` | 0／0 秒 | 0／0 秒，未修改 |
| 螢幕閒置關閉 `VIDEOIDLE` | 0／0 秒 | 0／0 秒，未修改 |
| 無人操作喚醒後睡眠 `UNATTENDSLEEP` | 120／120 秒 | **0／0 秒，已修改並重新啟用同一計畫** |

三項的 0 表示不因該閒置計時器進入睡眠／關閉螢幕。無人操作喚醒使用獨立逾時，所以只確認一般睡眠設定仍不足；本次兩次寫入與重新啟用皆 exit 0，並完整讀回確認。[Microsoft 無人操作睡眠說明](https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/sleep-settings-sleep-unattended-idle-timeout)

本機支援 Modern Standby；休眠逾時 `HIBERNATEIDLE` 原為 0 且未改動，不能單憑此數值宣稱所有休眠路徑皆停用。電源鍵、睡眠鍵、闔蓋動作仍保留原設定；未停用手動睡眠、休眠或關機。`powercfg /requests` 需要提高權限，因此未完成該項讀取，未嘗試提權；不影響上述設定寫入與讀回證據。

目前偵測為外接電源，沒有系統電池。Windows 時區為 Taipei Standard Time，時間來源為 `time.windows.com,0x9`，此次檢查的最後成功同步為 10/24 05:12；未修改系統時間。Windows Update 與 servicing 的待重新啟動旗標皆為 false，作用時間 07:00–01:00；未停用更新或變更其政策。以上是當下狀態，無法保證日後不會出現更新、斷電或網路中斷。

原始與讀回記錄位於 `artifacts/fubon-host-readiness-2026-10-24-0900/`：`power-plan-before.txt`、`sleep-before.txt`、`sleep-after.txt`、`display-before.txt`、`buttons-before.txt`、`windows-context.json`、`time-sync.txt`。

如日後要恢復本次唯一改動，可把同一計畫的 `SUB_SLEEP UNATTENDSLEEP` AC／DC 分別設回 120，再啟用該計畫。本次未執行恢復，未新增模擬鍵盤／滑鼠的常駐程式。

## Codex 排程

- 既有 heartbeat `10-27`「富邦 10/27 盤中唯讀整日驗收」仍為 ACTIVE，週二 08:50，本次目標日期為 2026-10-27；沒有重複建立排程或變更時間。
- 已由 app 的 automation view 成功讀取；設定檔與本機時區一致。目前桌面主程序 `ChatGPT.exe` PID 20316 運行中，啟動於 10/23 05:42。程序名稱不同於產品介面名稱，不用單看 `codex.exe` 判斷桌面是否開啟。
- 現有提示仍要求 08:55 collector、09:00–13:30 覆蓋、10:30 僅中斷驗證 socket、13:35 收尾後暫停；首輪改為每 15 分鐘接續。僅新異常、有意義變化、完成或需本人處理時通知。
- 實際 10/27 定時派送尚未發生；本次沒有把設定存在或 app 正在運行當成準時觸發的測試證據。收據 `artifacts/fubon-host-readiness-2026-10-24-0900/codex-schedule.json`。

本機排程需要電腦開機、app 運行與專案目錄可存取。[OpenAI Docs：排程條件](https://learn.chatgpt.com/docs/automations?surface=app)

## 正式行情與下單封鎖

- 正式版本仍為 `20261024T002006781Z`，sealed baseline 相符：316 檔、無新增 pycache，tree SHA256 `2fa65932e965446306d08b8882f898667e0a55c34e50e9d5e3c82630a639de5b`。
- 正式健康檢查 200、匿名行情 403、私有 worker 網址 404。supervisor、app、tunnel 三程序存活；健康失敗與此次啟動以來的重啟計數皆 0。沒有為本次檢查重啟服務。
- Windows task `DayTradeTycoonHost` 為 Running；`0x41301` 表示正在執行。這是登入觸發的服務監督排程，與 Codex 08:50 heartbeat 分開；沒有 NextRunTime 是登入觸發的正常結果。
- 該 task 需要本人 Windows 互動式登入，執行不逾時、重試 3 次／每次間隔 1 分鐘、忽略重複啟動。`WakeToRun=false`，不會喚醒已睡眠的電腦；沒有改成登出後的背景服務或新增登入憑證。
- collector 離線 dry-run 通過，Python／worker／既有憑證檔存在，工作區與正式 worker 相同；沒有啟動新的驗證券商連線。離線檢查不能證明當日券商登入或訂閱會成功。
- 外部 Chrome 重新載入正式網址後，本人登入狀態仍有效，自選 2330／2317／2454、台積電完整五檔與「行情連線正常」均確認。資料為 10/22 13:30 收盤值，頁面正確保留收盤／資料未更新提示；週六檢查不計為盤中新成交或五檔跳動。
- 畫面明示「真實下單已封鎖」；正式編譯路由仍固定回應 `LIVE_LOCKED`／501。全程未送實際或測試委託，國票未啟用。

正式預檢與離線收據：`artifacts/fubon-readiness-2026-10-24-0900-summary.json`、同 prefix 的 `-preflight.json`、`-dryrun.json`、`-host-v2.json`。初次 host 序列化因登入觸發的空 NextRunTime 產生無效 null 收據，原件保留，摘要明示只採用另存的 v2；沒有覆寫失敗紀錄。本人畫面與截圖：`artifacts/fubon-host-readiness-2026-10-24-0900/production-ui.json`、`production-ui.png`。

## 10/27 執行條件

保持外接電源、網路、Windows 本人登入及 Codex 運行，不登出、手動睡眠或關機。08:50 依 `docs/fubon-session-acceptance-2026-10-27.md` 再確認電源計畫／自動睡眠、主機健康、時區與 sealed release；若晚啟動或漏採樣，保留缺口並據實標記，不補寫盤中證據。若本人網站 session 到期，請本人重新登入，不代取密碼或匯出 cookie。
