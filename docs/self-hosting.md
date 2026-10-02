# 當沖大富翁：本機對外服務

應用部署在這台 Windows 主機，以正式 Node build 提供網頁，專用 Cloudflare Tunnel 將 `https://rich.yilutek.com` 轉送到 `127.0.0.1:8790`。不需要新增路由器或 Windows inbound 規則。網站可用性仍依賴本機開機、網路正常、使用者已登入且服務正在執行。

## 檔案與秘密

- 程式與維運腳本：本專案；build 產出 `.output/server/index.mjs`。正式發佈將整個 `.output` 複製到 runtime `releases/<build-id>`，再把 `hosting.json` 的 `appEntry` 指到 `releases/<build-id>/server/index.mjs`。保留上一份 release 供程式回滾，避免開發中的 build 覆寫已在服務的 assets。
- 可變資料根目錄：`C:\Users\kevin\AppData\Local\DayTradeTycoon`，在 Git 專案外。
- `hosting.json`：正式入口、8790 port、cloudflared executable、專用 tunnel config 的路徑。
- `secrets/app.env`：伺服器秘密。初始化不產生、也不顯示秘密。
- `secrets/tunnel.yml`：只屬於當沖大富翁的 tunnel ingress，結尾應有 `http_status:404`。不得共用或改寫 TAIFEX、波哥的 config。
- `data/pglite`：持久資料庫；`logs`：輪替日誌；`backups`：停機一致備份，含設定與秘密，因此也必須受保護。
- `state.json`、`service.lock`：服務狀態與鎖的紀錄。真正的互斥鎖為 Windows named pipe，由作業系統在程序死亡時釋放；啟動器不會根據殘留 PID 檔殺程序。不可在服務執行中手動移除這些紀錄。

`init` 將 runtime ACL 限定為目前使用者、SYSTEM、Administrators。啟動器只載入 runtime 的 `secrets/app.env`，不讀專案 `.env`，也不沿用 shell 的應用秘密。`HOST/NITRO_HOST` 固定為 loopback；`PORT/NITRO_PORT` 固定為設定中的 port；`PGLITE_DATA_DIR` 固定為 runtime `data/pglite`。

此部署與備份流程使用 PGlite，若 `DATABASE_URL` 有值會拒絕啟動。`app.env` 必需欄位：

```dotenv
BETTER_AUTH_URL=https://rich.yilutek.com
BETTER_AUTH_SECRET=<持續保存的至少32字元隨機秘密>
CLASSROOM_AUTH_ENABLED=true
CLASSROOM_TRUST_PROXY=true
CLASSROOM_GATE_PASSWORD_HASH=<入場碼的伺服器scrypt雜湊>
CLASSROOM_CODE=<班級代碼>
TEACHER_EMAILS=<核准講師Email>
ADMIN_SETUP_EMAIL=<首位管理講師Email>
ADMIN_SETUP_TOKEN=<一次性隨機初始化token>
```

不要把 `.env`、密碼、雜湊、Cloudflare credential/token 貼到聊天、Git 或公開頁。`TEACHER_EMAILS` 只加入已核准講師；後端同時要求其 email 已由可信流程驗證，學生自行註冊或填班級碼不能取得講師權限。`CLASSROOM_TRUST_PROXY=true` 僅適用目前 loopback 專用 Tunnel 架構，以 Cloudflare 傳入來源位址限速。不要為了啟動關閉登入驗證。請使用 Node 24 或更新且相容的版本。

首位講師使用 `/setup#token=...` 初始化，token 僅保存在本機私密設定，勿放公開文件。進入教室後，由講師自己輸入名稱及新密碼；初始化以同一資料庫交易建立帳號、講師身份與完成標記。成功後不可重用，公開註冊也不能搶先建立保留的管理 Email。未初始化前不得宣稱講師帳號已建立。

離線教材由 `/api/download/offline` 提供，需有效入場 cookie，禁止快取。檔案在 release 的 `downloads` 目錄，supervisor 自動設定 `CLASSROOM_DOWNLOADS_DIR`；不可搬到 public。測試網域舊靜態 `/daytrade-tycoon-offline.zip` 曾被 CDN 快取，已停用這個下載入口；舊快取僅含舊版公开教材，不含帳號或秘密。

## 啟動與檢查

在專案 PowerShell 中執行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\hosting\host.ps1 init
# 完成正式 build、runtime app.env 與專用 tunnel.yml 後：
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\hosting\host.ps1 start
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\hosting\host.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\hosting\host.ps1 stop
```

`start` 以隱藏背景程序啟動 supervisor，最多等候 95 秒本地健康檢查。app 回覆 `/api/health` JSON `ok:true` 或 `status:"ok"` 後才啟動 tunnel。`status` 的 `healthy` 代表本地應用健康；不保證 DNS、Cloudflare 或外部網路已驗證。正式切換前還要从外部網址實測頁面、登入、完整模擬流程與靜態檔案。

supervisor 監控 app 和 tunnel，app 異常時撤下 tunnel，失敗後有間隔重啟；每 5 分鐘最多 5 次恢復嘗試，超過便停止並留下日誌。每種日誌最大約 10 MiB、保留 5 份歷史檔。只有本次 supervisor 建立的 child process 可被終止，沒有依 process name 或陌生 PID 強制關閉的指令。8790 被其他程序占用時拒絕啟動。秘密值與常見授權 header 會在日誌寫入前遮蔽，仍請勿公開整份日誌。

停止順序是關閉專用 tunnel，再向 app 發送 IPC `{type:"shutdown"}`。資料庫關閉 hook 必須完成 flush 後回覆 `{type:"shutdown-complete"}`；收到確認才記錄 clean shutdown。30 秒未確認時會結束本次 app、標記 `stopped-unclean`，備份拒絕執行；需查明原因並完成一次正常啟停。不要使用工作管理員、`Stop-Process node` 或 `Stop-ScheduledTask` 代替正常停止。

## 使用者登入自動啟動

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\hosting\host.ps1 install-task
```

建立專用排程 `DayTradeTycoonHost`，以目前使用者、Limited 權限執行。此命令只安裝排程，不即時啟動，也不需要管理員權限。**主機開機但使用者尚未登入時不會啟動網站；登出可能中斷服務。** 不可把這個設定描述成全天候、不需登入的 Windows 系統服務。若要開機前即供應服務，需另外規劃有權限的 Windows service、專用服務帳號和資料權限。

```powershell
# 停止本服務並移除專用排程，保留資料、tunnel 與 DNS：
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\hosting\host.ps1 uninstall-task
```

不要更動 `TaifexPaperStack`、其他排程或現有 Cloudflared/Tailscale 程序。本機原有 `3000/3001/3002/8765/8766/8788` 服務與當沖大富翁無關。

## 停機一致備份

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\hosting\host.ps1 stop
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\hosting\host.ps1 backup
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\hosting\host.ps1 start
```

不能直接複製正在寫入的 PGlite 目錄。backup 取得互斥維護鎖，要求最近狀態為已確認資料庫正常關閉、8790 無 listener，然後複製 `data`、`secrets`、`hosting.json` 到 `backups/.staging-*`，逐檔核對 SHA-256 與大小，最後原子改名為時間戳資料夾並附 manifest。拒絕 symlink/reparse-point 檔案；出錯時不公布完整備份，staging 可保留供診斷。正常備份不覆寫原始資料，不自動刪除舊備份。

備份保存在同一台主機，無法防止整台主機／磁碟故障；正式課程運營需另存一份受保護的異地副本。任何副本均包含學員資料及秘密，應維持限制存取。

## 恢復

恢復是資料替換，先安排停機。先透過 `stop` 正常關閉服務，暫停專用 logon task 以免維護時自動啟動，確認 `status` 顯示 supervisor 沒執行且 8790 無 listener。若正在備份、其他 shell 正在操作或存在活的 `service.lock`，不得恢復。

1. 讀取選定備份的 `manifest.json`，逐檔重算 SHA-256 和大小，確認所有列出的檔案存在且無 symlink、路徑逸出或額外檔案。不要使用未完成的 `.staging-*`。
2. 將現有 `data` 重新命名為 runtime 內有時間戳的 `data.before-restore-*`；不要刪除。操作前確認兩個絕對路徑都位於本 runtime 下。
3. 將備份 `data` 複製到新的 runtime `data`。同一主機的回復通常保留目前 `hosting.json` 與 `secrets`，避免回復舊入口、舊密碼或舊 DNS；若是災難恢復，先審核後才恢复對應設定／秘密，且必須保留穩定的 auth secret。
4. 重新檢查資料 ACL、PGlite 目錄與專用 tunnel 路徑，啟動、檢查 `/api/health` 與實際登入和已有學員資料，再恢復專用排程。不要導入測試用資料庫取代學員資料。
5. 驗證失敗時正常停止，再還原 `data.before-restore-*`，保留故障證據與備份，不要強行忽略資料庫錯誤。

這套腳本刻意沒有一鍵覆蓋恢復指令。首次正式接受學員前，應在另一個隔離 runtime 完成一次備份恢復演練並記錄結果。

## DNS 切換與回滾

盤點時間：2026-10-02（Asia/Taipei）。切換前已確認：

```text
rich.yilutek.com CNAME 14c2250074a6dbcc.vercel-dns-013.com
Cloudflare proxy: 關閉（公開 DNS 直接回傳 Vercel CNAME）
```

先保存 Cloudflare 原紀錄的實際 type/content/proxied/TTL/id，再切換到本產品專用 tunnel 的 `<UUID>.cfargotunnel.com`；不能改整個網域、其他產品 hostname 或其他 tunnel config。本地健康確認與 tunnel 連線成功仍不足，切換後必須從外部 HTTPS 驗證。

需要回滾時，只把 `rich.yilutek.com` 的 DNS 紀錄恢复成保存的原 Vercel CNAME 與原設定，再從外部確認原站；保留本機資料與日誌。若新站已接受學員變更，回滾前要先處理資料分歧，因為 Vercel 舊站與本機資料庫不會自動同步。這份腳本不會自動改 DNS。

官方資料：[Cloudflare Tunnel DNS](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)、[Windows service](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/as-a-service/windows/)。
