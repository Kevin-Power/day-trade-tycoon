# 新版地端部署包 — 2026-10-09

後續發布狀態：使用者要求直接更新本機 Cloudflare 版本後，已於同日部署至正式 release `20261009T100824532Z`，詳見 [正式發布紀錄](deployment-2026-10-09.md)。以下「未切換」描述的是第一階段製作與驗證 ZIP 時的狀態。

使用者提供 `C:/Users/kevin/Downloads/day-trade-tycoon-onprem.zip` 作為參考。本次把「解壓即可啟動」的操作方式接到目前原始碼，以新版真實 K 線教室產生獨立 ZIP。正式站服務、排程、Tunnel、資料與秘密未切換；新版程式目前用於獨立地端包。

## 參考檔與保留範圍

原 ZIP SHA-256：`330f068fdd39a53d64e4374bedca07fb460dbe3dadf98ebcd5e6a1e24b3becca`。包含 117 個檔案、71 個伺服器 JS 模組，語法檢查及實際 import 路徑解析通過；這不代表舊版登入或資料保存已經過執行驗證。原件未修改，解壓與盤點在 `artifacts/onprem-reference-20261009/`。

| 項目 | 使用者提供的參考包 | 本次新版地端包 |
|---|---|---|
| 教材 | 2026/08/24–08/26 舊生成教材週 | 10/05、10/06 兩日 900 根來源已核對分鐘 K、六個練習主題 |
| 原始碼 | 已編譯 server/public，沒有可維護原始碼與測試 | 由現有原始碼、正式 build 與版本清單重新產生 |
| 網路 | 說明稱本機使用，啟動器實際設 `HOST=0.0.0.0` | `HOST` 與 `NITRO_HOST` 固定 `127.0.0.1` |
| 登入 | 舊 Grok/federation 設定仍在 bundle | 現有獨立 email/password、講師首次設定及權限驗證 |
| 首次設定 | 啟動器產生 auth secret；入場碼需外部提供 | 每份新教室生成自己的秘密、入場碼及一次性設定 token |
| 停止與備份 | 說明直接關視窗、複製 data | 正常停止需資料庫回覆；執行中禁止備份；逐檔核對後寫完成清單 |

未把舊生成行情、舊帳號或舊戰績覆寫到新版。地端包與學生下載的靜態離線教材是不同產物：地端包含完整私人伺服器行情資料與帳號服務，沒有加入正式網站的公開下載路由。

## 建置與使用

```powershell
npm run build:onprem
```

依序重建靜態離線教材、正式程式與部署包。輸出為 `downloads/day-trade-tycoon-onprem-<UTC時間戳>.zip`，每次使用新檔名，不覆寫舊包。ZIP 內無現成帳號、正式入場碼、正式資料庫、Tunnel credential 或其他正式秘密。首次啟動需要 Node.js 24 或相容的更新版本，不需要再安裝 npm 相依套件；建置工具產生的少量 `server/node_modules` 執行期檔案一併封裝。

1. 解壓 `DayTradeTycoon-OnPrem`，雙擊 `START.bat`，首次輸入管理講師 Email。
2. 待程式顯示「已就緒」，用 Chrome／Edge 開 `http://127.0.0.1:18787`。
3. 本包自己的入場碼及一次性設定網址位於 `data/首次使用.txt`；講師在首次設定頁自行設定密碼。
4. 停止時在啟動視窗按 Enter，等資料庫正常關閉及程式退出。
5. 停止後執行 `BACKUP.bat`。只有含 `backup-manifest.json` 且 `complete=true` 的資料夾代表備份完成。備份含私人資料與秘密，應另存受保護的異地副本。

Windows 的 `data` 與備份資料夾套用目前使用者、SYSTEM、Administrators 存取權限。既有 `data` 不會被初始化流程覆寫；設定損壞時會停止，不會悄悄生成新秘密。密碼、token 與資料均不會寫入程式版本清單。

啟動器不繼承 shell 的資料庫位置、auth secret、停用認證旗標或 Node 載入參數。`CLASSROOM_LOCAL_ONLY=true` 僅在明確的 `127.0.0.1` 網址、兩個 listener host 與 port 一致、未信任 proxy 且未設定外部 DB 時允許 production build 使用 HTTP cookie。原正式 HTTPS 行為仍為預設，沒有停用登入或入場驗證。

本包不開放跨機 HTTP。多人教室繼續使用 [HTTPS 正式部署流程](self-hosting.md)。`START.sh` 可供其他作業系統參考，本次只實測 Windows；沒有宣稱 Mac/Linux、Safari 或實體手機驗收完成。

## 驗證與證據

驗證涵蓋部署包完整性、秘密持久化與環境隔離、重複啟動互斥、執行中備份拒絕、正常停止和備份雜湊。整合測試使用從 ZIP 解壓的檔案，再複製到專案外的隔離目錄啟動，避免借用工作區相依套件或正式資料。

外部已安裝 Chrome 的 headless 驗證：入場 → 首位講師初始化 → 密碼登入 → 真實分鐘揭露 → 紙上成交 → 保存復盤 → 正常停止 → 再啟動 → 原 cookie 與原紀錄仍有效 → 停機備份。瀏覽器請求限制在測試 loopback；Google Fonts 連線被阻擋時改用系統字型，操作仍通過。桌機 1366×900、手機尺寸 375×812 另存截圖並檢查水平溢出。

證據：`artifacts/onprem-reference-20261009/validation/result.json`、`launcher.log` 與截圖；完整測試、建置及 HTTP 檢查日誌存放於同一稽核資料夾。

最終結果：

- ZIP：`downloads/day-trade-tycoon-onprem-20261009T060117698Z.zip`，8,727,449 bytes。
- SHA-256：`9eae730b1cc9805e8dc3c0a34569148f3fc3d26edcd7dbc964ab6b67b8596380`。
- 最終 ZIP 解壓後 170 個程式檔案雜湊通過；102 個伺服器 JS 模組語法檢查通過。
- TypeScript、修改檔 ESLint 與 diff 空白檢查通過；完整測試 542 項，540 通過、0 失敗、2 預設略過。
- 在最終解壓包另行實跑 3 項整合測試，全數通過：新地端包 Chrome 流程、既有正式 HTTPS 認證／講師與學生權限／重啟、真實分鐘揭露與紙上交易／重啟。兩個預設略過的整合測試已包含於這次實跑。
- Chrome 截圖 `desktop.png`、`mobile.png`、`restarted.png` 已檢視，無未處理的頁面例外；阻擋外網後依然能完成本機流程。字型請求會退回本機字型。
- 本機登入限速未信任 proxy，因此 Better Auth 記錄共用每路徑限速桶的警告；限速仍啟用，適用此包只允許同一台電腦的範圍。建置有既有離線 chunk 大小提示，沒有建置失敗。
- 隔離測試資料正常關閉後已清除，測試埠 18792、18796、18798 無 listener。正式 runtime 同一 instance `e9b07971-aaf1-45aa-b9e2-3707c97bb6ae` 維持本機健康、`restartCount=0`、`healthFailures=0`；未切換新版本。
