# 新手上手（好玩計畫 子專案 A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通過入場碼的新學員，在大廳按兩下就能看到 09:00 的第一根 K 棒，並用三步教練提示下出第一筆模擬單。之後可以把訪客紀錄搬進正式帳號；手機能加到主畫面，也能朗讀提示。

**Architecture:**
- **訪客帳號**：用 better-auth 1.6.30 內附的 `anonymous` 外掛。
- **伺服器**：練習 API 依帳號類型檢查權限。訪客「按下開始即同意教學聲明」，同意紀錄存在 `guest_consents`。
- **轉正式帳號**：建立或登入正式帳號時，在同一個資料庫交易裡搬移紀錄並刪除訪客。
- **前端**：計畫範本、教練提示、今天三件事、安裝判斷、朗讀等邏輯都寫成 `src/lib` 的純函式，用 `node:test` 先寫測試；元件只負責畫面。

**Tech Stack:**
- React 19、TanStack Start／Router、Tailwind v4
- better-auth 1.6.30（`better-auth/plugins` 的 `anonymous`、`better-auth/client/plugins` 的 `anonymousClient`）
- PGlite／Postgres SQL 遷移、zod 4、zustand、Node `node:test`（`--experimental-strip-types`）、Playwright（只用於檢查腳本與產生圖示）

**Spec:** `docs/superpowers/specs/2026-10-16-easy-start-design.md`。使用者已核准，含「按下開始即同意」與改名「大字模式」兩個決定。

## Global Constraints

- **語言**：畫面文字一律用繁體中文。本計畫寫出的文案要逐字照用。
- **資料原則**：未揭露的分鐘只留在伺服器。練習狀態只能多加 `startedAt` 這類時間欄位，不能帶任何行情。
- **手機與大字**：
  - 新畫面在 375、320、820、1366 寬，以及大字模式的 1366、320 寬，都不能有水平溢出或文字被截斷。
  - 按鈕高度：手機至少 44px，大字模式的主要按鈕至少 56px。
  - 字體大小：可見文字至少 11px，大字模式的說明文字至少 15px。
  - `prefers-reduced-motion` 開啟時，不能有位移或閃動動畫。
- **裝置儲存**：`localStorage` 的讀寫一律包 try/catch，讀不到時用預設值。鍵名都以 `day-tycoon-` 開頭，以 `-v1` 結尾。
- **相依套件**：不新增 npm 套件。圖示用現有的 Playwright 產生。
- **與其他工作階段共用工作區**：
  - 編輯前先看 `git status`／`git diff`，只改需要的段落。
  - `git add` 一律寫明確路徑，不得 `git add -A`。
  - 不提交 `當沖大富翁-地端/`、`Fubon_Codex_Handoff/`、`artifacts/`。
- **提交指令**：`git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`
- **部署**：本計畫不部署。部署前另外問使用者。

## 對規格的補充與調整（寫計畫時讀程式碼後決定）

1. **入場碼檢查**：`src/routes/api/auth/$.ts` 已經拒絕沒有入場碼的所有登入請求（403）。`hooks.before` 的檢查保留，當第二道防線。
2. **刪除訪客由我們自己做**：外掛設定 `disableDeleteAnonymousUser: true`，`onLinkAccount` 在同一個交易裡搬紀錄並刪除訪客。搬移失敗時不刪訪客，紀錄不會遺失，30 天後才會清掉；同時用提示 cookie 告訴學員。cookie 的值是 `skipped` 或 `failed`。
3. **文案改成指向標籤**：圖上的昨收線（標「昨」）和前高線（標「前高」）都是黃色虛線，用顏色會分不清楚。
   - 範本「突破前高」的進場改成「價格站上前高（圖上標「前高」的虛線）再買」。
   - 教練提示第 1 步改成「這是走勢圖。標「昨」的虛線是昨天收盤價，比它高是漲、低是跌。」
4. **今天三件事的第 3 步改成「寫復盤」**：完成一輪本來就要寫復盤（`finish` 需要心得），所以不另外記錄「打開過復盤」。
   - 到 10:00 檢查點，或到教材結尾而還沒完成時，第 3 步標示為「現在」。
   - 完成一輪，三步就都完成。
5. **兩下就看到第一根 K 棒**：
   - 沒有任何練習時，計畫表自動打開。
   - 從計畫表開始後，頁面自動前進一分鐘，露出 09:00；手機版會切到 K 線分頁。
   - 「播放」仍由學員自己按。
6. **教練提示的出現時機**：從計畫表開始練習後立即出現，前提是這台裝置還沒看過；或者網址帶 `coach=1`。一般載入不會出現，所以既有的 QA 腳本不受影響。
7. **朗讀開關的位置**：完整版的顯示設定（大廳等頁首）有「朗讀提示」開關。精簡版（交易畫面頂端）只放「標準｜大字」。不論在哪裡切到大字，都會詢問一次要不要朗讀。
8. **訪客在程式裡的身分**：
   - `useCurrentUserState()` 和 `getSessionUser()` 把訪客當作未登入。
   - 訪客的身分另外由 `guest` 欄位提供。
   - 只有練習頁、大廳的今天三件事與 `/api/morning` 會用到訪客。
9. **service worker 不寫 `fetch` 處理**：只有 install 與 activate。行為和規格寫的「直接轉發網路」相同，什麼都不快取。Chrome 會對沒有作用的 `fetch` 處理發出警告，所以乾脆不寫。
10. **30 天清理改在單元測試驗證**：Task 1 用 PGlite 直接寫入建立時間。整合測試不必為了改時間而停機、直接開資料庫。

## Review Focus

1. **連按兩下「用這個計畫開始」**：兩個 `start` 同時送出，只能有一輪練習、一筆同意紀錄。測試：Task 2 `guest start is idempotent under a double tap`。
2. **訪客登入的正式帳號，與訪客在同一天都有已完成的練習**：兩輪都要搬進帳號，不能撞到唯一索引。測試：Task 1 `completed runs on both sides are all kept`。
3. **搬移的對象錯誤**：目標其實是訪客自己、另一個訪客，或「訪客」其實是正式帳號時，不得搬移或刪除。測試：Task 1 `never links into itself or another guest and never deletes a member`。
4. **台北午夜前後**：23:59 開始的練習，到 00:01 看大廳，要算昨天的練習。測試：Task 10 `a run started before Taipei midnight is yesterday`。
5. **登入頁 `next` 造成迴圈或跳到站外**：例如 `/login?next=/login`、`/%2F%2Fevil`、反斜線。測試：Task 4 `rejects loops, encoded and backslash tricks`。

## 共用指令

- **單一測試檔**：`node --experimental-strip-types --test <path>`
- **全部檢查**：`npm test`、`npm run typecheck`、`npx eslint src --quiet`
- **建置**：`npm run build`，產出 `.output/server/index.mjs`
- **整合測試**：`CLASSROOM_TEST_RELEASE=.output/server/index.mjs node --experimental-strip-types --test --test-concurrency=1 <file>`。PowerShell 先設 `$env:CLASSROOM_TEST_RELEASE`。

---

### Task 1: 遷移與訪客紀錄搬移

**Files:**
- Create: `migrations/0008_anonymous_users.sql`
- Create: `src/lib/guest-link.server.ts`
- Test: `src/lib/guest-link.server.test.ts`

**Interfaces:**
- Produces:
  - `export const GUEST_RETENTION_DAYS = 30`
  - `export type GuestLinkResult = { linked: boolean; moved: number; skipped: boolean }`
  - `export async function linkGuestRecords(sql: Sql, guestId: string, accountId: string): Promise<GuestLinkResult>`
  - `export async function purgeStaleGuests(sql: Sql, now: Date, limit = 200): Promise<number>`
  - 資料表 `guest_consents(user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE, accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  - 欄位 `"user"."isAnonymous" BOOLEAN NOT NULL DEFAULT FALSE`

- [ ] **Step 1: 寫遷移**

`migrations/0008_anonymous_users.sql` 內容：

```sql
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "isAnonymous" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS user_anonymous_created ON "user"("createdAt") WHERE "isAnonymous";
CREATE TABLE IF NOT EXISTS guest_consents (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: 寫失敗的測試**

`src/lib/guest-link.server.test.ts`：
- 沿用 `src/lib/morning-session.test.ts` 的 `sqlFor` 寫法。
- 每個測試開一個暫存 PGlite，依序執行 `0001_auth.sql`、`0003_classroom.sql`、`0007_morning_replay.sql`、`0008_anonymous_users.sql`。
- 用小工具建資料：
  - `addUser(id, anonymous, createdAt?)`
  - `addRun(id, userId, lessonId, completed)`：`state_json` 用 `'{}'`
  - `addRequest(userId, sessionId)`

測試與斷言：

```ts
test("moves a guest's runs to the account and deletes the guest", async () => {
  // guest(匿名): L1 已完成、L2 進行中，各有一筆 morning_requests，並有 guest_consents
  const result = await db.transaction(tx => linkGuestRecords(sqlFor(tx), "guest", "acct"));
  assert.deepEqual(result, { linked: true, moved: 2, skipped: false });
  // 兩輪的 user_id 都是 acct；guest 的 morning_requests 為 0 筆
  // "user" 裡沒有 guest；guest_consents 裡沒有 guest
});
test("keeps the account's active run when both have one for the same lesson", async () => {
  // acct: L1 進行中(id A)；guest: L1 進行中(id G1)、L1 已完成(id G2)
  assert.deepEqual(await link("guest", "acct"), { linked: true, moved: 1, skipped: true });
  // acct 的進行中練習仍是 A；G1 不存在；G2 屬於 acct
});
test("completed runs on both sides are all kept", async () => {
  // acct: L1 已完成；guest: L1 已完成
  assert.deepEqual(await link("guest", "acct"), { linked: true, moved: 1, skipped: false });
  // acct 名下 L1 有 2 輪
});
test("never links into itself or another guest and never deletes a member", async () => {
  assert.equal((await link("guest", "guest")).linked, false);
  assert.equal((await link("guest", "guest2")).linked, false);   // guest2 也是匿名
  assert.equal((await link("member", "acct")).linked, false);    // member 不是匿名
  // guest、guest2、member 與他們的練習都還在
});
test("a failure later in the caller's transaction leaves the guest untouched", async () => {
  await assert.rejects(db.transaction(async tx => {
    await linkGuestRecords(sqlFor(tx), "guest", "acct");
    throw new Error("later step failed");
  }));
  // guest 與其練習、請求、同意紀錄都還在
});
test("purges only anonymous users older than 30 days, at most the limit", async () => {
  // old1、old2 = 匿名 31、40 天前；fresh = 匿名 1 天前；oldMember = 非匿名 90 天前
  assert.equal(await purgeStaleGuests(sql, now, 1), 1);
  assert.equal(await purgeStaleGuests(sql, now), 1);
  assert.equal(await purgeStaleGuests(sql, now), 0);
  // fresh、oldMember 仍在；old1、old2 與其練習都刪除
});
```

- [ ] **Step 3: 執行測試，確認失敗**

Run: `node --experimental-strip-types --test src/lib/guest-link.server.test.ts`

Expected: FAIL，原因是找不到 `./guest-link.server.ts`。

- [ ] **Step 4: 實作 `src/lib/guest-link.server.ts`**

`linkGuestRecords` 依序：
1. 用 `SELECT id, "isAnonymous" FROM "user" WHERE id IN (guestId, accountId) FOR UPDATE` 鎖住兩列。
2. 下列任一情況回傳 `{ linked: false, moved: 0, skipped: false }`，不做任何事：
   - `guestId === accountId`
   - guest 不存在或不是匿名
   - account 不存在或是匿名
3. `DELETE FROM morning_requests WHERE user_id = guest`
4. 刪除衝突的訪客練習：

   ```sql
   DELETE FROM morning_sessions g
   WHERE g.user_id = $guest AND NOT g.completed AND EXISTS (
     SELECT 1 FROM morning_sessions a
     WHERE a.user_id = $account AND a.lesson_id = g.lesson_id AND NOT a.completed)
   RETURNING id
   ```

   有刪到列，`skipped` 就是 true。
5. `UPDATE morning_sessions SET user_id = account WHERE user_id = guest`。影響的列數就是 `moved`。
6. `DELETE FROM "user" WHERE id = guest AND "isAnonymous"`。session 與同意紀錄會跟著刪除（CASCADE）。

`purgeStaleGuests` 執行：

```sql
DELETE FROM "user" WHERE id IN (
  SELECT id FROM "user"
  WHERE "isAnonymous" AND "createdAt" < $cutoff
  ORDER BY "createdAt" LIMIT $limit)
```

`cutoff` 是 `now` 往前 `GUEST_RETENTION_DAYS` 天。回傳刪除的列數，用 `RETURNING id` 計數。

- [ ] **Step 5: 執行測試，確認通過**

Run: `node --experimental-strip-types --test src/lib/guest-link.server.test.ts`

Expected: PASS（6 tests）

- [ ] **Step 6: 提交**

```bash
git add migrations/0008_anonymous_users.sql src/lib/guest-link.server.ts src/lib/guest-link.server.test.ts
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: guest account table changes and moving guest practice into a real account" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 練習 API 開放給訪客

**Files:**
- Modify: `src/lib/morning.ts`
  - `MorningState` 加 `startedAt?: number`
  - `MorningAction` 的 start 加 `guestTerms?: true`
- Modify: `src/lib/morning-engine.ts`
  - 匯出 `planSchema`
  - start schema 加 `guestTerms: z.literal(true).optional()`
  - `createMorningState` 寫入 `startedAt: now`
- Modify: `src/lib/morning-session.server.ts`
  - `requireProfile` 改為 `requirePracticeAccess`
  - 加入訪客同意的處理
- Test: `src/lib/morning-session.test.ts`
  - 遷移清單加上 `0008_anonymous_users.sql`
  - 新增測試
- Test: `src/lib/morning-engine.test.ts`（新增一個測試）

**Interfaces:**
- Consumes: Task 1 的 `guest_consents` 表與 `"isAnonymous"` 欄位
- Produces:
  - `export const planSchema`（`src/lib/morning-engine.ts`）
  - start 動作：`{ action: "start"; requestId; plan; guestTerms?: true }`
  - `MorningState.startedAt?: number`：建立當下的毫秒時間；舊資料沒有這個欄位
  - 錯誤訊息：
    - 訪客未同意就操作：403「請先確認教學聲明」
    - 一般帳號帶 `guestTerms`：400「這個帳號不需要訪客聲明」
    - 一般帳號沒有學員資料：維持 403「請先完成學員資料與教學聲明」

- [ ] **Step 1: 寫失敗的測試**

`src/lib/morning-engine.test.ts` 新增：

```ts
test("a new run records when it started", () => {
  assert.equal(createMorningState(randomUUID(), plan, source, 5000).startedAt, 5000);
});
```

`plan`、`source` 用該檔既有的測試資料。

`src/lib/morning-session.test.ts`：
- 遷移清單加入 `"0008_anonymous_users.sql"`。
- 新增 `test("guests can read freely but start only with the teaching statement", ...)`：
  - 建立 `"user"`：`guest`（`"isAnonymous"` 為 TRUE）、`member`（非匿名，有已同意的 profile）、`stranger`（非匿名，沒有 profile）。
  - 斷言：

```ts
assert.equal((await read("guest")).state, null);
await assert.rejects(act(start, 0, "guest"), { status: 403, message: "請先確認教學聲明" });
const began = (await act({ ...start, guestTerms: true }, 0, "guest")).state!;
assert.equal(began.cursor, 0);
assert.equal(count("SELECT count(*) FROM guest_consents WHERE user_id='guest'"), 1);
assert.equal(count("SELECT count(*) FROM classroom_profiles WHERE user_id='guest'"), 0);
await assert.rejects(act({ ...start, requestId: randomUUID(), guestTerms: true }, 0, "member"), { status: 400 });
await assert.rejects(read("stranger"), { status: 403 });
// 已同意的訪客，後續的 advance 不需要再帶 guestTerms
assert.equal((await act({ action: "advance", requestId: randomUUID(), id: began.id, expectedRevision: 0 }, 1000, "guest")).state!.cursor, 1);
```

- 新增 `test("guest start is idempotent under a double tap", ...)`：
  - 用另一個匿名使用者 `guest2`，同一個 `requestId` 的 `{ ...start, guestTerms: true }` 以 `Promise.all` 送兩次。
  - 斷言兩次回傳的 `state.id` 相同，而且 `guest_consents` 只有 1 筆。
  - 再用新的 `requestId` 送一次，`state.id` 仍相同，因為練習還在進行中。

- [ ] **Step 2: 執行測試，確認失敗**

Run: `node --experimental-strip-types --test src/lib/morning-session.test.ts src/lib/morning-engine.test.ts`

Expected: FAIL。`startedAt` 是 undefined；訪客讀取回 403。

- [ ] **Step 3: 實作**

在 `morning-session.server.ts` 新增 `requirePracticeAccess(sql, userId): Promise<{ kind: "member" } | { kind: "guest"; consented: boolean }>`：
1. 先查 `classroom_profiles ... FOR UPDATE`。`tos_accepted_at` 有值就回傳 `member`。
2. 否則查 `SELECT "isAnonymous" FROM "user" WHERE id = $1 FOR UPDATE`。
   - 是匿名：再查 `guest_consents` 有沒有這個人，回傳 `guest`。
   - 都不是：丟 `MorningError(403, "請先完成學員資料與教學聲明")`。

`loadMorningSession` 改呼叫 `requirePracticeAccess`，訪客不論是否同意都可以讀取。

`mutateMorningSession` 在解析動作之後：
- `member` 而且 start 帶了 `guestTerms`：丟 400「這個帳號不需要訪客聲明」。
- `guest` 而且還沒同意：
  - start 帶了 `guestTerms`：`INSERT INTO guest_consents(user_id) VALUES ($1) ON CONFLICT DO NOTHING`。
  - 其他情況：丟 403「請先確認教學聲明」。
- 之後的流程（重送比對、建立或套用動作）不變。

- [ ] **Step 4: 執行測試，確認通過**

Run: `node --experimental-strip-types --test src/lib/morning-session.test.ts src/lib/morning-engine.test.ts`

Expected: PASS，包含原本的測試。

- [ ] **Step 5: 型別檢查**

Run: `npm run typecheck`

Expected: 無錯誤。

- [ ] **Step 6: 提交**

```bash
git add src/lib/morning.ts src/lib/morning-engine.ts src/lib/morning-session.server.ts src/lib/morning-session.test.ts src/lib/morning-engine.test.ts
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: guests can practice after accepting the teaching statement on start" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 登入系統接上訪客帳號

**Files:**
- Modify: `src/lib/auth/server.ts`
- Modify: `src/lib/auth/client.ts`
- Modify: `src/lib/auth/use-current-user.ts`、`src/offline/current-user.ts`
- Modify: `src/lib/auth/verify.server.ts`
- Modify: `src/routes/api/course-inquiries.ts:43`
- Create: `src/lib/guest-link.ts`
- Test: `src/lib/guest-link.test.ts`
- Create: `scripts/hosting/guest-integration.test.mjs`

**Interfaces:**
- Consumes:
  - Task 1 的 `linkGuestRecords`、`purgeStaleGuests`
  - Task 2 的 `guestTerms`
- Produces:
  - `src/lib/guest-link.ts`：
    - `export const LINK_NOTICE_COOKIE = "day-tycoon-link-notice"`
    - `export type LinkNotice = "skipped" | "failed"`
    - `export function readLinkNotice(cookieHeader: string): LinkNotice | null`
    - `export function clearLinkNoticeCookie(): string`：回傳 `day-tycoon-link-notice=; Max-Age=0; Path=/; SameSite=Lax`
  - `useCurrentUserState(): { user: AppUser | null; guest: { id: string } | null; isPending: boolean }`：訪客時 `user` 為 null。
  - `getSessionUser()`：訪客回傳 null。
  - `authClient.signIn.anonymous()`

- [ ] **Step 1: 寫失敗的單元測試**

`src/lib/guest-link.test.ts`：

```ts
test("reads the one-time link notice", () => {
  assert.equal(readLinkNotice("a=1; day-tycoon-link-notice=skipped"), "skipped");
  assert.equal(readLinkNotice("day-tycoon-link-notice=failed"), "failed");
  assert.equal(readLinkNotice("day-tycoon-link-notice=other"), null);
  assert.equal(readLinkNotice(""), null);
});
test("clears the notice cookie site-wide", () => {
  assert.equal(clearLinkNoticeCookie(), "day-tycoon-link-notice=; Max-Age=0; Path=/; SameSite=Lax");
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `node --experimental-strip-types --test src/lib/guest-link.test.ts`

Expected: FAIL，原因是找不到模組。

- [ ] **Step 3: 實作 `src/lib/guest-link.ts`，並執行測試確認通過**

Run: `node --experimental-strip-types --test src/lib/guest-link.test.ts`

Expected: PASS（2 tests）

- [ ] **Step 4: 寫整合測試（先失敗）**

`scripts/hosting/guest-integration.test.mjs` 照抄 `morning-integration.test.mjs` 的骨架：
- port 改 `18797`，暫存資料夾前綴改 `guest-http-test-`，`CLASSROOM_CODE: 'GUESTTEST'`。
- 沿用 `launch`、`close`、`request`、`createProfile`、`absorb`，以及 jar 的寫法。

斷言依序如下：
1. **沒有入場碼**：`POST /api/auth/sign-in/anonymous` 回 403。
2. **建立訪客**：
   - 通過入場碼後，以空的 JSON body 呼叫 `sign-in/anonymous`，回 200，而且帶 session cookie。
   - `GET /api/auth/get-session` 的 `user.isAnonymous === true`，`user.name === "訪客"`。
   - 同一個 jar 再呼叫一次 `sign-in/anonymous`，回 400。
   - `GET /api/morning` 回 200，`state` 是 null。
3. **訪客練習**：
   - 不帶 `guestTerms` 的 start 回 403。
   - 帶 `guestTerms: true` 的 start 回 200。
   - 等到可以前進後，送 advance，再送一筆買進 1 張，再 advance；斷言 `fills.length === 1`。
4. **訪客不能建立學員資料**：用訪客 jar 呼叫 `createProfile` 要失敗。把 `createProfile` 改成回傳狀態碼，斷言不是 200，或解碼後有 `error`。
5. **註冊後紀錄搬進新帳號**：
   - 先複製一份訪客 jar 為 `oldGuest`。
   - 訪客 jar 呼叫 `sign-up/email`，回 200。
   - 這時 `GET /api/morning` 回 403，因為還沒有 profile。
   - `createProfile` 之後，`GET /api/morning` 的 `state` 與訪客最後的 state 深度相等。
   - `get-session` 的 `isAnonymous === false`。
   - `oldGuest` 的 `get-session` 回 null：訪客已刪除，它的 session 也跟著刪除。
6. **衝突時保留正式帳號那一輪**：
   - carol：入場、註冊、`createProfile`、帶一般 start 開始練習，記下 `carolRun`。
   - 新的訪客：入場、建立訪客、帶 `guestTerms` 開始練習。
   - 訪客 jar 呼叫 `sign-in/email` 登入 carol：回應的 `set-cookie` 包含 `day-tycoon-link-notice=skipped`；之後 carol 的 `GET /api/morning` 仍是 `state.id === carolRun.id`。
7. **日誌不洩漏秘密**：沿用原檔最後的斷言，密碼、入場碼、secret 與 jar 的值都不得出現在 app 日誌。

- [ ] **Step 5: 建置並執行整合測試，確認失敗**

Run:

```bash
npm run build
CLASSROOM_TEST_RELEASE=.output/server/index.mjs node --experimental-strip-types --test --test-concurrency=1 scripts/hosting/guest-integration.test.mjs
```

Expected: FAIL，在斷言 2 失敗：`/sign-in/anonymous` 回 404。

- [ ] **Step 6: 接上 better-auth**

`src/lib/auth/server.ts`：
- `import { anonymous } from "better-auth/plugins"`
- `import { createAuthMiddleware } from "better-auth/api"`
- `rateLimit.customRules` 加 `"/sign-in/anonymous": { window: 600, max: 60 }`
- `hooks.before`：`ctx.path === "/sign-in/anonymous"`，而且 `ctx.headers` 沒有通過 `checkGateSession` 時，丟 `new APIError("FORBIDDEN", { message: "請先輸入教室入場碼" })`。
- `hooks.after`：`ctx.path === "/sign-in/anonymous"` 而且 `ctx.context.newSession` 存在時，`await purgeStaleGuests(await getSql(), new Date())`。錯誤只用 `ctx.context.logger.error` 記錄，不影響這次登入。
- `plugins` 改成：

  ```ts
  [anonymous({
    emailDomainName: "guest.invalid",
    generateName: () => "訪客",
    disableDeleteAnonymousUser: true,
    onLinkAccount,
  }), tanstackStartCookies()]
  ```

  `tanstackStartCookies` 維持最後一個。
- `onLinkAccount({ anonymousUser, newUser, ctx })`：
  - 呼叫 `withSqlTransaction(sql => linkGuestRecords(sql, anonymousUser.user.id, newUser.user.id))`。
  - `skipped` 時，用 `ctx.setCookie(LINK_NOTICE_COOKIE, "skipped", { path: "/", maxAge: 600, sameSite: "lax", httpOnly: false, secure: config.secure })` 設定提示。
  - 丟錯時記錄錯誤，並用同樣方式設定 `"failed"`。

其他檔案：
- `src/lib/auth/client.ts`：`createAuthClient({ plugins: [anonymousClient()] })`，`anonymousClient` 從 `better-auth/client/plugins` 匯入。
- `use-current-user.ts`：
  - `data.user.isAnonymous` 為 true 時，回傳 `user: null, guest: { id }`。
  - 其他情況 `guest: null`。
  - `src/offline/current-user.ts` 回傳 `{ user: null, guest: null, isPending: false }`。
- `verify.server.ts`：`session.user.isAnonymous` 為 true 時，`getSessionUser()` 回傳 null。
- `course-inquiries.ts:43`：`viewer` 要求 `session?.user && !session.user.isAnonymous`。

- [ ] **Step 7: 重新建置並執行整合測試，確認通過**

Run：同 Step 5。

Expected: PASS。也要跑既有的 `morning-integration.test.mjs` 與 `auth-integration.test.mjs`，確認仍然通過。

- [ ] **Step 8: 全部檢查**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`

Expected: 全部通過。

- [ ] **Step 9: 提交**

```bash
git add src/lib/auth/server.ts src/lib/auth/client.ts src/lib/auth/use-current-user.ts src/offline/current-user.ts src/lib/auth/verify.server.ts src/routes/api/course-inquiries.ts src/lib/guest-link.ts src/lib/guest-link.test.ts scripts/hosting/guest-integration.test.mjs
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: anonymous guest accounts behind the classroom gate, linked on sign-up" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 登入後回到原頁

**Files:**
- Create: `src/lib/safe-next.ts`
- Test: `src/lib/safe-next.test.ts`
- Modify: `src/routes/login.tsx`

**Interfaces:**
- Produces:
  - `export function safeNextPath(value: unknown): string`：不合格時回傳 `"/"`。
  - `export function loginHref(options: { next: string; mode?: "up" }): string`：例如 `/login?mode=up&next=%2Fmorning%3Fpanel%3Dtrade`。
  - `/login` 的 search 參數：`{ next?: string; mode?: "up" }`。

- [ ] **Step 1: 寫失敗的測試**

```ts
test("keeps in-site paths with their query", () => {
  assert.equal(safeNextPath("/morning?panel=trade"), "/morning?panel=trade");
  assert.equal(safeNextPath("/"), "/");
});
test("rejects loops, encoded and backslash tricks", () => {
  for (const value of ["//evil.test", "/\\evil.test", "https://evil.test", "", " /morning", "/login", "/login?next=/",
    "/%2F%2Fevil.test", "/morning\\x", "/morning\n", undefined, 42, "/" + "a".repeat(600)])
    assert.equal(safeNextPath(value), "/", String(value));
});
test("builds a sign-up link that returns to practice", () => {
  assert.equal(loginHref({ next: "/morning?panel=trade", mode: "up" }), "/login?mode=up&next=%2Fmorning%3Fpanel%3Dtrade");
  assert.equal(loginHref({ next: "//evil" }), "/login?next=%2F");
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `node --experimental-strip-types --test src/lib/safe-next.test.ts`

Expected: FAIL，原因是找不到模組。

- [ ] **Step 3: 實作 `safeNextPath`**

在下列任一情況回傳 `"/"`，其他情況原樣回傳：
- 不是字串，或長度超過 512
- 不以 `/` 開頭
- 以 `//` 開頭
- 含 `\` 或控制字元
- 解碼一次後以 `//` 開頭
- 路徑是 `/login` 或以 `/login?`、`/login/` 開頭

- [ ] **Step 4: 執行測試，確認通過**

Run: `node --experimental-strip-types --test src/lib/safe-next.test.ts`

Expected: PASS（3 tests）

- [ ] **Step 5: 接到登入頁**

`src/routes/login.tsx`：
- Route 加上 `validateSearch`，回傳 `{ next?: string; mode?: "up" }`。
  - `next` 經 `safeNextPath` 檢查；結果是 `"/"` 時設為 undefined。
  - `mode` 只接受 `"up"`。
- `AccountCredentials` 的初始模式：`mode === "up"` 時預設「首次註冊」。
- `ProfileCompletion` 兩處 `navigate({ to: "/" })`（約第 258、288 行）改成 `navigate({ href: next ?? "/" })`。
- Task 3 之後，訪客的 `user` 已經是 null，登入頁自然顯示註冊／登入表單，不需另外處理。

- [ ] **Step 6: 型別檢查並提交**

Run: `npm run typecheck`

Expected: 無錯誤。

```bash
git add src/lib/safe-next.ts src/lib/safe-next.test.ts src/routes/login.tsx
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: login returns to the practice screen and can open in sign-up mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 練習頁的訪客流程

**Files:**
- Create: `src/lib/morning-access.ts`
- Test: `src/lib/morning-access.test.ts`
- Create: `src/components/guest-prompts.tsx`：`GuestBanner`、`GuestSaveCard`、`LinkNoticeBanner`
- Modify: `src/components/morning-practice.tsx`
- Modify: `src/trading-desk.css`：`.td-guest*` 樣式

**Interfaces:**
- Consumes:
  - Task 3 的 `useCurrentUserState().guest`、`authClient.signIn.anonymous`、`readLinkNotice`、`clearLinkNoticeCookie`
  - Task 4 的 `loginHref`
  - Task 2 的 `guestTerms`
- Produces:
  - `export type AccessProblem = { kind: "guest-start" | "profile" | "gate"; title: string; body: string }`
  - `export function describeAccessProblem(status: number, message: string): AccessProblem`
  - `export const PRACTICE_PATH = "/morning?panel=trade"`
  - `export const GUEST_TERMS_TEXT = "按下開始，表示你了解：這是用歷史 K 線的紙上模擬，不是真實交易，結果不代表實際獲利。"`
  - `MorningLesson` 新增 prop `guest: boolean`，並把它傳給 `PlanForm`（Task 6 接收）

- [ ] **Step 1: 寫失敗的測試**

```ts
test("an unauthenticated practice request asks to retry the guest start", () => {
  assert.deepEqual(describeAccessProblem(401, "請先登入學員帳號"), {
    kind: "guest-start", title: "暫時無法開始練習", body: "請稍候再試一次。也可以先登入或建立帳號。" });
});
test("a member without a profile is sent to finish it", () => {
  assert.deepEqual(describeAccessProblem(403, "請先完成學員資料與教學聲明"), {
    kind: "profile", title: "還差一步：完成學員資料",
    body: "建立帳號後要填寫學員名稱並確認教學聲明，才能保存練習。" });
});
test("any other refusal shows the server message and goes back to the lobby", () => {
  assert.deepEqual(describeAccessProblem(403, "請先進入教室"), { kind: "gate", title: "請重新進入教室", body: "請先進入教室" });
});
```

- [ ] **Step 2: 執行測試確認失敗，實作後確認通過**

Run: `node --experimental-strip-types --test src/lib/morning-access.test.ts`

Expected: 先 FAIL（找不到模組）；實作 `src/lib/morning-access.ts` 之後 PASS（3 tests）。

- [ ] **Step 3: 練習頁接上訪客**

`morning-practice.tsx`：

**`MorningPractice`**
- 從 `useCurrentUserState()` 取 `guest`。
- `authEnabled` 為 true、不在載入中、`user` 與 `guest` 都是 null 時，在 effect 裡用 ref 確保只呼叫一次 `authClient.signIn.anonymous()`。
  - 進行中顯示 `role="status"` 的「正在準備練習…」。
  - 失敗時顯示 `guest-start` 卡片，有兩個按鈕：
    - 「再試一次」：重設 ref 並重新呼叫。
    - 「登入／建立帳號」：前往 `loginHref({ next: PRACTICE_PATH, mode: "up" })`。
  - 外掛回 400（這台瀏覽器已經是訪客）時，呼叫 `authClient.getSession()` 重新讀取，不顯示錯誤。
- `MorningLesson` 的 key 改成 `${user?.id ?? guest?.id ?? "none"}:${lessonId}`，並傳入 `guest={Boolean(guest)}`。

**`useMorningData`**
- `needsLogin: boolean` 改為 `access: { status: 401 | 403; message: string } | null`。
- 讀取 401／403 的回應 JSON 裡的 `message`。

**原本的「先登入」卡片**
- 改用 `describeAccessProblem`。
- `profile` 類：按鈕「完成學員資料」，前往 `loginHref({ next: PRACTICE_PATH })`。
- `gate` 類：按鈕「回大廳」，前往 `/`。
- `guest-start` 類：按鈕「再試一次」，呼叫 `request()`。

**`start(plan)`**
- 訪客送出時帶 `guestTerms: true`。

**訪客提示列**
- `HintBar` 的 children 裡，訪客時放 `<GuestBanner />`：
  - 文字「目前是訪客，建立帳號才會保存練習與之後的連續天數」
  - 按鈕「建立帳號」：`loginHref({ next: PRACTICE_PATH, mode: "up" })`
  - 按鈕「換人練習」：`await authClient.signOut()` 後 `window.location.assign(PRACTICE_PATH)`

**完成畫面**
- 訪客時，在 `Completion` 上方放 `<GuestSaveCard />`：
  - 標題「建立帳號，保存這次的練習」
  - 內文「現在建立帳號，這一輪的計畫、操作與復盤都會搬進你的帳號。」
  - 按鈕「建立帳號」與「之後再說」。後者只用元件內的 state 收起卡片。

**搬移提示**
- `MorningLesson` 掛載時，用 `readLinkNotice(document.cookie)` 讀取；讀到後執行 `document.cookie = clearLinkNoticeCookie()`。
- 在 `HintBar` 顯示 `<LinkNoticeBanner />`，附「知道了」按鈕：
  - `skipped`：「你的帳號在這一天已有練習，訪客那一輪沒有保存。」
  - `failed`：「訪客的練習這次沒有搬進帳號，請告訴講師。」

**大字模式**
- 這些卡片的按鈕套用既有的 `td-button`，在大字模式下高度至少 56px。

- [ ] **Step 4: 全部檢查**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`

Expected: 全部通過。

- [ ] **Step 5: 提交**

```bash
git add src/lib/morning-access.ts src/lib/morning-access.test.ts src/components/guest-prompts.tsx src/components/morning-practice.tsx src/trading-desk.css
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: practice starts as a guest, with save prompts and link notices" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 計畫一鍵範本與兩下開盤

**Files:**
- Create: `src/lib/plan-templates.ts`
- Test: `src/lib/plan-templates.test.ts`
- Create: `src/components/morning-plan-form.tsx`：從 `morning-practice.tsx:1208-1359` 搬出 `PlanForm` 並改寫
- Modify: `src/components/morning-practice.tsx`
  - 改用新的 `PlanForm`
  - 沒有練習時自動打開計畫
  - 開始後自動露出 09:00
  - 手機切到 K 線分頁
- Modify: `src/trading-desk.css`：`.td-template*` 樣式

**Interfaces:**
- Consumes:
  - Task 2 的 `planSchema`
  - Task 5 的 `GUEST_TERMS_TEXT` 與 `guest` prop
- Produces:
  - `export type PlanTemplateId = "breakout" | "pullback" | "observe"`
  - `export type PlanTemplate = { id: PlanTemplateId; title: string; summary: string; bias: MorningPlan["bias"]; reason: string; entry: string; stop: string }`
  - `export const PLAN_TEMPLATES: readonly PlanTemplate[]`
  - `export const DEFAULT_PLAN_TEMPLATE: PlanTemplateId = "breakout"`
  - `export function applyPlanTemplate(template: PlanTemplate, plan: MorningPlan): MorningPlan`
  - `export function isBlankPlan(plan: Pick<MorningPlan, "reason" | "entry" | "stop">): boolean`
  - `PlanForm` 的 props：`{ catalog, exerciseId, busy, guest, onStart, onCancel? }`

範本文案逐字照用：

| id | title | summary | bias | reason | entry | stop |
|---|---|---|---|---|---|---|
| breakout | 突破前高 | 等價格站上前高再買，跌回就走 | bullish | 開盤後走強，想等它站上前高 | 價格站上前高（圖上標「前高」的虛線）再買 | 跌回前高下方就賣出 |
| pullback | 回測平盤 | 回到昨收附近守住再買 | bullish | 回檔到昨收附近有撐 | 回到昨收附近、沒有跌破再買 | 跌破昨收就賣出 |
| observe | 先看不做 | 第一次先看開盤，不下單 | observe | 第一次練習，先看開盤怎麼走 | 今天只觀察，不下單 | 沒有部位，不適用 |

- [ ] **Step 1: 寫失敗的測試**

```ts
test("every template passes the server plan check", () => {
  const base = { exerciseId: "first-order", bias: "observe", focusCode: "2330", reason: "", entry: "", stop: "" } as const;
  for (const template of PLAN_TEMPLATES)
    assert.equal(planSchema.safeParse(applyPlanTemplate(template, base)).success, true, template.id);
});
test("applying a template keeps the chosen stock and exercise", () => {
  const plan = applyPlanTemplate(PLAN_TEMPLATES[1], { exerciseId: "patience", bias: "bearish", focusCode: "2317", reason: "x", entry: "y", stop: "z" });
  assert.equal(plan.focusCode, "2317"); assert.equal(plan.exerciseId, "patience");
  assert.equal(plan.bias, "bullish"); assert.equal(plan.stop, "跌破昨收就賣出");
});
test("breakout is the default and uses the approved copy", () => {
  assert.equal(DEFAULT_PLAN_TEMPLATE, "breakout");
  assert.deepEqual(PLAN_TEMPLATES.map(t => t.title), ["突破前高", "回測平盤", "先看不做"]);
  assert.equal(PLAN_TEMPLATES[0].entry, "價格站上前高（圖上標「前高」的虛線）再買");
});
test("a plan is blank only when all three texts are empty after trimming", () => {
  assert.equal(isBlankPlan({ reason: " ", entry: "", stop: "\n" }), true);
  assert.equal(isBlankPlan({ reason: "a", entry: "", stop: "" }), false);
});
```

- [ ] **Step 2: 執行測試確認失敗，實作後確認通過**

Run: `node --experimental-strip-types --test src/lib/plan-templates.test.ts`

Expected: 先 FAIL；實作 `src/lib/plan-templates.ts` 之後 PASS（4 tests）。

- [ ] **Step 3: 新的計畫表**

`morning-plan-form.tsx`：
- 保留原本的所有欄位、檢查與文案。
- 標題下方加入範本區：`role="radiogroup"`、`aria-label="選一個計畫範本"`，三張範本卡加「自己寫」共四個選項。
  - 每個選項是 `role="radio"` 的按鈕，顯示 title 與 summary。
  - 方向鍵移動選取，只有目前選取的可以用 Tab 選到（`tabIndex`）。
- 初始狀態：
  - 計畫是空白時，預設選 `DEFAULT_PLAN_TEMPLATE` 並填好三格。
  - 其他情況選「自己寫」。
- 選範本時用 `applyPlanTemplate` 填入；選「自己寫」不清空已填的文字。
- 選了範本後若修改任何一格，選取自動變成「自己寫」。
- 送出按鈕文字：
  - 選範本時為「用這個計畫開始」。
  - 選「自己寫」時維持「保存計畫，進入 09:00 練習」。
  - 送出中顯示「正在保存…」。
- 訪客時，在送出按鈕正上方顯示 `GUEST_TERMS_TEXT`。用 `<p>`，字級與現有說明相同，大字模式下至少 15px。
- 範本卡在手機上一欄排列；`min-height` 一般 64px、大字模式 72px。

- [ ] **Step 4: 練習頁兩下開盤**

`morning-practice.tsx`：
- **自動打開計畫**：`data` 已載入、`data.state === null` 而且 `!newPlan` 時，`setPlanOpen(true)`。只在第一次發生，用 ref 記錄。
- **開始後**（`start` 成功、`next.state.cursor === 0`）：
  - `setActivePane("chart")`，取代原本的 `initialPane ?? "trade"`。
  - 等到 `next.state.nextAdvanceAt` 之後 30ms，送一次 `advance`（與 `advance()` 相同的請求）。
  - 回傳的 cursor 是 1，畫面就有 09:00 的 K 棒。
- 刪除原檔中搬走的 `PlanForm`。

- [ ] **Step 5: 全部檢查與既有畫面檢查**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`。

接著 `npm run build`，依 `scripts/qa/` 的說明啟動 `desk-server.mjs`，執行 `desk-seed.mjs`、`desk-layout.mjs --strict`、`desk-orders.mjs`。

Expected: 全部通過。

- [ ] **Step 6: 提交**

```bash
git add src/lib/plan-templates.ts src/lib/plan-templates.test.ts src/components/morning-plan-form.tsx src/components/morning-practice.tsx src/trading-desk.css
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: one-tap plan templates, the plan opens by itself and 09:00 shows after start" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 第一次的教練提示

**Files:**
- Create: `src/lib/device-storage.ts`
- Test: `src/lib/device-storage.test.ts`
- Create: `src/lib/coach-steps.ts`
- Test: `src/lib/coach-steps.test.ts`
- Create: `src/components/coach-marks.tsx`
- Modify: `src/components/morning-practice.tsx`（`data-coach` 屬性與開啟時機）
- Modify: `src/components/morning-desk-bar.tsx`（播放鍵的 `data-coach="play"`）
- Modify: `src/routes/morning.tsx`（search 參數 `coach?: "1"`，傳給 `MorningPractice` 的 `coach` prop）
- Modify: `src/trading-desk.css`（`.td-coach*` 樣式，含大字與減少動態效果）

**Interfaces:**
- Consumes: `TerminalLayout`（`src/lib/use-terminal-layout.ts`）
- Produces:
  - `device-storage.ts`：
    - `export function browserStorage(): Storage | undefined`
    - `export function readDeviceValue(storage: Pick<Storage,"getItem"> | undefined, key: string): string | null`
    - `export function writeDeviceValue(storage: Pick<Storage,"setItem"|"removeItem"> | undefined, key: string, value: string | null): void`
  - `coach-steps.ts`：
    - `export type CoachStep = { id: "chart" | "play" | "fills"; title: string; body: string; targets: string[] }`
    - `export function coachSteps(layout: TerminalLayout): CoachStep[]`
    - `export const COACH_KEY = "day-tycoon-coach-v1"`
    - `export function readCoachSeen(storage): boolean`
    - `export function writeCoachSeen(storage): void`
    - `export function resetCoachSeen(storage): void`
  - `CoachMarks` 的 props：`{ layout: TerminalLayout; onClose: () => void; onStep?: (step: CoachStep) => void }`。Task 9 用 `onStep` 朗讀。
  - DOM 標記（`data-coach`）：
    - `chart`：`.td-chart` section
    - `play`：`.td-play` 按鈕
    - `ticket`：`.td-trade` aside
    - `ledger`：`.td-ledger`
    - `tab-trade`、`tab-positions`：手機分頁按鈕，值為 `` `tab-${pane}` ``

教練文案逐字照用：

| id | title | body（desktop、tablet） | body（phone、senior） |
|---|---|---|---|
| chart | 看走勢圖 | 這是走勢圖。標「昨」的虛線是昨天收盤價，比它高是漲、低是跌。 | 同左 |
| play | 讓行情動起來 | 按「播放」讓行情動起來；想買就按「買進」。 | 按「播放」讓行情動起來；想買，先點「下單」分頁再按「買進」。 |
| fills | 成交與庫存 | 送出後前進一分鐘就會成交，買到的會出現在「庫存」。 | 同左 |

各步驟要框亮的元素（targets）：

| 版面 | chart | play | fills |
|---|---|---|---|
| desktop、tablet | `[data-coach="chart"]` | `[data-coach="play"]`、`[data-coach="ticket"]` | `[data-coach="ledger"]` |
| phone、senior | `[data-coach="chart"]` | `[data-coach="play"]`、`[data-coach="tab-trade"]` | `[data-coach="tab-positions"]` |

- [ ] **Step 1: 寫失敗的測試**

`device-storage.test.ts` 用 `ledger-preferences.test.ts` 的 `memory` 與 `blocked` 寫法：
- 寫入後讀得回來；寫入 `null` 會刪除。
- 儲存被封鎖或不存在時，讀取得到 null，寫入不會丟錯。

`coach-steps.test.ts`：

```ts
test("every layout gets the same three steps in order", () => {
  for (const layout of ["phone", "tablet", "desktop", "senior"] as const)
    assert.deepEqual(coachSteps(layout).map(s => s.id), ["chart", "play", "fills"]);
});
test("phones point at the order and holdings tabs", () => {
  assert.deepEqual(coachSteps("phone")[1].targets, ['[data-coach="play"]', '[data-coach="tab-trade"]']);
  assert.deepEqual(coachSteps("senior")[2].targets, ['[data-coach="tab-positions"]']);
  assert.deepEqual(coachSteps("desktop")[2].targets, ['[data-coach="ledger"]']);
});
test("the chart step names the labelled previous-close line", () => {
  assert.equal(coachSteps("desktop")[0].body, "這是走勢圖。標「昨」的虛線是昨天收盤價，比它高是漲、低是跌。");
});
test("seen state survives only where storage works", () => {
  const storage = memory();
  assert.equal(readCoachSeen(storage), false);
  writeCoachSeen(storage); assert.equal(readCoachSeen(storage), true);
  resetCoachSeen(storage); assert.equal(readCoachSeen(storage), false);
  assert.equal(readCoachSeen(blocked), false);
  assert.doesNotThrow(() => writeCoachSeen(blocked));
});
```

- [ ] **Step 2: 執行測試確認失敗，實作後確認通過**

Run: `node --experimental-strip-types --test src/lib/device-storage.test.ts src/lib/coach-steps.test.ts`

Expected: 先 FAIL；實作兩個模組之後 PASS。

- [ ] **Step 3: 教練提示元件**

`coach-marks.tsx`：

**畫面組成**
- 用 portal 放到 `document.body`，有三層：
  - 半透明遮罩：`position: fixed; inset: 0`，擋住點擊。
  - 框線：每個找得到的目標各一個，依 `getBoundingClientRect` 定位，在 `resize`、`scroll` 時用 `requestAnimationFrame` 更新。
  - 對話框：底部置中，`max-width: 28rem`，左右各留 16px。
- 找不到任何目標時不畫框，對話框照常顯示。
- 第一個目標不在畫面內時，`scrollIntoView({ block: "center" })`。

**對話框**
- `role="dialog"`、`aria-modal="true"`、`aria-labelledby` 指向標題。
- 標題上方顯示「第 n／3 步」。
- 按鈕：
  - 「上一步」：第 1 步不顯示。
  - 「下一步」：最後一步改成「完成」。
  - 「跳過」。
- Esc 等同跳過。換步時焦點移到標題（`tabIndex={-1}`）。關閉時呼叫 `onClose`。

**樣式**
- `.td-coach` 系列。
- 大字模式（`html[data-reading-mode="senior"]`）：按鈕至少 56px，內文至少 18px。
- `prefers-reduced-motion` 時沒有 transition。

- [ ] **Step 4: 接到練習頁**

`morning-practice.tsx`：
- 加上表格中的 `data-coach` 屬性。
- 新增 state `coachOpen`。
- **開啟時機**：
  - 從計畫表開始、09:00 已露出，而且 `!readCoachSeen(browserStorage())`。
  - 或者 `coach` prop 為 true，而且有進行中的練習：載入後立即開啟；還沒有練習時，等開始之後再開啟。
- **關閉時**：`writeCoachSeen(browserStorage())`。

- [ ] **Step 5: 全部檢查與既有畫面檢查**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`。

建置後跑 `desk-layout.mjs --strict` 與 `desk-orders.mjs`。

Expected: 全部通過。QA 帳號的練習是用 API 建立的，所以不會跳出教練提示。

- [ ] **Step 6: 提交**

```bash
git add src/lib/device-storage.ts src/lib/device-storage.test.ts src/lib/coach-steps.ts src/lib/coach-steps.test.ts src/components/coach-marks.tsx src/components/morning-practice.tsx src/components/morning-desk-bar.tsx src/routes/morning.tsx src/trading-desk.css
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: three-step coach marks after the first start" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 「標準｜大字」切換與改名

**Files:**
- Modify: `src/components/display-controls.tsx`
- Modify: 引用 `.display-mode-control` 的樣式檔（先 `rg -n "display-mode-control" src` 找出來，再逐一更新選擇器）
- Modify: 下表列出的文案

**Interfaces:**
- Produces:
  - `DisplayControls({ compact, className })` 的介面不變，內容改成兩段式。
  - 元件結構：
    - 外層 `role="radiogroup"`、`aria-label="文字大小"`。
    - 兩個子按鈕 `role="radio"`，`aria-checked` 標示目前選取。
    - 完整版外層多一個可見的「文字大小」標籤；精簡版沒有。
    - 根元素 class 為 `display-size-control`，按鈕 class 為 `display-size-option`。

文案改動（逐字）：

| 檔案 | 原文 | 新文 |
|---|---|---|
| `course-inquiry-form.tsx:320` | 大字與長輩模式 | 大字模式 |
| `course-inquiry-inbox.tsx:17` | 大字與長輩模式 | 大字模式 |
| `manual-page.tsx:222` | 可在頁首開啟長輩模式。 | 可在頁首把文字大小切到「大字」。 |
| `lightning-order.tsx:165` | 長輩模式預設先核對再送出。 | 大字模式預設先核對再送出。 |
| `license-page.tsx:391` | 長輩與大字模式 | 大字模式 |
| `license-page.tsx:392` | 可切換大字與長輩模式，放大文字和主要操作區；不用趕，先看清楚再操作。 | 可把文字大小切到「大字」，放大文字和主要操作區；不用趕，先看清楚再操作。 |
| `learner-guide.ts:27` | 手機與長輩模式 | 手機與大字模式 |

- [ ] **Step 1: 實作切換元件**

- 只有選取中的那顆按鈕 `tabIndex=0`。左右方向鍵切換選取，並同時呼叫 `setMode`。
- 每顆按鈕至少 44px 高；大字模式下至少 56px。
- 精簡版在 320px 的交易畫面頂端不能溢出，兩顆按鈕合計寬度不超過 104px。

- [ ] **Step 2: 套用文案改動**

逐一修改上表。改完執行 `rg -n "長輩模式" src`，Expected: 沒有結果。

- [ ] **Step 3: 檢查**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`。

建置後跑 `desk-layout.mjs --strict`，320 與大字 320 的案例沒有溢出，也沒有小於 44px 的按鈕。

Expected: 全部通過。

- [ ] **Step 4: 提交**

```bash
git add src/components/display-controls.tsx src/components/course-inquiry-form.tsx src/components/course-inquiry-inbox.tsx src/components/manual-page.tsx src/components/lightning-order.tsx src/components/license-page.tsx src/lib/game/learner-guide.ts <Step 1 修改的樣式檔>
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: text size switch (standard / large) replaces the senior-mode toggle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 朗讀提示

**Files:**
- Create: `src/lib/speech.ts`
- Test: `src/lib/speech.test.ts`
- Modify: `src/lib/display-preferences.ts`
- Test: `src/lib/display-preferences.test.ts`（新檔）
- Modify: `src/components/display-controls.tsx`（朗讀開關與一次性詢問）
- Modify: `src/components/morning-practice.tsx`（朗讀的時機）

**Interfaces:**
- Consumes:
  - Task 7 的 `device-storage.ts`，以及 `CoachMarks` 的 `onStep`
  - `MorningFill`（`src/lib/morning.ts`）
- Produces:
  - `speech.ts`：
    - `export type SpeechLike = Pick<SpeechSynthesis, "getVoices" | "cancel" | "speak">`
    - `export function pickChineseVoice<T extends { lang: string }>(voices: readonly T[]): T | null`：優先 `zh-TW`，其次任何 `zh` 開頭的語音。
    - `export function speechSupported(synth: Pick<SpeechSynthesis, "getVoices"> | undefined): boolean`
    - `export function speak(text: string, synth: SpeechLike | undefined, makeUtterance: (text: string) => SpeechSynthesisUtterance): void`：先 `cancel()` 再 `speak()`；`lang = "zh-TW"`、`rate = 0.9`，有中文語音就指定。
    - `export function fillAnnouncement(fill: Pick<MorningFill, "side" | "shares" | "price">, name: string): string`
    - `export const SPEECH_TEXT = { start: "練習開始，現在是早上九點。", finish: "這一輪已經保存，辛苦了。" }`
  - `display-preferences.ts`：
    - 新增 state `speech: boolean`、`speechAsked: boolean`，以及 `setSpeech(on: boolean): void`（同時把 `speechAsked` 設為 true）。
    - 鍵 `day-tycoon-speech-v1`，值為 `"on"`／`"off"`；沒有值代表還沒問過。
    - 純函式 `readSpeechPreference(storage): { speech: boolean; asked: boolean }` 與 `writeSpeechPreference(storage, on: boolean): void`。

- [ ] **Step 1: 寫失敗的測試**

```ts
test("a fill is read with name, side, lots and plain price", () => {
  assert.equal(fillAnnouncement({ side: "buy", shares: 1000, price: 2580 }, "台積電"), "你的委託成交：台積電，買進 1 張，2580 元");
  assert.equal(fillAnnouncement({ side: "sell", shares: 2000, price: 98.5 }, "鴻海"), "你的委託成交：鴻海，賣出 2 張，98.5 元");
});
test("Taiwan Mandarin is preferred, any Chinese voice is accepted, none means unsupported", () => {
  assert.equal(pickChineseVoice([{ lang: "en-US" }, { lang: "zh-CN" }, { lang: "zh-TW" }])?.lang, "zh-TW");
  assert.equal(pickChineseVoice([{ lang: "zh-HK" }])?.lang, "zh-HK");
  assert.equal(speechSupported({ getVoices: () => [{ lang: "en-US" }] as SpeechSynthesisVoice[] }), false);
  assert.equal(speechSupported(undefined), false);
});
test("speaking cancels what is being read first", () => {
  const calls: string[] = [];
  const synth = { getVoices: () => [], cancel: () => calls.push("cancel"), speak: (u: { text: string; rate: number; lang: string }) => calls.push(`speak:${u.text}:${u.rate}:${u.lang}`) };
  speak("你好", synth as never, text => ({ text, rate: 1, lang: "" }) as never);
  assert.deepEqual(calls, ["cancel", "speak:你好:0.9:zh-TW"]);
});
```

`display-preferences.test.ts`：
- 沒有值時，`{ speech: false, asked: false }`。
- 寫入 on 之後讀到 `{ speech: true, asked: true }`；寫入 off 之後讀到 `{ speech: false, asked: true }`。
- 儲存被封鎖時讀到預設值，寫入不會丟錯。

- [ ] **Step 2: 執行測試確認失敗，實作後確認通過**

Run: `node --experimental-strip-types --test src/lib/speech.test.ts src/lib/display-preferences.test.ts`

Expected: 先 FAIL；實作後 PASS。

- [ ] **Step 3: 顯示設定的朗讀開關與詢問**

`display-controls.tsx`：
- **支援度**：用 `useSyncExternalStore` 或 effect 監聽 `speechSynthesis` 的 `voiceschanged` 事件，取得 `speechSupported`。
- **完整版**：在「標準｜大字」之後加一個 `role="switch"` 的「朗讀提示」按鈕，`aria-checked` 標示是否開啟。
  - 不支援時 `disabled`，按鈕下方顯示「這台設備沒有中文語音」。
- **一次性詢問**：任一版本切到「大字」時，若 `!speechAsked && speechSupported`，在元件旁顯示 `role="dialog"` 的小卡：
  - 文字「要開啟朗讀提示嗎？成交與教學提示會唸出來。」
  - 按鈕「開啟朗讀」與「不用」，兩者都呼叫 `setSpeech`。

- [ ] **Step 4: 練習頁朗讀**

`morning-practice.tsx`：建立 `say(text)`，只在 `speech` 開啟而且支援時呼叫 `speak`。朗讀時機：
- 教練提示 `onStep`：唸 `` `${title}。${body}` ``。
- `marketSession.fills.length` 增加時，唸最後一筆的 `fillAnnouncement`。名稱從 `catalog.symbols` 查。
- `start` 成功後唸 `SPEECH_TEXT.start`；`finish` 成功後唸 `SPEECH_TEXT.finish`。
- 行情本身不唸。

- [ ] **Step 5: 全部檢查並提交**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`

Expected: 全部通過。

```bash
git add src/lib/speech.ts src/lib/speech.test.ts src/lib/display-preferences.ts src/lib/display-preferences.test.ts src/components/display-controls.tsx src/components/morning-practice.tsx
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: optional read-aloud for coach steps, fills, start and finish" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 大廳的「今天三件事」

**Files:**
- Create: `src/lib/today-steps.ts`
- Test: `src/lib/today-steps.test.ts`
- Create: `src/components/today-card.tsx`
- Modify: `src/components/lobby.tsx`
  - 線上版用 `TodayCard` 取代 `lobby-practice-path`；離線版保留原清單。
  - 英雄區的「進入模擬下單」改成次要樣式。
- Modify: 大廳的樣式檔，在 `lobby-practice-path` 所在的檔案加 `.today-card*`

**Interfaces:**
- Consumes:
  - Task 2 的 `MorningState.startedAt`
  - Task 3 的 `useCurrentUserState().guest`
  - Task 5 的 `PRACTICE_PATH`
  - Task 7 的 `resetCoachSeen`、`browserStorage`
- Produces:
  - `export type StepState = "done" | "now" | "todo"`
  - `export type TodayAction = "start" | "continue" | "review" | "again"`
  - `export const REVIEW_CURSOR = 60`
  - `export const TODAY_STEP_LABELS = ["選一個計畫", "模擬練習", "寫復盤"] as const`
  - `export function taipeiDate(ms: number): string`：回傳 `YYYY-MM-DD`
  - `export function todaySteps(state: Pick<MorningState, "startedAt" | "completed" | "cursor"> | null, maxCursor: number, now: number): { steps: [StepState, StepState, StepState]; action: TodayAction }`

推算規則：

| 狀況 | steps | action |
|---|---|---|
| 沒有練習、沒有 `startedAt`，或不是台北的今天 | now, todo, todo | start |
| 已完成 | done, done, done | again |
| `cursor >= REVIEW_CURSOR` 或 `cursor >= maxCursor` | done, done, now | review |
| 其他 | done, now, todo | continue |

主按鈕文字與目的地：

| action | 主按鈕 | 目的地 |
|---|---|---|
| start | 開始今天的練習 | `PRACTICE_PATH` |
| continue | 繼續練習 | `PRACTICE_PATH` |
| review | 寫復盤 | `PRACTICE_PATH` |
| again | 再練一輪 | `PRACTICE_PATH`；按鈕上方顯示「今天完成了，明天再來」 |

- [ ] **Step 1: 寫失敗的測試**

```ts
const at = (y: number, m: number, d: number, h: number, min: number) => Date.UTC(y, m - 1, d, h - 8, min);
test("no run, an old run without a start time, or another day means start", () => {
  assert.deepEqual(todaySteps(null, 90, at(2026, 10, 16, 9, 0)), { steps: ["now", "todo", "todo"], action: "start" });
  assert.equal(todaySteps({ cursor: 3, completed: false }, 90, at(2026, 10, 16, 9, 0)).action, "start");
});
test("a run started before Taipei midnight is yesterday", () => {
  const run = { startedAt: at(2026, 10, 16, 23, 59), cursor: 5, completed: false };
  assert.equal(todaySteps(run, 90, at(2026, 10, 16, 23, 59) + 60_000).action, "continue");
  assert.equal(todaySteps(run, 90, at(2026, 10, 17, 0, 1)).action, "start");
  assert.equal(taipeiDate(at(2026, 10, 17, 0, 1)), "2026-10-17");
});
test("progress moves from practice to review to done", () => {
  const now = at(2026, 10, 16, 20, 0); const startedAt = at(2026, 10, 16, 19, 0);
  assert.deepEqual(todaySteps({ startedAt, cursor: 10, completed: false }, 90, now), { steps: ["done", "now", "todo"], action: "continue" });
  assert.deepEqual(todaySteps({ startedAt, cursor: 60, completed: false }, 90, now), { steps: ["done", "done", "now"], action: "review" });
  assert.equal(todaySteps({ startedAt, cursor: 45, completed: false }, 45, now).action, "review");
  assert.deepEqual(todaySteps({ startedAt, cursor: 30, completed: true }, 90, now), { steps: ["done", "done", "done"], action: "again" });
});
```

- [ ] **Step 2: 執行測試確認失敗，實作後確認通過**

Run: `node --experimental-strip-types --test src/lib/today-steps.test.ts`

Expected: 先 FAIL；實作後 PASS（3 tests）。

- [ ] **Step 3: 今天三件事卡片**

`today-card.tsx`：
- **讀取**：
  - `user` 或 `guest` 存在時，`fetch("/api/morning", { credentials: "same-origin", cache: "no-store" })`。
  - 成功時用 `todaySteps(body.state, body.catalog.maxCursor, Date.now())`。
  - 失敗，或沒有登入也不是訪客時，用 `todaySteps(null, 0, Date.now())`，不顯示錯誤。
- **畫面**：
  - 標題「今天三件事」。
  - 三步的 `<ol>`：完成的步驟顯示勾號，並加上 sr-only 的「已完成」；「現在」的步驟加上 `aria-current="step"`，並顯示「現在」標籤。
  - 一顆主要按鈕，用上表的文字與目的地。
  - 下方一條「第一次使用？看新手教學」：按下時先 `resetCoachSeen(browserStorage())`，再前往 `/morning?panel=trade&coach=1`。
- **尺寸**：手機上主要按鈕全寬、至少 48px；大字模式至少 56px。

- [ ] **Step 4: 全部檢查並提交**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`

Expected: 全部通過。

```bash
git add src/lib/today-steps.ts src/lib/today-steps.test.ts src/components/today-card.tsx src/components/lobby.tsx <Step 3 修改的樣式檔>
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: lobby shows today's three steps with one next-step button" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 加到手機主畫面

**Files:**
- Create: `scripts/generate-icons.mjs`
- Create（產出）：`public/icons/icon-192.png`、`public/icons/icon-512.png`、`public/icons/icon-maskable-512.png`、`public/icons/apple-touch-icon.png`
- Modify: `public/manifest.webmanifest`
- Modify: `src/routes/__root.tsx`
- Create: `public/sw.js`
- Create: `src/lib/install-mode.ts`
- Test: `src/lib/install-mode.test.ts`
- Create: `src/components/pwa-effect.tsx`
- Create: `src/components/install-card.tsx`
- Modify: `src/components/lobby.tsx`（在 `TodayCard` 下方放 `InstallCard`）

**Interfaces:**
- Consumes: Task 7 的 `device-storage.ts`
- Produces:
  - `export type InstallMode = "android-prompt" | "ios-guide" | "none"`
  - `export function installMode(input: { userAgent: string; hasPrompt: boolean; standalone: boolean }): InstallMode`
  - `export function shouldRegisterServiceWorker(input: { protocol: string; baseUrl: string }): boolean`
  - `export const INSTALL_DISMISSED_KEY = "day-tycoon-install-v1"`
  - `useInstallPrompt`（zustand，放在 `pwa-effect.tsx`）：`{ prompt: BeforeInstallPromptEvent | null; set(prompt): void }`
  - `PwaEffect()`：掛在 `__root.tsx`

- [ ] **Step 1: 寫失敗的測試**

```ts
const android = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
test("phones get the right install help; desktops and installed apps get none", () => {
  assert.equal(installMode({ userAgent: android, hasPrompt: true, standalone: false }), "android-prompt");
  assert.equal(installMode({ userAgent: android, hasPrompt: false, standalone: false }), "none");
  assert.equal(installMode({ userAgent: iphone, hasPrompt: false, standalone: false }), "ios-guide");
  assert.equal(installMode({ userAgent: iphone, hasPrompt: false, standalone: true }), "none");
  assert.equal(installMode({ userAgent: windows, hasPrompt: true, standalone: false }), "none");
});
test("the service worker registers only on the hosted HTTPS site", () => {
  assert.equal(shouldRegisterServiceWorker({ protocol: "https:", baseUrl: "/" }), true);
  assert.equal(shouldRegisterServiceWorker({ protocol: "http:", baseUrl: "/" }), false);
  assert.equal(shouldRegisterServiceWorker({ protocol: "https:", baseUrl: "./" }), false);
});
```

- [ ] **Step 2: 執行測試確認失敗，實作後確認通過**

Run: `node --experimental-strip-types --test src/lib/install-mode.test.ts`

Expected: 先 FAIL；實作 `src/lib/install-mode.ts` 之後 PASS（2 tests）。

- [ ] **Step 3: 產生圖示**

`scripts/generate-icons.mjs`：
- 用 Playwright 開 chromium；失敗時改用 `channel: "chrome"`。
- 用 `page.setContent` 放入與 `src/components/brand-mark.tsx` 相同的 SVG 路徑，各尺寸各截一張 PNG：
  - `icon-192.png`、`icon-512.png`：圓角方塊標誌，透明背景。
  - `icon-maskable-512.png`、`apple-touch-icon.png`（180）：整片底色 `#233e61`，不畫圓角框；書本與 K 棒圖形縮到 64%，置中，落在 maskable 的安全區內。

Run: `node scripts/generate-icons.mjs`

Expected: 產生 4 個檔案，尺寸正確。用 Read 工具打開檢查外觀。

- [ ] **Step 4: manifest、head 與 service worker**

`manifest.webmanifest`：
- 保留現有的 `name`、`short_name`、`lang`、`background_color`、`theme_color`。
- 補上 `"id": "/"`、`"scope": "/"`、`"start_url": "/"`、`"display": "standalone"`。
- `icons` 改為：SVG（`any`）、192、512、maskable 512（`"purpose": "maskable"`）。

`__root.tsx`：
- links 加 `{ rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" }`。
- meta 加 `{ name: "mobile-web-app-capable", content: "yes" }`、`{ name: "apple-mobile-web-app-title", content: APP_NAME }`、`{ name: "apple-mobile-web-app-status-bar-style", content: "default" }`。
- body 內掛 `<PwaEffect />`。

`public/sw.js`：
- `install` 時 `self.skipWaiting()`；`activate` 時 `event.waitUntil(self.clients.claim())`。
- 不寫 `fetch` 處理。
- 檔頭註解：「刻意不快取：網站更新與行情都直接走網路」。

`pwa-effect.tsx`：
- `shouldRegisterServiceWorker({ protocol: location.protocol, baseUrl: import.meta.env.BASE_URL })` 為 true 時，`navigator.serviceWorker?.register("/sw.js")`。錯誤靜默忽略。
- 監聽 `beforeinstallprompt`：`preventDefault()` 後存入 `useInstallPrompt`。
- 監聽 `appinstalled`：清除 `useInstallPrompt`。

- [ ] **Step 5: 安裝卡片**

`install-card.tsx`：
- **判斷**：用 `installMode` 判斷；`standalone` 由 `matchMedia("(display-mode: standalone)").matches || navigator.standalone === true` 取得。
- **不顯示的情況**：`none`，或 `readDeviceValue(browserStorage(), INSTALL_DISMISSED_KEY) === "dismissed"`。
- **共同標題**：「加到主畫面，下次一點就開」。
- **Android**：
  - 說明「安裝後會像 App 一樣出現在手機桌面。」
  - 按鈕「安裝」：呼叫 `prompt.prompt()`，完成後清除。
- **iPhone**：三個大字步驟（`<ol>`，大字模式至少 18px）：
  1. 點畫面下方的「分享」按鈕（方框加向上箭頭）
  2. 往下滑，選「加入主畫面」
  3. 點右上角的「新增」
- **關閉**：「不用了」按鈕寫入 `"dismissed"` 並隱藏。

- [ ] **Step 6: 全部檢查並提交**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`。

`npm run build` 後確認 `.output/public/sw.js`、`.output/public/icons/*` 都存在。

Expected: 全部通過。

```bash
git add scripts/generate-icons.mjs public/icons public/manifest.webmanifest public/sw.js src/routes/__root.tsx src/lib/install-mode.ts src/lib/install-mode.test.ts src/components/pwa-effect.tsx src/components/install-card.tsx src/components/lobby.tsx
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: home-screen install with app icons and an install card for Android and iPhone" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 訪客上手的畫面檢查與紀錄

**Files:**
- Modify: `scripts/qa/desk-server.mjs`：狀態檔多寫 `gateCode` 與 `appBase`。只寫到被 git 忽略的 `artifacts/trading-desk-qa/`，而且是一次性的測試環境。
- Create: `scripts/qa/desk-guest.mjs`
- Create: `docs/easy-start-2026-10-16.md`

**Interfaces:**
- Consumes: 前面所有 Task 的畫面與 accessible name：
  - 入場碼頁：「教室入場碼」欄位、「進入教室」按鈕
  - 大廳：「開始今天的練習」
  - 計畫表：「突破前高」radio、「用這個計畫開始」
  - 教練提示：「下一步」「完成」「跳過」
  - 訪客：「建立帳號」「之後再說」
  - 「文字大小」radiogroup
- Produces: `node scripts/qa/desk-guest.mjs <label>`。從 `artifacts/trading-desk-qa/server-18811.json` 讀 `appBase` 與 `gateCode`；以全新瀏覽器、不經過帶 cookie 的 proxy，直接連 `appBase`。

- [ ] **Step 1: 寫檢查腳本**

案例：375×812、320×700、375×812 大字、1366×900。大字用 `addInitScript` 寫入 `day-tycoon-display-v1=senior`。

每個案例依序：
1. 開 `appBase/`，在「教室入場碼」填入 `gateCode`，按「進入教室」。之後開始計算點擊次數。
2. 點「開始今天的練習」（第 1 下）。
3. 等計畫表出現：「突破前高」的 `aria-checked="true"`。訪客聲明句可見。
4. 點「用這個計畫開始」（第 2 下）。
5. 等到 `main canvas[role="img"]` 可見，而且 `/api/morning` 的 `state.cursor === 1`。斷言點擊次數為 2。
6. 教練提示出現，標題為「看走勢圖」，截圖。按「下一步」兩次、「完成」一次。重新整理後，沒有 `role="dialog"`。
7. 訪客提示「目前是訪客」可見。「文字大小」radiogroup 在交易畫面頂端可見。
8. 開啟復盤，寫入「第一次練習，先看懂畫面。」並保存。`GuestSaveCard` 出現，截圖。
9. 回大廳：今天三件事顯示「今天完成了，明天再來」與「再練一輪」，截圖。

每個畫面都用 `desk-layout.mjs` 的 `scan` 規則：
- 文字 ≥ 11px，沒有水平溢出或截斷。
- 手機寬度的控制項 ≥ 44px。
- 大字案例另外檢查教練提示、訪客卡、今天三件事的主要按鈕 ≥ 56px。

有失敗時印出清單，並設 `process.exitCode = 1`。

- [ ] **Step 2: 執行全部檢查**

Run，依序：

```bash
npm test
npm run typecheck
npx eslint src --quiet
npm run build
```

再啟動 `desk-server.mjs`，然後執行：
- `desk-seed.mjs`
- `desk-layout.mjs --strict`
- `desk-orders.mjs`
- `desk-sharpness.mjs`
- `desk-guest.mjs easy-start`

最後跑三個隔離整合測試：`auth-integration`、`morning-integration`、`guest-integration`。

Expected: 全部通過。截圖存在 `artifacts/trading-desk-qa/easy-start/`。用 Read 工具逐張看過手機、大字與桌機的截圖。

- [ ] **Step 3: 寫紀錄**

`docs/easy-start-2026-10-16.md`（繁體中文）記錄：
- 完成的功能
- 對規格的調整，抄本計畫「對規格的補充與調整」
- 測試與檢查結果，含數字
- 截圖位置
- 尚未驗證的項目：真實 Android 與 iPhone 的安裝、實機朗讀
- 部署注意：啟動時會自動執行 `0008` 遷移

- [ ] **Step 4: 提交**

```bash
git add scripts/qa/desk-server.mjs scripts/qa/desk-guest.mjs docs/easy-start-2026-10-16.md
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "test: guest onboarding screen checks and the easy-start record" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
