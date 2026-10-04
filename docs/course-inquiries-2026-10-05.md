# 課程詢問與管理講師收件

2026-10-05 發布。業主尚未提供可公開招生聯絡方式，因此由正式網站接受學員主動詢問，管理講師在原教室查看；沒有公開私人管理 Email，也沒有建立 LINE、寄信或傳送招生訊息。

## 使用流程

- 公開入口：`https://rich.yilutek.com/license#course-inquiry`，免費體驗結束後亦可前往。不用入場碼或帳號。
- 稱呼可用暱稱；聯絡方式為 Email 或電話擇一，加上裝置、操作協助、詢問內容與未預勾的同意欄位。一般表單 16px、主要觸控目標至少 48px；長輩模式沿用全站放大設定。
- 失敗時保留目前頁面草稿；結果不明時鎖住原內容，以同一個 requestId 重試。成功回覆後才清空。內部離頁與重新整理有未確認草稿提醒；不將個資寫入 localStorage。
- 管理講師登入「講師工作台 → 課程詢問」，切換新的／已處理／全部詢問，每頁 20 筆。可標記已處理或重新開啟，不含自動通知或自動聯絡。
- 詢問與管理狀態不代表訂單、聯絡回條、已報名、已付款或保留名額。沒有公告售價、日期、回覆時限或新增繳費資格。
- 離線包僅連到正式站表單。PDF 修訂為 `2026-10-05-r2`，第 2、10 頁同步入口。

## 資料與權限

`0006_course_inquiries.sql` 為新增資料表及索引，不刪改學員帳號、復盤或回饋。詢問位於原受保護資料庫與一致備份，未加入班級 CSV。沒有自動刪除、公開查閱、查詢者自行刪除或行銷訂閱功能；業主仍須確認保留期限與停止聯絡／刪除要求的人工處理方式。

只有 `classroom_admin_setup(id=1).user_id` 對應的已驗證管理講師可讀寫收件區；每次重新核對 DB 的 emailVerified、teacher 角色與教學聲明。一般講師、學員、只有入場碼的訪客均被拒絕。公開 POST 僅精確 `/api/course-inquiries` 與 POST 方法豁免 gate，GET/PATCH 仍有 gate 和 owner 權限檢查。

請求須符合設定的 canonical Origin 與 JSON，body 最多 8 KiB／5 秒。公開提交每來源 5 次／10 分鐘、整體 100 次／小時，最多 8 個處理中請求；限制在單一 app process 記憶體內，重啟重置，不等於分散式防機器人服務。DB 交易鎖確保同 requestId 同內容只存一筆，不同內容回 409，匿名只拿到 ok/id，不回傳原個資。最多 2000 筆待處理、10000 筆總詢問；滿額不自動刪資料，原筆精確重試仍可確認。回應 no-store，不寫入詢問內容至應用日誌。

## 驗證範圍

- 全套既有 488 項測試通過；另新增詢問 11 項測試通過。全專案 TypeScript、修改 TypeScript／TSX 範圍 ESLint、diff whitespace、正式與離線建置通過。94 個 server modules 語法檢查通過。
- 真實 PGlite 測試包含未初始化 owner、verified 一般講師拒絕、owner 驗證／角色／聲明撤回、參數化文字、並行冪等、分頁、處理狀態、2000／10000 容量競爭、body streaming／UTF-8／逾時取消與來源／全域限速。
- 最終候選 `20261004T203203228Z` 的隔離 HTTP 測試通過：公開提交、驗證拒絕不新增資料、無 gate／僅 gate／學生拒絕讀寫、同 UUID 並行重試、409 衝突、21 筆分頁、處理狀態、來源限速與重新啟動後保存。verified 一般講師拒絕屬前述 SQL 測試覆蓋，未新增該角色的 HTTP 登入 fixture。
- 外部 Chrome 使用 loopback fixture 與虛構資料驗證：390px 手機空表單首錯 focus、提交已入 DB 後刻意斷線、原內容鎖定及重試成功才清空；owner 看到恰好一筆，標記處理與重新開啟正常。320px 長輩表單與收件區、820px 平板收件區、1440px 桌機表單均無橫向溢出；320px 長輩欄位文字 22px、主要按鈕約 63px。電話欄位及草稿離頁留在本頁／離開皆驗證。瀏覽器尺寸已恢復。
- UI fixture 使用前一候選 `20261004T202827013Z`；最終候選只變更等價的控制字元檢查及格式整理。最終候選另經前述 HTTP 驗證和正式站畫面核對。沒有將虛構詢問提交到正式資料庫。
- 正式外網檢查：health 200，公開體驗 200、詢問空 body 400 且不發 cookie、未入場查閱詢問 403、原下載保護有效；28 個引用資產 SHA-256 與 build 相同。券商 endpoint 仍 501，無實盤送單。
- 正式 Chrome 確認可見詢問表單；畫面 `artifacts/course-inquiries-2026-10-05/public-form.png` 保存在忽略目錄。Console 有 `Access to storage is not allowed from this context` 訊息，其中一筆來源為 Chrome extension content script；本輪不宣稱 console 全無錯誤。表單與下載操作完成，未變更瀏覽器擴充功能。
- PDF 變更的第 2、10 頁已渲染檢視；正式 `/manual` 的下載按鈕為 `?v=2026-10-05-r2`，外部 Chrome 實際下載檔 SHA-256 與來源一致。沒有測試實體 iPhone、iPad 或 Safari，也沒有真人學習成效／招生轉換證據。

## 正式發布

先正常停止原服務並確認 `lastCleanShutdown: true`，一致備份 `backups/2026-10-04T20-33-09-703Z` 共 1025 檔驗證通過，再切換 151 檔 immutable release `20261004T203203228Z`。前版 `20261004T164619591Z` 保留；資料 migration 為新增表，回退應用時保留詢問表，不降版或清除 DB。

專用排程啟動成功，instance `51addb28-b06a-45e2-8226-b645a425e366`，healthy、healthFailures 0、restartCount 0。Runtime 仍在 `%USERPROFILE%\YilutekServices\DayTradeTycoon`，主機須保持開機、連網、使用者登入。

- PDF 440174 bytes，SHA-256 `9cfde3658a6c96f72c2c7993c4e60fdbb6bb0526969115d1debc85a69cc07507`。
- 離線 ZIP 912635 bytes，SHA-256 `027acf531bc202ddc8cde9527b1c3be072a305d67dcefae63d408a45b808006c`。

入口已可接受主動詢問；回覆人力、定價／開課安排與真人首次及隔日試教仍待落實。技術驗證不能當作產品已能大賣或學員交易能力已提升的證據。
