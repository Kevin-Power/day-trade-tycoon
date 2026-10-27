# 富邦入口修正 — 2026-10-27

## 依據

- 10/27 上線 `20261027T083942079Z` 時，候選版 22 項 QA 有 5 項沒過，原因都出在業主專用的「富邦唯讀行情」入口（`FubonEntry`）。10/24 版也一樣失敗（見 `docs/mini-jiangbo-zoom-2026-10-27.md`）。
- 使用者：「好，富邦入口照你說的修」，之後說「好，跑完直接上線並推送」。
- 和「個股資訊」工作階段（正式下單功能開發）協調過：它沒有在改 `FubonEntry`。它接下來會改 worker、`fubon-feed.server.ts`、`quotes.ts`、hosting 腳本和 `FubonReadOnly` 版面，這些這次都沒動。

## 改法

- **連結收進頂端工具列**：
  - `FubonEntry` 移到新檔 `src/components/fubon-entry.tsx`，`DeskBar` 在「教材」後、「標準／大字」前顯示它。樣式是 `td-tool`，和「教材」一樣，觸控版 44px（大字 56px）。
  - 不再自己佔一列（`PageFrame` 的那一列已拿掉），所以矮螢幕電腦的圖表不會被壓矮。
  - 電腦版寬度不到 1280px 時只顯示圖示（28px），1200px 寬的工具列才放得下；名稱在 `aria-label` 和滑鼠提示裡。
  - 在富邦頁（`?feed=fubon`）本身不顯示。
- **學員和訪客不再碰券商介面**：
  - 新的 `fubonEntryAllowed`（`src/lib/broker/fubon-entry.ts`）：訪客和未登入的人什麼都不問；登入的人先讀自己的角色；只有教師帳號才問 `/api/broker/quotes?access=1`。驗證過的業主一定是教師帳號。
  - 任何錯誤都只是不顯示連結。
  - 伺服器端的業主檢查完全沒改，`/api/broker/quotes` 仍只給業主。

## 驗收

- **單元測試** `fubon-entry.test.ts` 4 項，先失敗（模組不存在）再通過。全套 983 項：979 通過、4 跳過、0 失敗。`test:broker` 53/53，型別檢查 0，eslint src 0 errors（5 個既有 warnings）。
- **QA 腳本**：
  - `desk-premium`：業主連結必須只有一個，而且在 `.td-bar` 裡；除了業主的 access 檢查（至多 2 次），不得有其他券商請求。
  - `desk-guest`：訪客不得送出任何券商請求。
  - 兩者都先在當時的正式版 `20261027T083942079Z` 上確認失敗：訪客送出多次 `quotes?access=1`；連結不在工具列，觸控版 19px。
- **第一次完整 QA**（開發建置）21/22：1200px 寬時「大字」被擠出畫面。改成窄電腦只顯示圖示後修好。
- **候選版 `20261027T095219655Z`**（315 檔）：
  - 富邦隔離 HTTP 檢查 12/12（下單仍 501）；
  - 整合測試 4/4；
  - 用候選版開三間教室跑完整 22 項，全部通過，包括原本失敗的 premium、premium-flat、layout、sharpness、江波 6b。

## 切換

- 切換前確認正式站是 `20261027T083942079Z`，服務健康。
- 備份 `backups/2026-10-27T10-02-14-548Z`：1,062 個檔案，逐檔核對通過。只改 `hosting.json.appEntry`。
- 10:02Z（台北 18:02）上線：**`20261027T095219655Z`**。
- 公開檢查全部通過：
  - 各頁 200，教室 API 未入場 403；
  - `/morning?feed=fubon` 200，匿名 `/api/broker/quotes` 403，`worker.py` 404；
  - 手冊雜湊和 release 相同；
  - 47 個公開 js／css 的雜湊相同；
  - 設定只有入口改變，secrets 沒變。
- release 資料夾 316 檔，沒有 bytecode。
- 退回方式：把 `appEntry` 改回 `releases/20261027T083942079Z/server/index.mjs`。
- 紀錄在主目錄的 `artifacts/deploy-20261027-fubon-entry/`。

## 未驗證

- 業主本人登入後看到的工具列連結，以及點進富邦頁，都還沒有在正式站實際操作過。
