import { createHash, randomUUID } from "node:crypto";
import { advanceDelta, applyMorningAction, createMorningState, endMorningRun, MorningError, parseMorningAction,
  visibleMorningState, visibleTape, type MorningStoredState } from "./morning-engine.ts";
import type { Sql } from "./db.ts";
import type { MorningAction, MorningBookCell, MorningReply, MorningResponse, MorningState } from "./morning.ts";
import { celebrationAfterSave } from "./discipline/records.server.ts";
import type { Celebration } from "./discipline/score.ts";
import { parseLessonId, type RunSource } from "./lessons/daily-lessons.server.ts";
import { MAX_RUN_CODES } from "./lessons/default-codes.ts";
import { marketDataDir } from "./lessons/market-files.server.ts";
import type { LessonPicker, RunRecord } from "./lessons/types.ts";
import {
  MarketMiss,
  MorningMarket,
  NO_DAILY_LESSONS,
  NOT_OPEN,
  RETIRED_LESSON,
  RETIRED_LESSONS,
  isRetiredLesson,
  lessonDate,
  lessonSummaries,
  requestedLesson,
  resolveMorningSource,
  textOnlyCatalog,
} from "./morning-data.server.ts";

type SessionRow = { id: string; state_json: MorningStoredState | string };
function stored(row: SessionRow): MorningStoredState {
  return typeof row.state_json === "string" ? JSON.parse(row.state_json) : row.state_json;
}
export type PracticeAccess = { kind: "member" } | { kind: "guest"; consented: boolean };
/**
 * Members need an accepted classroom profile; guests (anonymous accounts) never get one and
 * accept the teaching statement by pressing start. The row lock serializes concurrent starts
 * and keeps request idempotency per owner.
 */
export async function requirePracticeAccess(sql: Sql, userId: string): Promise<PracticeAccess> {
  const profile = await sql<{ tos_accepted_at: unknown }>`
    SELECT tos_accepted_at FROM classroom_profiles WHERE user_id = ${userId} FOR UPDATE`;
  if (profile[0]?.tos_accepted_at) return { kind: "member" };
  const user = await sql<{ isAnonymous: boolean }>`SELECT "isAnonymous" FROM "user" WHERE id = ${userId} FOR UPDATE`;
  if (!user[0]?.isAnonymous) throw new MorningError(403, "請先完成學員資料與教學聲明");
  const consent = await sql<{ user_id: string }>`SELECT user_id FROM guest_consents WHERE user_id = ${userId}`;
  return { kind: "guest", consented: consent.length > 0 };
}

/**
 * What a request is served with: the query, the market data (a request's own MorningMarket, else one on `dir`,
 * default MARKET_DATA_DIR, that reads on demand) and the clock.
 */
export type MorningRequestOptions = {
  params?: URLSearchParams;
  dir?: string;
  market?: MorningMarket;
  clock?: number | (() => number);
};
const marketOf = (options: MorningRequestOptions) => options.market ?? new MorningMarket(options.dir ?? marketDataDir());

const NOT_FOUND = "找不到這份練習";
const ONLY_RUN_STOCKS = "請選擇本課程提供的股票";
const LISTED_CODE = /^\d{4}$/;
const RECORDS_SHOWN = 20;
/** Every run of a retired lesson held all of its five stocks (it chose none). */
const RETIRED_RUN_STOCKS = 5;
const money = (amount: number) => Math.round(amount * 100) / 100;

/** A daily lesson's run always holds its stocks; one without is not a run this API can serve. */
function runCodes(state: MorningStoredState): string[] {
  if (!state.codes?.length) throw new MorningError(409, "課程版本已變更，請聯絡講師確認這份練習");
  return state.codes;
}

/** The learner's unfinished runs of daily lessons, the one touched last first. */
async function openLessonIds(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ lesson_id: string }>`SELECT lesson_id FROM morning_sessions
    WHERE user_id = ${userId} AND completed = FALSE AND lesson_id LIKE 'fubon-%'
    ORDER BY updated_at DESC, created_at DESC, id DESC`;
  return rows.map((row) => row.lesson_id);
}

/** The learner's latest runs, newest first, with what the records list shows; a retired lesson's runs included. */
export async function readRunRecords(sql: Sql, userId: string): Promise<RunRecord[]> {
  const rows = await sql<{
    id: string; lesson_id: string; completed: boolean; equity: number | null; starting: number | null;
    codes: number | null; reflected: boolean; abandoned: boolean;
  }>`
    SELECT id::text AS id, lesson_id, completed,
      CASE WHEN jsonb_typeof(state_json->'equity') = 'number' THEN (state_json->>'equity')::float8 END AS equity,
      CASE WHEN jsonb_typeof(state_json->'startingCash') = 'number' THEN (state_json->>'startingCash')::float8 END AS starting,
      CASE WHEN jsonb_typeof(state_json->'codes') = 'array' THEN jsonb_array_length(state_json->'codes') END AS codes,
      btrim(COALESCE(state_json->>'reflection', '')) <> '' AS reflected,
      COALESCE(state_json->>'abandoned' = 'true', FALSE) AS abandoned
    FROM morning_sessions
    WHERE user_id = ${userId} AND (lesson_id LIKE 'fubon-%' OR lesson_id = ANY(${Object.keys(RETIRED_LESSONS)}::text[]))
    ORDER BY created_at DESC, id DESC LIMIT ${RECORDS_SHOWN}`;
  return rows.flatMap((row) => {
    const date = lessonDate(row.lesson_id);
    if (!date) return [];
    const retired = isRetiredLesson(row.lesson_id);
    const equity = Number(row.equity);
    const starting = Number(row.starting);
    return [{
      id: row.id,
      lessonId: row.lesson_id,
      date,
      codes: row.codes ?? (retired ? RETIRED_RUN_STOCKS : 0),
      pnl: row.equity !== null && row.starting !== null && Number.isFinite(equity) && Number.isFinite(starting) ? money(equity - starting) : 0,
      reflected: Boolean(row.reflected),
      abandoned: Boolean(row.abandoned),
      retired,
      completed: Boolean(row.completed),
    }];
  });
}

/** The recorded books of one of the run's stocks in the cell just revealed (cursor − 1); never any other cell. */
async function revealedBook(market: MorningMarket, date: string, source: RunSource, state: MorningStoredState, code: string): Promise<MorningBookCell | undefined> {
  if (!source.booksAvailable || state.cursor < 1 || !runCodes(state).includes(code)) return undefined;
  const cell = await market.book(date, code, state.cursor - 1);
  return cell ? { code, ...cell } : undefined;
}

/** GET and start: the run's revealed bars, TAIEX and latest trades. */
function snapshot(state: MorningStoredState, source: RunSource): MorningResponse {
  return { catalog: source.catalog, state: visibleMorningState(state, source), tape: visibleTape(state, source) };
}

/** Any other action: the run without bars or TAIEX (the desk already has them), checked against its source. */
function step(state: MorningStoredState, source: RunSource): MorningResponse {
  const visible: MorningState = visibleMorningState(state, source);
  visible.bars = {};
  delete visible.index;
  return { catalog: source.catalog, state: visible };
}

/** An advance: the step and the cell it revealed, with the viewed stock's books of that cell when the day has them. */
async function advanceStep(market: MorningMarket, date: string, state: MorningStoredState, source: RunSource, view: string | undefined): Promise<MorningResponse> {
  const delta = advanceDelta(state, source);
  if (view !== undefined) {
    const book = await revealedBook(market, date, source, state, view);
    if (book) delta.book = book;
  }
  return { catalog: source.catalog, state: { ...state, bars: {} }, delta };
}

/**
 * The reply to an action on this run. A finished or abandoned run needed no market data to end, and its reply does
 * not either: when the day's data cannot be read, the saved state goes back with a text-only catalog.
 */
async function replyTo(action: MorningAction, market: MorningMarket, date: string, state: MorningStoredState, guest: boolean): Promise<MorningResponse> {
  const source = market.runSource(date, runCodes(state), guest);
  if (action.action === "finish" || action.action === "abandon") {
    try {
      return step(state, await source);
    } catch (error) {
      if (!(error instanceof MorningError)) throw error;
      return { catalog: textOnlyCatalog(state, date), state: { ...state, bars: {} } };
    }
  }
  if (action.action === "start") return snapshot(state, await source);
  if (action.action === "advance") return advanceStep(market, date, state, await source, action.view);
  return step(state, await source);
}

/** A new run's stocks: 1–80 different listed stocks of the day's picker, the plan's 主角股 one of them. */
function checkStart(action: Extract<MorningAction, { action: "start" }>, picker: LessonPicker): void {
  const { codes } = action;
  if (new Set(codes).size !== codes.length) throw new MorningError(400, `請選 1 到 ${MAX_RUN_CODES} 檔不重複的上市股票`);
  const offered = new Set(picker.symbols.map((symbol) => symbol.code));
  if (!codes.every((code) => LISTED_CODE.test(code) && offered.has(code))) throw new MorningError(400, "請從這天可練習的股票中選擇");
  if (!codes.includes(action.plan.focusCode)) throw new MorningError(400, "請從選的股票挑主角股");
}

/**
 * GET /api/morning. Always use a transaction-bound SQL handle and the user ID from the verified cookie session.
 * The lesson asked for shows its latest run, finished or not; with none asked for, the latest unfinished run, else
 * the newest day's picker. A guest's picker and wording never use the 當沖 list. A run whose day's data cannot be
 * read now never locks the learner out: the day's picker (the newest day's, when none was asked for) opens instead,
 * and an unfinished one is named in `blockedRun`, as it can still be finished or abandoned.
 */
export async function loadMorningSession(sql: Sql, userId: string, options: MorningRequestOptions = {}): Promise<MorningReply> {
  const access = await requirePracticeAccess(sql, userId);
  const guest = access.kind === "guest";
  const market = marketOf(options);
  const target = await resolveMorningSource(options.params ?? new URLSearchParams(), { openLessonIds: () => openLessonIds(sql, userId) }, market);
  if (target.kind === "unavailable") return { unavailable: target.unavailable };
  const { date, lessonId } = target;
  let rows: SessionRow[] = [];
  if (target.from === "query")
    rows = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions
      WHERE user_id = ${userId} AND lesson_id = ${lessonId} ORDER BY created_at DESC, id DESC LIMIT 1`;
  else if (target.from === "open-run")
    rows = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions
      WHERE user_id = ${userId} AND lesson_id = ${lessonId} AND completed = FALSE ORDER BY created_at DESC, id DESC LIMIT 1`;
  const shared = { lessons: lessonSummaries(target.days), records: await readRunRecords(sql, userId) };
  let pickerDate = date;
  let blockedRun: MorningResponse["blockedRun"];
  if (rows[0]) {
    const state = stored(rows[0]);
    try {
      const source = await market.runSource(date, runCodes(state), guest);
      const response: MorningResponse = { ...snapshot(state, source), ...shared };
      const book = await revealedBook(market, date, source, state, state.plan.focusCode);
      if (book) response.book = book;
      if (state.completed) {
        const picker = await market.picker(date, guest);
        if (picker) response.picker = picker;
      }
      return response;
    } catch (error) {
      if (!(error instanceof MorningError)) throw error;
      if (!state.completed)
        blockedRun = { id: state.id, lessonId: state.lessonId, date, revision: state.revision, message: error.message };
      if (target.from === "open-run") pickerDate = target.days[0];
    }
  }
  const picker = await market.picker(pickerDate, guest);
  if (!picker) throw new MorningError(400, NOT_OPEN);
  return { catalog: await market.pickerCatalog(picker, guest), state: null, ...shared, picker, ...(blockedRun ? { blockedRun } : {}) };
}

/**
 * POST /api/morning: one action, exactly once (retries return this run's current, already revealed state). A start
 * goes to the lesson in the query, else the latest unfinished run's day, else the newest day; any other action
 * finds its run by id (and, with a lesson in the query, only on that lesson). Finishing and abandoning need no
 * market data, so a run whose day's data cannot be read can always be ended.
 */
export async function mutateMorningSession(sql: Sql, userId: string, input: unknown, options: MorningRequestOptions = {}): Promise<MorningReply> {
  const action = parseMorningAction(input);
  const access = await requirePracticeAccess(sql, userId);
  const guest = access.kind === "guest";
  const params = options.params ?? new URLSearchParams();
  const market = marketOf(options);
  // A start finds its lesson like a GET (the open days are listed). Any other action, every advance included, reads
  // no lesson list: its lesson is the query's or its run's, and the day is checked open when the run's data is read.
  let lessonId: string | null;
  if (action.action === "start") {
    const target = await resolveMorningSource(params, { openLessonIds: () => openLessonIds(sql, userId) }, market);
    if (target.kind === "unavailable") return { unavailable: target.unavailable };
    lessonId = target.lessonId;
  } else {
    lessonId = requestedLesson(params)?.lessonId ?? null;
    if (!market.dir) return { unavailable: NO_DAILY_LESSONS };
  }
  const acceptsTerms = action.action === "start" && action.guestTerms === true;
  if (access.kind === "member" && acceptsTerms) throw new MorningError(400, "這個帳號不需要訪客聲明");
  if (access.kind === "guest" && !access.consented) {
    if (!acceptsTerms) throw new MorningError(403, "請先確認教學聲明");
    await sql`INSERT INTO guest_consents (user_id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
  }
  if (lessonId === null && action.action !== "start") {
    const owned = await sql<{ lesson_id: string }>`SELECT lesson_id FROM morning_sessions
      WHERE id = ${action.id}::uuid AND user_id = ${userId} FOR UPDATE`;
    if (!owned[0]) throw new MorningError(404, NOT_FOUND);
    if (isRetiredLesson(owned[0].lesson_id)) throw new MorningError(404, RETIRED_LESSON);
    lessonId = owned[0].lesson_id;
  }
  if (lessonId === null) throw new MorningError(404, NOT_FOUND);
  const date = parseLessonId(lessonId);
  if (!date) throw new MorningError(404, NOT_FOUND);
  // Read the clock after acquiring the owner lock: queued requests cannot reuse stale elapsed time.
  const clock = options.clock ?? Date.now;
  const now = typeof clock === "function" ? clock() : clock;
  const hash = createHash("sha256").update(lessonId + "\n" + JSON.stringify(action)).digest("hex");
  const previous = await sql<{ action_hash: string; session_id: string }>`
    SELECT action_hash, session_id FROM morning_requests WHERE user_id = ${userId} AND request_id = ${action.requestId}::uuid`;
  if (previous[0]) {
    if (previous[0].action_hash !== hash) throw new MorningError(409, "這個操作編號已用於不同內容，請重新讀取練習");
    const rows = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions WHERE id = ${previous[0].session_id}::uuid
      AND user_id = ${userId} AND lesson_id = ${lessonId} FOR UPDATE`;
    if (!rows[0]) throw new MorningError(404, NOT_FOUND);
    return replyTo(action, market, date, stored(rows[0]), guest);
  }
  let state: MorningStoredState;
  let celebration: Celebration | null = null;
  if (action.action === "start") {
    const active = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions
      WHERE user_id = ${userId} AND lesson_id = ${lessonId} AND completed = FALSE FOR UPDATE`;
    if (active[0]) {
      // One unfinished run per lesson: a start gives it back unchanged (to change stocks, abandon it first).
      state = stored(active[0]);
    } else {
      // Checked against the day's picker before any file of the stocks is read: only the strict check is a 409.
      const picker = await market.picker(date, guest);
      if (!picker) throw new MorningError(400, NOT_OPEN);
      checkStart(action, picker);
      const source = await market.runSource(date, action.codes, guest);
      state = createMorningState(randomUUID(), action.plan, source, now, action.codes);
      await sql`INSERT INTO morning_sessions (id, user_id, lesson_id, state_json)
        VALUES (${state.id}::uuid, ${userId}, ${state.lessonId}, ${JSON.stringify(state)}::jsonb)`;
    }
  } else {
    const rows = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions
      WHERE id = ${action.id}::uuid AND user_id = ${userId} AND lesson_id = ${lessonId} FOR UPDATE`;
    if (!rows[0]) throw new MorningError(404, NOT_FOUND);
    const before = stored(rows[0]);
    const codes = runCodes(before);
    if (action.action === "finish" || action.action === "abandon") state = endMorningRun(before, action);
    else {
      if (action.action === "advance" && action.view !== undefined && !codes.includes(action.view))
        throw new MorningError(400, ONLY_RUN_STOCKS);
      state = applyMorningAction(before, action, await market.runSource(date, codes, guest), now);
    }
    await sql`UPDATE morning_sessions SET state_json = ${JSON.stringify(state)}::jsonb,
      completed = ${state.completed}, updated_at = NOW() WHERE id = ${state.id}::uuid AND user_id = ${userId}`;
    // The engine refuses a finished run, so a finish that gets here completes it exactly once. Abandoning never counts.
    if (action.action === "finish" && !before.completed && state.completed)
      celebration = await celebrationAfterSave(sql, userId, now, { practice: state.id });
  }
  const counts = await sql<{ count: number }>`SELECT count(*)::int AS count FROM morning_requests WHERE session_id = ${state.id}::uuid`;
  if (counts[0].count >= 1_000) throw new MorningError(429, "本次練習操作次數已達上限，請聯絡講師");
  await sql`INSERT INTO morning_requests (user_id, request_id, session_id, action_hash)
    VALUES (${userId}, ${action.requestId}::uuid, ${state.id}::uuid, ${hash})`;
  const response = await replyTo(action, market, date, state, guest);
  return celebration ? { ...response, celebration } : response;
}

/**
 * Before the transaction of a POST: which runs and stocks the action is about, read without holding anything, and
 * their market data loaded. Best effort: whatever goes wrong here is met again inside the transaction.
 */
async function prepareAction(sql: Sql, userId: string, input: unknown, params: URLSearchParams, market: MorningMarket): Promise<void> {
  const action = parseMorningAction(input);
  const guest = (await requirePracticeAccess(sql, userId)).kind === "guest";
  type RunRow = SessionRow & { lesson_id: string };
  const runs: RunRow[] = [];
  const recorded = await sql<{ session_id: string }>`
    SELECT session_id FROM morning_requests WHERE user_id = ${userId} AND request_id = ${action.requestId}::uuid`;
  const ids = [...recorded.map((row) => row.session_id), ...(action.action === "start" ? [] : [action.id])];
  if (ids.length)
    runs.push(...await sql<RunRow>`SELECT id, lesson_id, state_json FROM morning_sessions
      WHERE user_id = ${userId} AND id = ANY(${ids}::uuid[])`);
  if (action.action === "start") {
    const target = await resolveMorningSource(params, { openLessonIds: () => openLessonIds(sql, userId) }, market);
    if (target.kind !== "lesson") return;
    const active = await sql<RunRow>`SELECT id, lesson_id, state_json FROM morning_sessions
      WHERE user_id = ${userId} AND lesson_id = ${target.lessonId} AND completed = FALSE`;
    runs.push(...active);
    const picker = active[0] ? null : await market.picker(target.date, guest);
    let accepted = false;
    try {
      if (picker) checkStart(action, picker);
      accepted = picker !== null;
    } catch {
      // refused inside the transaction, before any stock's data is needed
    }
    if (accepted) await market.runSource(target.date, action.codes, guest).catch(() => undefined);
  }
  // An advance reveals cell `cursor`; a retried one answers with cell `cursor − 1`.
  const view = action.action === "advance" ? action.view : undefined;
  for (const run of runs) {
    const date = parseLessonId(run.lesson_id);
    const state = stored(run);
    if (!date || !state.codes?.length) continue;
    await market.runSource(date, state.codes, guest).catch(() => undefined);
    if (view !== undefined && state.codes.includes(view))
      await Promise.all([state.cursor, state.cursor - 1].filter((cell) => cell >= 0).map((cell) => market.book(date, view, cell)));
  }
}

/** The database as /api/morning uses it: plain reads (no transaction) and one transaction per attempt. */
export type MorningDb = {
  read: () => Sql | Promise<Sql>;
  transaction: <T>(run: (sql: Sql) => Promise<T>) => Promise<T>;
};
export type MorningRequest = { method: "GET" | "POST"; params: URLSearchParams; input?: unknown };
/** Attempts of one request whose transaction met market data it had not read (data changed in between). */
const ATTEMPTS = 4;

/**
 * One /api/morning request. No market-data file is read while its transaction is open (on PGlite that would hold
 * every query of the process): the request reads what it will need first (a GET by running itself outside a
 * transaction, as it only reads; a POST by `prepareAction`), then runs in the transaction with that data sealed.
 * If something changed in between and the transaction needs more, it is aborted, the rest is read, and it runs again.
 */
export async function serveMorningRequest(
  db: MorningDb,
  userId: string,
  request: MorningRequest,
  options: { dir?: string; clock?: number | (() => number) } = {},
): Promise<MorningReply> {
  const market = new MorningMarket(options.dir ?? marketDataDir());
  const settings: MorningRequestOptions = { params: request.params, market, clock: options.clock };
  try {
    const read = await db.read();
    if (request.method === "POST") await prepareAction(read, userId, request.input, request.params, market);
    else await loadMorningSession(read, userId, settings);
  } catch {
    // Met again, and answered, inside the transaction.
  }
  for (let attempt = 1; ; attempt += 1) {
    market.seal();
    try {
      return await db.transaction((sql) => request.method === "POST"
        ? mutateMorningSession(sql, userId, request.input, settings)
        : loadMorningSession(sql, userId, settings));
    } catch (error) {
      if (!(error instanceof MarketMiss) || attempt >= ATTEMPTS) throw error;
    }
    await market.loadMissed();
  }
}
