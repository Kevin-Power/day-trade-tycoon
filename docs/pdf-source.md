# 學員 PDF 維護

`docs/pdf-source.json` 是八頁學員手冊的編輯來源。`scripts/build-manual-pdf.py` 負責 A4 排版，`scripts/build-manual-pdf.mjs` 在 Windows 選用本機 Python 並驗證輸出。

```powershell
npm run build:manual-pdf
node --test scripts/build-manual-pdf.test.mjs
```

產物固定為 `public/daytrade-tycoon-manual.pdf`，不需要網路、教室登入、開發伺服器或瀏覽器。程式先寫暫存 PDF，通過頁數與文字檢查後才取代正式檔案。

環境需要 Python、ReportLab 與 pypdf；本機 Codex bundled Python 會自動找到。其他環境可指定 `MANUAL_PDF_PYTHON` 或 `--python`。字型預設嵌入 Windows 微軟正黑體；可用 `MANUAL_PDF_FONT` 及 `MANUAL_PDF_FONT_BOLD` 指定本機 CJK TrueType 字型。

每次內容或版面修改後，需重新產生並用 Poppler 渲染檢視。特別核對課程的模擬分鐘數、費稅示例、入場／帳號區別、提交成功訊息與離線限制。費用、開課日期與付款方案未正式確認前，不加入虛構資訊。

2026-10-02 版共 8 頁；已逐頁檢視中文、表格、頁眉頁腳與留白，使用 pypdf／pdfplumber 驗證文字及頁數。現有 `--start`、`--url` 參數已移除，避免舊瀏覽器列印流程依賴登入狀態。
