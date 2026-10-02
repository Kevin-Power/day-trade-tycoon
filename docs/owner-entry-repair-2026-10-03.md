# 講師首次設定捷徑修復

2026-10-03（Asia/Taipei），發現 runtime 的私密「講師首次設定.url」將 dotenv 的字串包裹引號一併放入 fragment token。URL 解析結果為 66 字元，去除兩端引號才與伺服器解析的 64 字元 token 相符。這是確定的捷徑錯誤，但不能據此判定使用者先前操作失敗的原因。

新增 `scripts/hosting/owner-entry.mjs`，沿用 runtime 選擇規則，以去 BOM 後的 `parseEnv` 解析私密設定，再依後端相同的 trim 規則與 URLSearchParams 產生連結。寫入前將舊檔完整備份到受保護的 backups；暫存檔、原子替換及讀回核對都在同一 runtime。輸出只有路徑與結果，例外不回顯秘密。

正式捷徑已修正，二次 `--check` 回覆 verified=true、changed=false。原捷徑備份為 runtime/backups/owner-entry-80a81b2b-aa47-4f8a-a607-995832c6c87a.url。runtime、backups 及修復後捷徑的 Windows ACL 均限定目前使用者、SYSTEM、Administrators。未輪替 token、建立帳號、修改資料庫或重啟服務。

驗證：

- `node --test scripts/hosting/owner-entry.test.mjs`：2 項通過。涵蓋 dotenv 單／雙引號、BOM、CRLF、特殊字元 fragment 往返、舊檔備份、重跑不改檔、無效設定保留舊檔及 CLI 不回顯秘密。
- 公開驗收通過：首頁 18 個資產、體驗頁 11 個資產、健康檢查、未入場 ZIP 403、已入場 ZIP 200。ZIP 大小 846880 bytes，SHA-256 `e7a6fec9b57bc91115eb50d5055bb9b64c669d8e91b9491ede5eb203df560934`。
- 22:46 UTC 主機 healthy=true，instance 未變、restartCount=0。應用 release 仍為 `20261002T150348509Z`。
- 正式 ownerSetup 仍為 `ready-uninitialized`；需由使用者透過私密捷徑自行完成新密碼與首次設定。此修復不代表講師帳號已建立或真人試教完成。

既有教學與重練流程可供試教。待業主提供實際講師、公開聯絡入口、費用及開課時間，並安排真人手機首次／隔日操作，才能完成招生安排與教學效果驗證。另一網站的原網域及舊資料未在本輪更動。
