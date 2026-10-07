# 當沖大富翁

講師帶班的台股歷史行情練習教室。交易練習統一使用 `/morning` 的來源已核對分鐘 K 線；舊生成情境停止啟動，歷史紀錄仍保留。所有下單均為紙上模擬，富邦 API 是後續串接方向，目前不能送出真實委託。

2026-10-07 真實 K 課程擴充：提供 10/05 與 10/06 兩個交易日，每日 5 檔、09:00–10:30，共 900 根已核對分鐘 K，按進度由伺服器揭露。六個新練習主題共用這兩日真實行情，可選交易日、保存各日進度與本輪主題。原有 10/06 lessonId 與學員進度保留；10/02、10/07 來源有缺分鐘而未開放。舊個股投影、模擬五檔與閃電下單不再從教室啟動。離線包只提供閱讀、固定委託示例、舊版復盤與連線進入真實教室的入口。最新變更與發布狀態見 [真實 K 課程擴充](docs/real-k-courses-2026-10-07.md)。

本專案由 Windows 主機獨立執行，正式入口為 [當沖大富翁](https://rich.yilutek.com/)。登入、學員資料與課程操作不依賴 Grok。

2026-10-05 已修正講師回饋讀取失敗後重試錯誤頁面的問題，正式 release 為 `20261004T210252925Z`，詳見 [回饋重試驗證紀錄](docs/feedback-retry-2026-10-05.md)。手機第一筆計畫草稿保留的前輪修正見 [草稿驗證紀錄](docs/plan-draft-2026-10-05.md)。

公開課程詢問表單與僅管理講師可見的收件區已上線，詳見 [詢問功能與驗證紀錄](docs/course-inquiries-2026-10-05.md)。業主目前尚無公開 LINE／電話／招生 Email，可先由網站收件；課程費用、日期與付款方式仍未確認，不代表已開放收費招生。

學員手冊為 8 頁，修訂 `2026-10-07-realk2` 說明交易日與主題選擇、計畫、逐分鐘回放、紙上委託及保存復盤流程；生成行情操作已撤除。排版與檔案核對見 `docs/pdf-source.md`。下列較早文件僅為歷史紀錄：`docs/reading-pace-2026-10-05.md`、`docs/instruction-feedback-2026-10-05.md`、`docs/mobile-teaching-2026-10-04.md`。

## 功能與資料

- 新真實課程共用 `src/lib/morning-exercises.ts` 六個主題；舊紀錄仍依 `src/lib/game/learning-path.ts` 的 `COURSE_PATH` 解讀。六組任務不等於承諾六堂課，實際堂數、日期與回饋安排由班級確認。
- 原教材週 2026/08/24–08/26 的生成情境已停止啟動，不可用日 OHLC 推算盤中 K。
- 真實練習股票限於目前教材 2330、2317、2454、2382、2308；不以舊 1,979 檔目錄冒充都有分鐘資料。
- 來源原件、時間與兩日共 900 根 OHLC，由 `scripts/verify-morning-source.mjs` 與 `scripts/prepare-morning-expansion.mjs --check` 在建置前核對；缺資料不補生成價格。原教材來源恢復僅保留歷史文件 `docs/source-recovery.md`。
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

離線包不直接放在 public；下載路由要求有效的教室入場 session。包內只含說明與歷史復盤介面，不啟動合成行情，也不含完整真實分鐘資料、正式入場碼、帳號服務或資料庫。

帶班前準備、人工入班、首次保存與回饋確認，依 [課程招生與入班準備包](docs/course-launch-kit.md) 執行。網站沒有線上結帳、自動對帳、付費席次或使用到期控制；建立帳號不等於完成報名。

內部 [首期小班方案草案](docs/first-cohort-offer-draft.md) 提供實際課程節奏、交付範圍、建議試辦價與成本試算，供業主定案；不代表公開售價或已開班。

## 驗證範圍

預設測試會列出實際 test files，避免 Windows shell 不展開 glob 而出現零測試。安全測試涵蓋角色、session ownership、不可覆寫、交易 rollback、cookie 驗證與 Windows 磁碟持久化。`scripts/hosting/auth-integration.test.mjs` 可在指定 `CLASSROOM_TEST_RELEASE` 下，以隔離資料庫進行真實 HTTP 登入、講師初始化與重啟測試。

`docs/feature-gaps.md` 保留舊版歷史盤點；目前服務狀態以接手紀錄與本機維運文件為準。

## 授權

給股文觀指教室使用。未另聲明則保留權利。
