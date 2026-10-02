# 原站教材恢復紀錄

2026-10-02 接手時，Git main 為 `57b2286`，較接近線上功能的歷史分支為 `36b5181`，兩者均非完整的線上部署原始碼。使用 main 保留授權、來源標示與離席保護，選擇性移植課程、帳號、講師及復盤功能，並重建獨立認證與持久資料庫。使用者已確認尚未正式招生，可用新教室開始；沒有搬移舊站帳號或班級成績。

24 檔教材清單、1,979 檔名称目錄和教材週 OHLC 從使用者原站公開 JavaScript 的靜態 literal 抽取，沒有執行下載的程式碼。對應目前 `symbols.json`、`real-paths.json`、`catalogue.json` 與 `catalogue-days.json`。這是原站資料保全，非新增獨立行情校驗。

- 來源：https://rich.yilutek.com/assets/charts-BqjeDalj.js
  - SHA-256：`312a34517d96b3a28e1afac1921ae24f7ded13b195d710a082d2af1b7913f170`
- 來源：https://rich.yilutek.com/assets/week-C42yQZmR.js
  - SHA-256：`64c31418043a68ffd8783273a30bd0596051ed46143b9d43f97d0080106efa75`

原站個股日 OHLC 與名稱標示來自 TWSE/TPEx/FinMind；盤中個股路徑、量、五檔與撮合仍為教學生成，不能稱作逐筆行情。新增搜尋股票只重建投影價格歷史，不重算帳戶或成交，加入前歷史成交量顯示為 0。

原始 Git 分支和 `artifacts/live-snapshot` 留作本地證據；快照與原站生成程式不納入正式 public 資產。
