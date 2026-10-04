# 講師回饋讀取重試

2026-10-05 發布。修正一份復盤已有超過一頁回饋時，「更新回饋」失敗後按「重試讀取回饋」，卻改成讀較早頁面的問題。這會讓錯誤消失但漏掉講師最新的下次練習建議。

## 行為與證據

失敗狀態現在保留原請求的游標：更新最新時為空，較早頁則為原游標。重試沿用原請求；已顯示內容保留，成功後才清除錯誤。回饋寫入、權限與原復盤不變；帳號／復盤／角色變更仍完整卸載原面板，舊回應仍受取消及 mounted 檢查。

- 修正前測試重現 2 項失敗。新增 4 項實際元件 handler／effect 測試，涵蓋初次讀取失敗、更新最新失敗、有游標的較早頁失敗及身份／卸載隔離；修正後全部通過。不是複製請求邏輯的測試。
- 全套 510 項測試通過；TypeScript、修改範圍 ESLint、diff whitespace 通過。正式與離線 build、94 個 server modules 語法檢查通過。
- 外部 Chrome 390px 配合隔離 HTTP／PGlite：先存 12 則歷史回饋，更新時在主機新增第 13 則並刻意回傳一次 502。舊 release `20261004T204510264Z` 重試帶了較早游標，錯誤消失但最新內容缺漏；新版重試不帶游標，最上方出現第 13 則最新建議。
- 另一輪較早頁請求刻意失敗後，重試的完整 payload 與原請求相同；最新及最舊內容均可見。新舊比較的請求摘要留在忽略目錄 `tmp/feedback-retry-before.json`／`tmp/feedback-retry-after.json`。
- 320px 長輩模式回饋段落 22px、更新按鈕 56px；回饋區 clientWidth／scrollWidth 均為 271px。手機驗收畫面 `artifacts/feedback-retry-2026-10-05/mobile-latest-feedback.png` 僅含虛構測試資料。
- Chrome 尺寸已恢復；兩輪隔離服務正常停止，DB shutdown acknowledgement 為 true。正式學員資料未加入測試回饋。

UI 使用候選 `20261004T205933998Z`。初次正式外網檢查發現其受保護離線下載仍是前一包：原因為正式 build 複製離線包後才重新 build offline。重新複製 runtime assets 並建立 immutable release `20261004T210252925Z`；manifest 比較確認 151 檔中僅離線 ZIP 改變，應用及 UI 資產完全一致。最終候選再通過真實 HTTP 權限、回饋、詢問及重啟驗證；維運文件補上正確建置順序與 stage 前的 ZIP 雜湊檢查。

## 最終正式狀態

切換前正常停止、`lastCleanShutdown: true`，一致備份 `backups/2026-10-04T21-03-19-264Z`，1032 檔核對通過。本輪第一份備份 `backups/2026-10-04T21-01-47-781Z` 亦保留。

正式 release `20261004T210252925Z`，instance `29cdb771-6856-4b3b-b533-31fb41ecdd79`，專用排程啟動，healthy、healthFailures 0、restartCount 0。外網 health／體驗 200；空詢問 400、私人詢問 403；原下載保護有效。28 個正式引用資產 SHA-256 與驗證 build 一致；券商下單仍為 501。

- 最終 ZIP 913000 bytes，SHA-256 `f5aafa0723c98f8966e8130293817bf57f48c57707b5a96bf2cedc09553018a3`，正式下載核對通過。
- PDF 未修改，版本 `2026-10-05-r2`，SHA-256 `9cfde3658a6c96f72c2c7993c4e60fdbb6bb0526969115d1debc85a69cc07507`。

本輪沒有實體手機、iPad、Safari 或真人教學驗證。手機學員是否看懂回饋、能否在隔日自行重做，以及招生需求與成交，仍需實際帶班人及試教安排；不能以技術測試代替成效。
