# 紀律等級、稱號與慶祝 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Learners earn discipline points (plus a small 眼力 bonus) from the daily question and morning practice, see levels, titles and badges in the lobby and on `/progress`, and get a short in-page celebration after answering or finishing a round.

**Architecture:** Points are computed on every request from existing rows (`daily_answers` + `daily_questions.payload` level/outcome, completed `morning_sessions.state_json`) by pure functions in `src/lib/discipline/`; no table, no migration. A celebration is the difference between the summary without and with the event just written, returned by `POST /api/daily` and the morning `finish` action. A new `GET /api/discipline` feeds the lobby strip and `/progress`.

**Tech Stack:** React 19, TanStack Start file routes, PGlite/Postgres via the `Sql` tag, node:test with `--experimental-strip-types`, Playwright QA scripts in `scripts/qa/`.

**Spec:** `docs/superpowers/specs/2026-10-18-discipline-levels-design.md`

## Global Constraints

- Points never depend on profit or loss; no deductions, no level loss; never show 「答錯」 or a zero 眼力 line.
- Daily: answered +10 (discipline), reason +5 (discipline), 眼力 +3 when (brokeOut && choice=enter) || (!brokeOut && choice∈{watch,skip}).
- Practice: per Taipei day of `created_at`, only completed rounds, best round counts: completed with reflection +15, all orders on `plan.focusCode` +5 (no orders counts), no remaining positions +5 (no orders counts).
- Levels (min total): 1 新手學員 0, 2 準時報到 25, 3 有計畫 80, 4 停損守門員 160, 5 紀律學員 280, 6 穩健操盤 450, 7 冷靜判讀 680, 8 紀律高手 980, 9 盤感老手 1350, 10 紀律大師 1800.
- Badges: first-daily 第一題, first-practice 第一輪, streak-5 連續 5 天, full-week 全勤一週, reasons-10 說出理由 10 次, practice-5 練習 5 天, daily-20 每日一題 20 題, practice-20 練習 20 天.
- Sound is off by default, stored on the device under `day-tycoon-sound-v1` (`"on"`/`"off"`), Web Audio sine tones only, ≤ 1 s, only after a click.
- Celebration is in-page (never a blocking modal); `prefers-reduced-motion` shows the final state with no animation.
- Mobile/senior: no horizontal overflow at 375/320/820/1366 and senior 375/1366; targets ≥ 44px (senior ≥ 56px); text ≥ 11px; contrast ≥ 4.5:1.
- Same guards as `/api/daily` for `/api/discipline`; production never sets `DAILY_NOW_ISO`.
- Never `git add -A`; commit with `-c user.name=Claude -c user.email=noreply@anthropic.com`; no push or deploy without the user's approval.

## Review Focus

1. A learner who answered before this release: their past answers and finished rounds must count on day one (summary from existing rows).
2. Retried requests (same daily answer twice, same `finish` requestId twice) must not celebrate twice.
3. A guest who signs up keeps every point (records move in `linkGuestRecords`; the summary must read the account's rows only).
4. Two finished rounds on the same Taipei day: only the better one counts, and the second shows 「今天的練習分已經算過了」 instead of +0.
5. A week with a holiday (four questions) earns 全勤一週 only once that week is over; a five-question week earns it on the fifth answer.

---

### Task 1: Pure scoring core

**Files:**
- Create: `src/lib/discipline/score.ts`, `src/lib/discipline/score.test.ts`
- Modify: `src/lib/daily/reveal.ts` (export `brokeOut`)

**Interfaces:**
- Produces:
  ```ts
  export type DailyRecord = { questionId: string; issueDate: string; choice: DailyChoice; reason: boolean; brokeOut: boolean };
  export type PracticeRecord = { id: string; day: string; reflection: boolean; onPlan: boolean; flat: boolean };
  export type DisciplineInput = { daily: DailyRecord[]; practice: PracticeRecord[]; issued: string[]; now: number };
  export type ScoreLineId = "answered" | "reason" | "eye" | "completed" | "on-plan" | "flat";
  export type ScoreLine = { id: ScoreLineId; label: string; points: number; kind: "discipline" | "eye" };
  export type ScoreEvent = { key: string; source: "daily" | "practice"; date: string; points: number; lines: ScoreLine[] };
  export type LevelView = { no: number; title: string; min: number; next: { no: number; title: string; min: number } | null };
  export type BadgeId = "first-daily" | "first-practice" | "streak-5" | "full-week" | "reasons-10" | "practice-5" | "daily-20" | "practice-20";
  export type BadgeView = { id: BadgeId; title: string; rule: string; earned: boolean; earnedOn: string | null; have: number; need: number };
  export type DisciplineSummary = { total: number; discipline: number; eye: number; level: LevelView; badges: BadgeView[]; recent: ScoreEvent[] };
  export type Celebration = { source: "daily" | "practice"; gained: ScoreLine[]; points: number; beforeTotal: number; total: number;
    before: LevelView; after: LevelView; newBadges: BadgeView[]; alreadyCounted: boolean };
  export const LEVELS: readonly { no: number; title: string; min: number; cheer: string }[];
  export function levelFor(total: number): LevelView;
  export function dailyLines(record: DailyRecord): ScoreLine[];
  export function practiceLines(record: PracticeRecord): ScoreLine[];
  export function disciplineSummary(input: DisciplineInput): DisciplineSummary;
  export function celebrationFor(before: DisciplineInput, after: DisciplineInput, source: "daily" | "practice"): Celebration;
  export function brokeOut(outcome: DailyOutcome, level: number): boolean; // reveal.ts, now exported
  ```
  Event keys: `daily:<questionId>`, `practice:<day>`. Event date = issue date / practice day. `recent` = newest 10 by date desc (daily before practice on the same date). Labels: 完成作答, 說出理由, 眼力：判讀和走勢一致, 完成一輪並復盤, 照計畫的股票, 收盤前不留倉. Week of an issue date = Monday-based Taipei week; a week is over when `weekDates(now)[0]` is after that week's Friday.

- [ ] **Step 1: Write the failing tests** (`score.test.ts`), one `test()` each:
  - `dailyLines`: no reason, wrong read → `[answered 10]`; reason + enter on breakout → `[answered 10, reason 5, eye 3]`; skip and watch on no breakout get eye; watch on breakout gets none; "wrong with reason" (15) > "right without reason" (13).
  - `practiceLines`: completed+onPlan+flat → 25; off-plan and holding → 15; `reflection: false` → `[]`.
  - Practice day cap: two rounds on `2026-10-19` worth 15 and 25 → one event of 25; rounds on two days → two events.
  - `levelFor`: 0 → Lv1 next Lv2@25; 24 → Lv1; 25 → Lv2 準時報到; 1800 → Lv10 next null; 5000 → Lv10.
  - Badges: first-daily earnedOn = earliest answer's issue date; streak-5 earned across an issued gap (no question on a weekday is not in `issued`, so it never breaks) and not earned when an issued question in the middle is unanswered; full-week: five answered in one week → earned on the Friday date; four issued + four answered with `now` inside that week → not earned, with `now` the next Monday → earned; reasons-10 `have` counts reasons, capped at `need`; practice-5 counts distinct days.
  - `celebrationFor`: first daily (reason) from empty → gained `[answered, reason]`, points 15, before Lv1, after Lv1, newBadges `[first-daily]`; daily+practice crossing 25 → after Lv2; a second same-day round worth less → points 0, `alreadyCounted: true`, gained `[]`; a better second round → points = difference, gained = the new round's lines, `alreadyCounted: false`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test src/lib/discipline/score.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `score.ts` (import `weekDates` from `../daily/schedule.ts`, types from `../daily/types.ts`); export `brokeOut` in `reveal.ts` unchanged.
- [ ] **Step 4: Run** the same command — Expected: PASS. Then `npm test` — Expected: 0 fail.
- [ ] **Step 5: Commit** `feat: discipline points, levels and badges computed from practice records`.

### Task 2: Server loader and `/api/discipline`

**Files:**
- Create: `src/lib/discipline.server.ts`, `src/lib/discipline.server.test.ts`, `src/routes/api/discipline.ts`

**Interfaces:**
- Consumes: Task 1 types and `disciplineSummary`, `brokeOut`; `requirePracticeAccess` from `morning-session.server.ts`.
- Produces:
  ```ts
  export async function readDisciplineInput(sql: Sql, userId: string, now: number): Promise<DisciplineInput>;
  export async function loadDiscipline(sql: Sql, userId: string, now: number): Promise<DisciplineSummary>; // requirePracticeAccess first
  ```
  Daily rows: `SELECT a.question_id, q.issue_date::text, a.choice, a.reason IS NOT NULL AS reason, q.payload->'level' AS level, q.payload->'outcome' AS outcome FROM daily_answers a JOIN daily_questions q ON q.id = a.question_id WHERE a.user_id = $1 AND q.issue_date IS NOT NULL AND q.payload IS NOT NULL` (never select `payload` whole). Issued: same query as `loadDaily` (`issue_date <= issueDayFor(now)`). Practice rows: completed only, `to_char(created_at AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') AS day`, `state_json->'plan'->>'focusCode'`, `state_json->>'reflection'`, `state_json->'orders'`, `state_json->'positions'`; onPlan = every order's `code` equals focusCode; flat = every position's `shares` is 0; reflection = trimmed non-empty.
  Route: copy `/api/daily` guards (gate session, origin, both rate limiters, `active` cap, auth session) with GET only; `DAILY_NOW_ISO` pin like `/api/daily`; error copy 「目前無法讀取紀律等級，請稍後再試」.

- [ ] **Step 1: Write failing PGlite tests** (`discipline.server.test.ts`, same `sqlFor`/fixture pattern as `daily-question.server.test.ts`, migrations 0001, 0003, 0007, 0008, 0009): insert two `daily_questions` (payload with `level` and an `outcome` that broke out / did not) and answers for `alice`, plus two completed and one unfinished `morning_sessions`; assert `loadDiscipline` totals, that the unfinished run is ignored, and that a guest's records linked with `linkGuestRecords` appear under the account with the same total.
- [ ] **Step 2: Run** `node --experimental-strip-types --test src/lib/discipline.server.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `discipline.server.ts` and the route.
- [ ] **Step 4: Run** the test — Expected: PASS; `npm test` 0 fail; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat: discipline summary API read from existing practice records`.

### Task 3: Celebrations in the daily and morning responses

**Files:**
- Modify: `src/lib/daily-question.server.ts` (`DailyResponse.celebration?`, `answerDaily`), `src/lib/morning.ts` (`MorningResponse.celebration?`), `src/lib/morning-session.server.ts` (finish path), `src/lib/daily-question.server.test.ts`, `src/lib/morning-session.test.ts` (add `0009_daily_questions.sql` to its migration list)

**Interfaces:**
- Consumes: `readDisciplineInput`, `celebrationFor`.
- Produces: `DailyResponse.celebration?: Celebration | null` — set only when this POST inserted the answer (read input before the INSERT, after it, diff with source `"daily"`); a resend gets `null`. `MorningResponse.celebration?: Celebration | null` — set only when this non-retry request's action is `finish` and the stored row went from not completed to completed; the retry path (same requestId) returns `null`.

- [ ] **Step 1: Write failing tests**: daily — first POST has `celebration.points === 10 + (reason ? 5 : 0) + eye` and `newBadges` includes `first-daily`; the identical second POST has `celebration === null`. Morning — start, finish → `celebration.source === "practice"`, `points === 25` for a no-order round; replaying the same finish requestId → `celebration` null; a second same-day round → `alreadyCounted: true`.
- [ ] **Step 2: Run** both test files — Expected: FAIL on `celebration` undefined.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files — PASS; `npm test` 0 fail; typecheck clean.
- [ ] **Step 5: Commit** `feat: celebrate points earned when a daily answer or a practice round is saved`.

### Task 4: Sound preference and chimes

**Files:**
- Modify: `src/lib/display-preferences.ts`, `src/lib/display-preferences.test.ts`, `src/components/display-controls.tsx`
- Create: `src/lib/celebration-sound.ts`

**Interfaces:**
- Produces: `readSoundPreference(storage): boolean` (absent → false), `writeSoundPreference(storage, on)`, store fields `sound: boolean`, `setSound(on)`; `playChime(kind: "points" | "level-up"): void` (no-op when the AudioContext is missing; creates/resumes the context inside the click that triggered the save; sine tones, gain ≤ 0.05, points = two notes, level-up = four ascending notes, total ≤ 1 s).
- DisplayControls (full, not compact) shows a second switch 「音效」 beside 朗讀提示, same `role="switch"` pattern.

- [ ] **Step 1: Failing tests** in `display-preferences.test.ts`: default off; `"on"` reads on; write then read round-trips; unrelated garbage reads off.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; `npm test`; typecheck.
- [ ] **Step 5: Commit** `feat: optional celebration sound, off by default`.

### Task 5: Celebration card on the daily reveal and the practice completion

**Files:**
- Create: `src/components/discipline-celebration.tsx`, `src/lib/discipline/copy.ts`, `src/lib/discipline/copy.test.ts`
- Modify: `src/components/daily-question.tsx`, `src/components/morning-practice.tsx` (`Completion`, `finish()`), `src/trading-desk.css`, `src/lib/speech.ts`

**Interfaces:**
- Consumes: `Celebration`, `LevelView`, `playChime`, `useSay`, `useDisplayPreferences`.
- Produces: `<DisciplineCelebration celebration={…} />`; `celebrationSpeech(c: Celebration): string` (「拿到 18 分」, plus 「升級了，第 4 級，停損守門員」 on level-up; already counted → 「今天的練習分已經算過了」); `progressText(level: LevelView, total: number): string` (「再 42 分升到 Lv4 停損守門員」 / 「已是最高等級」).
  Card: heading 「這次拿到 +N 分」 (or the already-counted sentence), one row per gained line, level row with a progress bar animated from `beforeTotal` to `total`, level-up banner with the level's `cheer`, new badges, a 「開啟音效」 button when sound is off, footer 「分數只看練習習慣與紀律，不看賺賠。」 linking to `/progress`. `aria-live="polite"`. Animations under `@media (prefers-reduced-motion: no-preference)` only.
  Completion: replace the always-true 「先觀察，再決定是否操作」 with 「照計畫的股票操作」 and 「收盤前不留倉」, each shown only when true (same rules as `practiceLines`).
  The morning client keeps the `celebration` from the `finish` response in state (cleared when a new plan starts) and renders the card under `Completion`.

- [ ] **Step 1: Failing tests** for `copy.ts` (`celebrationSpeech`, `progressText` cases above).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** copy, component, CSS, wiring; play `playChime(levelUp ? "level-up" : "points")` once per celebration when sound is on and points > 0.
- [ ] **Step 4: Run** tests, `npm test`, typecheck, `npx eslint src --quiet`.
- [ ] **Step 5: Commit** `feat: celebration card after the daily question and a finished practice round`.

### Task 6: Lobby level strip and `/progress`

**Files:**
- Create: `src/components/level-strip.tsx`, `src/components/discipline-page.tsx`, `src/routes/progress.tsx`
- Modify: `src/components/lobby.tsx` (strip after `TodayCard`, hidden offline), `src/classroom-refresh.css`, `src/trading-desk.css`

**Interfaces:**
- Consumes: `GET /api/discipline` → `DisciplineSummary`, `useGuestBootstrap` (page), `useCurrentUserState` (strip), `DisplayControls`.
- Produces: strip = one link to `/progress`: `Lv3`, title, thin bar, `progressText`, 「徽章 3／8」; renders nothing until data arrives or on error. Page sections in spec §6 order: header (返回大廳, 我的紀律, DisplayControls), level card (total, 紀律分, 眼力分, bar, next title), 怎麼得分 tables, badges grid (earned with date / locked with `have／need`), 最近得分 (≤10), level table with the current row marked.

- [ ] **Step 1:** Add a `scripts/qa/desk-discipline.mjs` stub that loads `/` and `/progress` as a fresh guest and asserts the strip and the page heading exist — run against a dev build: FAIL.
- [ ] **Step 2: Implement** the strip, page and route.
- [ ] **Step 3:** Rebuild, rerun the stub — PASS. `npm test`, typecheck, eslint.
- [ ] **Step 4: Commit** `feat: lobby level strip and the 我的紀律 page`.

### Task 7: End-to-end QA and the record

**Files:**
- Modify: `scripts/qa/desk-discipline.mjs` (full walk), `docs/superpowers/specs/2026-10-18-discipline-levels-design.md` (implementation notes), new `docs/discipline-levels-2026-10-18.md` (record)

- [ ] **Step 1:** Extend `desk-discipline.mjs`: fresh guest → `/daily` answer with a reason → card shows `+15` or `+18` and 「第一題」 → `/morning` start with a template, finish with a reflection → card shows Lv2 升級 → lobby strip shows Lv2 → `/progress` shows badges; at 375×812, 320×700, 820×900, 1366×900, senior 375 and 1366: no overflow, text ≥ 11px, targets ≥ 44/56, contrast ≥ 4.5; with `reducedMotion: "reduce"` the card has no running animations; no `AudioContext` is created while sound is off.
- [ ] **Step 2:** `npm run build`, `desk-server` on ports 18850/18851 with `DAILY_NOW_ISO`, run `desk-discipline`, `desk-daily`, `desk-guest`, `desk-premium`, `desk-layout --strict`, `desk-states`, `desk-orders` — all PASS.
- [ ] **Step 3:** Write the record; commit `docs: record sub-project C`.
