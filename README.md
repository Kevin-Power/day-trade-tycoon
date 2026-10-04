# 當沖大富翁

講師帶班的台股模擬教室：依「入門操作 → 風險紀律 → 自主練習」三階段安排六組課程任務，支援個人帳號、班級進度、成交復盤、講師回饋與離線教材。所有下單均為模擬，富邦 API 是後續串接方向，目前不能送出真實委託。

本專案由 Windows 主機獨立執行，正式入口為 [當沖大富翁](https://rich.yilutek.com/)。登入、學員資料與課程操作不依賴 Grok。

2026-10-05 更新教學卡的收起／重看、盤中練習提示及服務停止保護，正式 release 為 `20261004T162056718Z`，已完成外網 HTTP、資產核對與新版維運程式的正常啟停／備份驗證。最新範圍與限制見 `docs/reading-pace-2026-10-05.md`；前輪下單結果與教材改善見 `docs/instruction-feedback-2026-10-05.md`；手機結算、逐筆成交與免費體驗重練流程見 `docs/mobile-teaching-2026-10-04.md`；視覺與學習功能的前輪紀錄分別見 `docs/interface-quality-2026-10-04.md`、`docs/product-release-2026-10-04.md`。業主目前尚無公開招生聯絡管道；課程費用、日期與付款方式亦未確認，不代表已開放收費招生。

## 功能與資料

- 課程名稱與三步練習指引共用 `src/lib/game/learning-path.ts` 的 `COURSE_PATH`；六組任務不等於承諾六堂課，實際堂數、日期與回饋安排由班級確認。
- 教材週固定為 2026/08/24–08/26；第 1 課 30 分鐘、第 3 課 130 分鐘均為模擬行情時間，不是授課時數。
- 保留原站 24 檔教學自選與 1,979 檔搜尋目錄；只有具備該日教材 OHLC 的商品可加入模擬。
- 加權 5 秒資料與個股日 OHLC 為原站教材快照；個股分時、五檔與撮合為教學投影，不是逐筆行情。資料恢復來源見 `docs/source-recovery.md`。
- 共同入場碼由伺服器驗證；個人帳號以 email/password 登入。講師權限需主機核准，學生填班級代碼不能提權。
- 訪客與離線紀錄保存在原瀏覽器；帳號提交的復盤保存在教室主機持久資料庫，可由同一帳號跨裝置查看。訪客紀錄不會自動加入帳號。
- 新版「我的學習」列出主機最近 40 盤復盤，可篩選已有回饋、查看最近的講師回饋及更新紀錄；練過課程與回饋份數只統計這 40 盤。已儲存練習總數另由主機累計，不能混稱所有統計都是最近 40 盤。
- 首頁操作足跡依目前裝置最近最多 30 份完整復盤計算；「下次只練一件事」亦保存在目前裝置與帳號，不會跨裝置同步。
- 新版講師工作台依姓名、課程與回饋狀態找復盤，另可篩選尚無保存紀錄的學員。回饋另存，不更動原始成交或成績；已留下回饋不代表學員已讀。模擬評分不是防作弊認證或獲利證明。
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

正式服務綁定 `127.0.0.1:8790`，透過專用 Cloudflare Tunnel 對外。資料與秘密保存在 Git 以外的 `%USERPROFILE%\YilutekServices\DayTradeTycoon`。發佈以 `scripts/hosting/stage-release.mjs` 建立不可覆寫的 release，先驗證待發佈版本，再正常停止舊服務、完成一致備份、選定新 release、啟動並驗證外網；詳見維運文件。

首位管理講師已完成初始化，日常使用應從正常登入入口進入，不重跑首次設定或發送初始化連結。密碼、入場碼、設定 token 與備份秘密均不得寫入 Git、招生文件或公開頁面。

目前使用登入後啟動的專用 Windows 排程。提供課程期間須保持主機開機、連網、使用者登入並避免休眠；不宣稱是開機前即可提供服務的全天候 Windows 系統服務。

開發伺服器使用 `npm run dev`，只綁 `127.0.0.1:18790`。開發需明確設定自己的測試入場碼 hash；不能將正式秘密寫進 Git。

`vite@8.1.5` 與 `rolldown@1.1.0` 已固定，用來避開 Node SSR build 產生未定義 export 的已知問題；build 會檢查每個產出的 server module 語法。升級時必須再做真實 HTTP 與瀏覽器驗收，不能只看 build exit code。

## 學員教材

- 免費體驗：`/try`（公開、不用帳號、不計正式成績）
- 線上說明書：`/manual`（教室入場後）
- 課程說明：`/license`（公開，價格與日期由教室確認）
- 講師工作台：`/teacher`（需登入、完成班級資料並有講師權限）
- PDF：`npm run build:manual-pdf`
- 離線包：`npm run build:offline`，輸出 `downloads/daytrade-tycoon-offline.zip`

離線包不直接放在 public；下載路由要求有效的教室入場 session。包內只含教材與本機模擬，不含正式入場碼、帳號服務或資料庫。

帶班前準備、人工入班、首次保存與回饋確認，依 [課程招生與入班準備包](docs/course-launch-kit.md) 執行。網站沒有線上結帳、自動對帳、付費席次或使用到期控制；建立帳號不等於完成報名。

## 驗證範圍

預設測試會列出實際 test files，避免 Windows shell 不展開 glob 而出現零測試。安全測試涵蓋角色、session ownership、不可覆寫、交易 rollback、cookie 驗證與 Windows 磁碟持久化。`scripts/hosting/auth-integration.test.mjs` 可在指定 `CLASSROOM_TEST_RELEASE` 下，以隔離資料庫進行真實 HTTP 登入、講師初始化與重啟測試。

`docs/feature-gaps.md` 保留舊版歷史盤點；目前服務狀態以接手紀錄與本機維運文件為準。

## 授權

給股文觀指教室使用。未另聲明則保留權利。
