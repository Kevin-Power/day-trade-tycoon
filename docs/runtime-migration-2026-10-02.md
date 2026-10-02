# Windows 排程與 runtime 搬移紀錄

日期：2026-10-02（Asia/Taipei）。執行者：本任務 root。

兩站已改由目前 Windows 使用者的排程啟動，runtime 放在 `C:\Users\kevin\YilutekServices`。本次啟動檢查兩個排程均為 Running，宿主回報 `launchMode = scheduled-task`、`healthy = true`。這是本次實際啟動結果；尚未經過主機重開機或登出驗收。

## 問題證據與判定界線

最初安裝的當沖大富翁登入排程實際執行以 exit code 1 結束。同一個 Windows 帳號由診斷排程啟動時，讀取第一站名義上的 `%LOCALAPPDATA%` runtime 路徑，找不到 `hosting.json`，出現 `ENOENT`。兩站的設定檔實際都位於 Codex MSIX 套件的 `LocalCache\Local` 路徑；第一站已實際證明 Codex 程序與排程程序看到不同的 AppData 檔案視圖。第二站一併修正相同目錄配置，未先以舊位置重現排程失敗。

這組證據能解釋本次排程的檔案查找失敗，因此修正為套件虛擬化範圍外的明確路徑。**它不足以判定之前的背景程序由誰或什麼機制終止**，不把兩件事合併宣稱已找到共同根因。

## 搬移方式與保留資料

1. 正常停止原 runtime，完成資料庫關閉與備份。
2. 以複製方式建立新 runtime，逐檔計算 SHA-256 核對來源與目標；原 runtime 保留並維持 stopped。
3. 保留原資料庫、應用秘密及登入秘密，未重新初始化資料或重建帳號。
4. 將專用 `cloudflared` 執行檔複製到各 runtime 的 `bin`，核對雜湊；tunnel 憑證放在各自的 `secrets`。
5. 更新兩個排程 action，明確指向新 runtime。排程仍使用同一 Windows 使用者及 `Limited` 權限，兩站不共用資料、秘密、port 或 tunnel。

| 項目 | 當沖大富翁 | 任真享生活預備站 |
| --- | --- | --- |
| 新 runtime | `C:\Users\kevin\YilutekServices\DayTradeTycoon` | `C:\Users\kevin\YilutekServices\RichmanAcademy` |
| 搬移前備份 | `2026-10-02T12-08-11-466Z` | `2026-10-02T12-09-38-438Z` |
| runtime 複製核對 | 5,929 檔，逐檔 SHA-256 相符 | 4,909 檔，逐檔 SHA-256 相符 |
| 本地位址 | `127.0.0.1:8790` | `127.0.0.1:8791` |
| 排程 | `DayTradeTycoonHost` | `RichmanAcademyHost` |
| 排程權限 | 同使用者、Limited | 同使用者、Limited |
| 本次排程狀態 | Running | Running |
| 宿主狀態 | `scheduled-task`、healthy | `scheduled-task`、healthy |
| 本次觀測 PID 集合 | `24680 / 29272 / 3220` | `36600 / 20568 / 28860` |
| 維運測試 | 14/14 PASS | 16/16 PASS |

檔案數與 PID 是本次核對的快照，不是永久識別碼。原 runtime 僅保留供復原核對，不能與新 runtime 同時啟動以免產生第二個 writer。

## 對外驗證與目前範圍

### 搬移後備份與排程重啟

- 第一站新 runtime 已完成正常關閉及 `2026-10-02T12-12-56-261Z` 備份，1,019 檔雜湊核對通過，包含收進 secrets 的專用 tunnel 憑證。
- 例行重啟驗收發現 named-pipe 已釋放時，舊排程可能仍為 Running；此時 IgnoreNew 會略過新啟動指令。helper 已改為等待 Ready 才送出啟動，期間持續檢查服務／維護擁有者與排程歸屬。
- 兩站更新後各有 12/12 排程狀態轉移測試通過。第二站實際執行一次 stop → backup → start，等待舊排程收尾後成功恢復 scheduled-task／healthy，外部 HTTPS 與 25 個資源再次通過。
- 第二站新 runtime 備份為 `2026-10-02T12-22-02-647Z`，1,324 檔雜湊核對通過。這些仍是本機備份，未宣稱已有異地資料庫備份。

當沖大富翁正式網址為 https://rich.yilutek.com ，使用 release `20261002T115142967Z`。最終 release 的隔離 HTTP 登入、owner 設定、學生權限及重啟驗收通過；公開站點 15 個首頁資源驗證通過。未授權 ZIP 下載回應 403，有效簽署請求下載回應 200，檔案為 827,610 bytes，SHA-256：

`897f433f35213573a1844246f4c287249cc06629cb5e5b72ee1149a5f0bee440`

任真享生活在 https://richman-host.yilutek.com 提供預備服務。25 個公開首頁資源驗證通過，`ownerInitialized = false`。行情使用 cached 模式，公開 tape 路由不觸發刷新。原正式網域 `richman.yilutek.com` 仍保留 Vercel CNAME `ec9fcbc1fdbe4a53.vercel-dns-013.com`，尚未切換。

## 尚未完成與運作條件

- 兩站正式 owner 都尚未初始化；使用者仍需自行完成私人設定入口的帳號密碼設定。本文件不包含初始化憑證或完整私人設定網址。
- 第二站舊會員、訂單與學習紀錄是否需要保留，尚待使用者答覆。新 runtime 啟動不代表舊站資料已搬遷。
- 目前是使用者登入排程，依賴主機開機、指定使用者登入及網路正常；不是登入前啟動的系統服務。
- 尚未實際重開機或登出驗證，不能將本次 Running／healthy 當作上述情境已通過。
- runtime 搬移與公開健康檢查不證明年長學員能獨立使用、課程教學成效或銷售成果。手機功能驗收另見 [mobile-teaching-2026-10-02.md](./mobile-teaching-2026-10-02.md)。
