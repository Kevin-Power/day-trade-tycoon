# 當沖大富翁

講師帶班的台股模擬教室：五堂課加一期末練習，支援個人帳號、班級進度、成交復盤與離線教材。所有下單均為模擬，實盤 adapter 與 API 維持不可送單。

本專案由 Windows 主機獨立執行，正式入口為 https://rich.yilutek.com 。登入、學員資料與課程操作不依賴 Grok。

## 功能與資料

- 教材週固定為 2026/08/24–08/26；第 1 課 30 分鐘，第 3 課 130 分鐘。
- 保留原站 24 檔教學自選與 1,979 檔搜尋目錄；只有具備該日教材 OHLC 的商品可加入模擬。
- 加權 5 秒資料與個股日 OHLC 為原站教材快照；個股分時、五檔與撮合為教學投影，不是逐筆行情。資料恢復來源見 `docs/source-recovery.md`。
- 共同入場碼由伺服器驗證；個人帳號以 email/password 登入。講師權限需主機核准，學生填班級代碼不能提權。
- 訪客與离線紀錄保存在瀏覽器；帳號提交的復盤保存在本機持久資料庫。模擬評分不是防作弊認證或獲利證明。
- 報名、費用與付款由教室核對；未接線上金流，不因註冊而表示已繳費。

## 維運

完整設定、啟停、備份與回復步驟見 `docs/self-hosting.md`。

```powershell
npm ci
npm run build
npm run typecheck
npm test
npm run lint
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\hosting\host.ps1 status
```

正式服務綁定 `127.0.0.1:8790`，透過專用 Cloudflare Tunnel 對外。資料與秘密保存在 Git 以外的 `%LOCALAPPDATA%\DayTradeTycoon`。發佈以 `scripts/hosting/stage-release.mjs` 建立不可覆寫的 release，再正常停止舊服務、選定新 release、驗證後啟動。

開發伺服器使用 `npm run dev`，只綁 `127.0.0.1:18790`。开发需明確設定自己的測試入場碼 hash；不能將正式秘密寫進 Git。

`vite@8.1.5` 與 `rolldown@1.1.0` 已固定，用來避開 Node SSR build 產生未定義 export 的已知問題；build 會檢查每個產出的 server module 語法。升級時必須再做真實 HTTP 與瀏覽器驗收，不能只看 build exit code。

## 學員教材

- 線上說明書：`/manual`
- 課程方案：`/license`（公開，價格與日期由講師確認）
- PDF：`npm run build:manual-pdf`
- 離線包：`npm run build:offline`，輸出 `downloads/daytrade-tycoon-offline.zip`

離線包不直接放在 public；下載路由要求有效的教室入場 session。包內只含教材與本機模擬，不含正式入場碼、帳號服務或資料庫。

## 驗證範圍

預設測試會列出實際 test files，避免 Windows shell 不展開 glob 而出現零測試。安全測試涵蓋角色、session ownership、不可覆寫、交易 rollback、cookie 驗證與 Windows 磁碟持久化。`scripts/hosting/auth-integration.test.mjs` 可在指定 `CLASSROOM_TEST_RELEASE` 下，以隔離資料庫進行真實 HTTP 登入、講師初始化與重啟測試。

`docs/feature-gaps.md` 保留舊版歷史盤點；目前服務狀態以接手紀錄與本機維運文件為準。

## 授權

給股文觀指教室使用。未另聲明則保留權利。
