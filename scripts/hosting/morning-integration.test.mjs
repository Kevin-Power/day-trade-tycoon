import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { fromCrossJSON, toJSONAsync } from 'seroval';
import { defaultSerovalPlugins } from '@tanstack/router-core';
import { commission, DAYTRADE_TAX, limitDown, stepTick } from '../../src/lib/market/ticks.ts';
import { FIXTURE, writeMarketFixture } from '../qa/make-market-fixture.mjs';

const entrySetting = process.env.CLASSROOM_TEST_RELEASE;
const here = dirname(fileURLToPath(import.meta.url));
const origin = 'https://morning-test.invalid';
const wait = ms => new Promise(done => setTimeout(done, ms));
const money = amount => Math.round(amount * 100) / 100;
const CELL = 60_000;
const NEWEST = 'fubon-20261027-am';
const MIDDLE = 'fubon-20261022-am';
const OLDEST = 'fubon-20261021-am';
const RETIRED = 'morning-20261005-v1-bd566804b809';

test('real HTTP daily lessons: real trades revealed one minute at a time, nothing from the future, exactly-once paper orders', {
  skip: !entrySetting ? 'Set CLASSROOM_TEST_RELEASE to an immutable built server/index.mjs' : false,
  timeout: 300000,
}, async t => {
  const entry = resolve(entrySetting);
  await access(entry);
  const port = 18796;
  const vacant = createServer();
  await new Promise((done, fail) => { vacant.once('error', fail); vacant.listen(port, '127.0.0.1', done); });
  await new Promise(done => vacant.close(done));
  const runtime = await mkdtemp(join(tmpdir(), 'morning-http-test-'));
  const marketData = join(runtime, 'market-data');
  await writeMarketFixture(marketData);
  const base = 'http://127.0.0.1:' + port;
  const password = randomBytes(20).toString('base64url');
  const gateCode = randomBytes(18).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const gateHash = ['scrypt', salt, scryptSync(gateCode, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')].join('$');
  const env = {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port),
    BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: secret, DATABASE_URL: '', PGLITE_DATA_DIR: join(runtime, 'pglite'),
    VITE_AUTH_ENABLED: 'true', CLASSROOM_AUTH_ENABLED: 'true', CLASSROOM_TRUST_PROXY: 'true', CLASSROOM_GATE_PASSWORD_HASH: gateHash,
    CLASSROOM_CODE: 'MORNINGTEST', MARKET_DATA_DIR: marketData, CLASSROOM_TEACHER_IDS: '', TEACHER_EMAILS: '', ADMIN_SETUP_EMAIL: '', ADMIN_SETUP_TOKEN: '',
    GROK_PROJECT_ID: '', GROK_AUTH_CLIENT_ID: '', GROK_AUTH_CLIENT_SECRET: '',
  };
  let profileId;
  for (const file of await readdir(join(dirname(entry), '_ssr'))) {
    if (!file.endsWith('.mjs')) continue;
    const sourceText = await readFile(join(dirname(entry), '_ssr', file), 'utf8');
    const match = sourceText.match(/upsertMyProfile_createServerFn_handler = createServerRpc\(\{\s*id: "([a-f0-9]+)"/)
      || sourceText.match(/(?:var|const|let) upsertMyProfile = [\s\S]*?createSsrRpc\("([a-f0-9]+)"\)/);
    if (match) profileId = match[1];
  }
  assert.ok(profileId, 'Built profile setup RPC must be available');
  let app;
  let logs = '';
  let stage = 'startup';
  const jars = [];
  const newJar = initial => { const jar = new Map(initial); jars.push(jar); return jar; };
  function absorb(jar, response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]; const index = pair.indexOf('=');
      const name = pair.slice(0, index); const value = pair.slice(index + 1);
      if (value) jar.set(name, value); else jar.delete(name);
    }
  }
  async function request(path, { method = 'GET', data, jar = new Map(), headers = {} } = {}) {
    const outgoing = new Headers({ origin, 'cf-connecting-ip': '192.0.2.61', ...headers });
    if (jar.size) outgoing.set('cookie', [...jar].map(([key, value]) => key + '=' + value).join('; '));
    if (data !== undefined) outgoing.set('content-type', 'application/json');
    const result = await fetch(base + path, { method, headers: outgoing, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(20000) });
    absorb(jar, result);
    const text = await result.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* assertions report status, never credentials */ }
    return { status: result.status, body, text, headers: result.headers };
  }
  async function createProfile(jar) {
    const headers = { origin, 'sec-fetch-site': 'same-origin', 'x-tsr-serverFn': 'true', accept: 'application/json', 'content-type': 'application/json',
      cookie: [...jar].map(([key, value]) => key + '=' + value).join('; ') };
    const result = await fetch(base + '/_serverFn/' + profileId, { method: 'POST', headers,
      body: JSON.stringify(await toJSONAsync({ data: { displayName: 'Morning fixture student', classCode: 'MORNINGTEST', acceptTos: true } }, { plugins: defaultSerovalPlugins })),
      signal: AbortSignal.timeout(20000) });
    assert.equal(result.status, 200);
    const payload = await result.json();
    const decoded = result.headers.get('x-tss-serialized') ? fromCrossJSON(payload, { plugins: defaultSerovalPlugins }) : payload;
    if (decoded?.error) throw decoded.error;
    assert.equal(decoded?.result?.ok ?? decoded?.ok, true);
  }
  async function launch() {
    app = fork(join(here, 'app-runner.mjs'), [entry], { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const capture = chunk => { logs = (logs + chunk.toString()).slice(-1000000); };
    app.stdout.on('data', capture); app.stderr.on('data', capture);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (app.exitCode !== null || app.signalCode !== null) throw new Error('Isolated morning app exited during startup');
      try { const result = await fetch(base + '/api/health', { signal: AbortSignal.timeout(2500) }); if (result.ok && (await result.json()).ok) return; } catch { /* readiness */ }
      await wait(100);
    }
    throw new Error('Isolated morning app readiness timed out');
  }
  async function close() {
    if (!app || app.exitCode !== null || app.signalCode !== null) return;
    const owned = app;
    const exit = new Promise(done => owned.once('exit', done));
    const closed = new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Morning database shutdown not acknowledged')), 25000);
      owned.on('message', message => {
        if (message?.type === 'shutdown-complete') { clearTimeout(timer); done(); }
        if (message?.type === 'shutdown-error') { clearTimeout(timer); fail(new Error('Morning database shutdown failed')); }
      });
    });
    owned.send({ type: 'shutdown' });
    try { await closed; } finally { owned.kill(); await exit; app = undefined; }
  }
  const post = (jar, data, headers, query = '') => request('/api/morning' + query, { method: 'POST', jar, data, headers });
  const get = (jar, query = '') => request('/api/morning' + query, { jar });
  const nextAction = (state, action, extra = {}) => ({ action, id: state.id, expectedRevision: state.revision, requestId: randomUUID(), ...extra });
  const ready = state => wait(Math.max(0, state.nextAdvanceAt - Date.now()) + 30);
  const plan = (focusCode, extra = {}) => ({ exerciseId: 'first-order', bias: 'observe', focusCode, reason: '先觀察背景與價格', entry: '確認自己的條件後再進場', stop: '理由不成立時離場', ...extra });
  const startOf = (codes, focusCode = codes[0], extra = {}) => ({ action: 'start', requestId: randomUUID(), codes, plan: plan(focusCode, extra) });

  // What the trades alone say (read straight from the fixture's files, never from the app).
  const tradeFiles = new Map();
  const tradesOf = (date, code) => {
    const key = date + code;
    if (!tradeFiles.has(key)) {
      const { trades } = JSON.parse(gunzipSync(readFileSync(join(marketData, 'ticks', date, 'symbols', code + '.json.gz'))).toString('utf8'));
      tradeFiles.set(key, trades.filter(row => row[0] < 5_400_000));
    }
    return tradeFiles.get(key);
  };
  const cellRows = (rows, cell) => rows.filter(row => row[0] >= cell * CELL && row[0] < (cell + 1) * CELL);
  const lastBefore = (rows, cursor, reference) => rows.filter(row => row[0] < cursor * CELL).at(-1)?.[1] ?? reference;
  /** The fill the rules give an order of `lots` sent at `cursor` (量夠才成交, 2026-10-30): the trades after it that
   *  touch its price (every trade for a market order) count until their lots reach the order's, and it fills at the
   *  trade that completes them — at their average (a limit no worse than itself), or at the limit when the first trade
   *  after it did not touch. One lot is the first touching trade. */
  function fillAfter(rows, cursor, side, limit, lots = 1) {
    let seen = false;
    let resting = false;
    let counted = 0;
    let value = 0;
    for (const [ms, price, size] of rows) {
      if (ms < cursor * CELL) continue;
      const touches = limit === undefined || (side === 'buy' ? price <= limit : price >= limit);
      if (!seen && !touches) resting = true;
      seen = true;
      if (!touches) continue;
      const take = Math.min(size, lots - counted);
      counted += take;
      value += price * take;
      if (counted === lots) {
        const average = value / lots;
        if (limit === undefined) return { price: average, ms };
        return { price: resting ? limit : side === 'buy' ? Math.min(average, limit) : Math.max(average, limit), ms };
      }
    }
    return null;
  }
  const assertNoFuture = (body, what) => {
    const cursor = body.state?.cursor;
    assert.equal(typeof cursor, 'number', what + ': a run');
    const end = cursor * CELL;
    for (const rows of Object.values(body.tape ?? {})) for (const row of rows) assert.ok(row[0] < end, what + ': tape trade past the cursor');
    for (const bars of Object.values(body.state.bars ?? {})) for (const bar of bars) assert.ok(bar.t < cursor * 60, what + ': bar past the cursor');
    for (const bar of body.state.index?.bars ?? []) assert.ok(bar.t < cursor * 60, what + ': TAIEX minute past the cursor');
    if (body.delta) {
      assert.equal(body.delta.cell, cursor - 1, what + ': the delta is the cell just revealed');
      for (const rows of Object.values(body.delta.trades)) for (const row of rows) assert.ok(row[0] >= (cursor - 1) * CELL && row[0] < end, what + ': delta trade outside its cell');
      for (const bar of Object.values(body.delta.bars)) if (bar) assert.equal(bar.t, (cursor - 1) * 60);
      if (body.delta.index) assert.equal(body.delta.index.t, (cursor - 1) * 60);
    }
    for (const book of [body.book, body.delta?.book]) for (const [ms] of book?.frames ?? []) assert.ok(ms < end, what + ': book frame past the cursor');
  };
  /** A run without the bars and TAIEX a snapshot carries and a step leaves out. */
  const bare = ({ bars, index, ...rest }) => rest;
  const REVIEW = '我先保留持倉，說明觀察與原先判斷的差異。';
  const HOT = FIXTURE.hot;

  try {
    await launch();
    stage = 'authentication and explicit consent';
    assert.equal((await get(new Map())).status, 403);
    assert.equal((await post(new Map(), { action: 'start' })).status, 403);
    const admitted = newJar();
    assert.equal((await request('/api/gate', { method: 'POST', data: { password: gateCode }, jar: admitted })).status, 200);
    assert.equal((await get(admitted)).status, 401);
    const members = {};
    for (const name of ['alice', 'bob', 'carol', 'dave']) {
      const jar = members[name] = newJar(admitted);
      assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', jar, data: { name: 'Morning fixture', email: name + '@example.invalid', password } })).status, 200);
      assert.equal((await get(jar)).status, 403);
      await createProfile(jar);
    }
    const { alice, bob, carol, dave } = members;

    stage = 'the lessons and the picker, before any run';
    const initial = await get(alice);
    assert.equal(initial.status, 200); assert.equal(initial.body.state, null);
    assert.match(initial.headers.get('cache-control'), /no-store/);
    assert.equal(initial.body.catalog.lessonId, NEWEST);
    assert.equal(Object.hasOwn(initial.body.catalog, 'bars'), false);
    assert.deepEqual(initial.body.lessons.map(lesson => lesson.lessonId), [NEWEST, MIDDLE, OLDEST]);
    for (const lesson of initial.body.lessons) assert.deepEqual(Object.keys(lesson).sort(), ['date', 'lessonId', 'title']);
    assert.deepEqual(initial.body.records, []);
    const picker = initial.body.picker;
    assert.equal(picker.lessonId, NEWEST);
    assert.equal(picker.note.title, '預設：前一交易日熱門當沖股（10/22 盤後）');
    assert.equal(picker.note.detail, '名單 70 檔：上櫃 2 檔不在教材範圍，另 5 檔這天沒有可練習的資料');
    assert.equal(picker.defaults.length, 63);
    assert.equal(picker.booksAvailable, true); assert.equal(picker.taiexAvailable, true);
    for (const symbol of picker.symbols) assert.deepEqual(Object.keys(symbol).sort(), ['code', 'disposition', 'name', 'previousValue', 'referencePrice']);
    const offered = new Set(picker.symbols.map(symbol => symbol.code));
    for (const code of [...HOT, FIXTURE.thin, FIXTURE.disposition]) assert.ok(offered.has(code), code + ' is offered');
    for (const code of [FIXTURE.cold, FIXTURE.incomplete, FIXTURE.mismatch, FIXTURE.noTicks, FIXTURE.unknown, ...FIXTURE.otc]) assert.equal(offered.has(code), false, code + ' is not offered');
    assert.equal(/"(close|change|tradeValue|tradeVolume|rank|bars|tape|trades)"/.test(initial.text), false, 'nothing of the day before a run starts');
    const middle = await get(alice, '?lesson=' + MIDDLE);
    assert.equal(middle.body.catalog.lessonId, MIDDLE);
    assert.equal(middle.body.picker.note.title, '前一交易日沒有熱門當沖名單，改用成交值前 5 名');
    assert.equal(middle.body.picker.taiexAvailable, false); assert.equal(middle.body.picker.booksAvailable, false);
    assert.deepEqual([...middle.body.picker.defaults].sort(), [...HOT].sort());
    const oldest = await get(alice, '?lesson=' + OLDEST);
    assert.equal(oldest.body.picker.note.title, '預設：前一交易日熱門當沖股（10/20 盤後）');
    for (const query of ['lesson=', 'lesson=unknown', 'lesson=2026-10-07', 'lesson=fubon-20261028-am', 'lesson=fubon-20261023-am', 'lesson=fubon-20260230-am',
      'lesson=' + NEWEST + '&lesson=' + NEWEST, 'lesson=' + NEWEST + '&cursor=90', 'id=' + randomUUID()]) {
      assert.equal((await request('/api/morning?' + query, { jar: alice })).status, 400, query);
      assert.equal((await request('/api/morning?' + query, { method: 'POST', jar: alice, data: startOf(HOT) })).status, 400, query);
    }
    // A retired lesson with no run of the learner's (an old link) opens what a plain read opens: the newest day's picker.
    const oldLink = await get(alice, '?lesson=' + RETIRED);
    assert.equal(oldLink.status, 200, 'a retired lesson with no run of the learner\'s');
    assert.equal(oldLink.body.state, null); assert.equal(oldLink.body.retired, undefined);
    assert.equal(oldLink.body.picker.date, '2026-10-27'); assert.equal(oldLink.body.picker.lessonId, NEWEST);
    t.diagnostic('HTTP lessons: three days newest first, wording per day, nothing of the day before a run, only the exact lesson query');

    stage = 'starting a run';
    const start = startOf(HOT, '2330');
    for (const badOrigin of ['', 'https://attacker.invalid']) assert.equal((await post(alice, start, { origin: badOrigin })).status, 403);
    assert.equal((await post(alice, { ...start, plan: { ...start.plan, exerciseId: 'unapproved' } })).status, 400);
    assert.equal((await post(alice, startOf([FIXTURE.cold]))).status, 400, 'a stock with no trade before 10:30');
    assert.equal((await post(alice, startOf(['6488']))).status, 400, '上櫃');
    assert.equal((await post(alice, startOf(['9998']))).status, 400, 'an unknown code');
    assert.equal((await post(alice, startOf(['2330', '2330']))).status, 400, 'a repeated code');
    assert.equal((await post(alice, startOf(['2330', '2317'], '2454'))).status, 400, 'a 主角股 outside the run');
    assert.equal((await post(alice, startOf(Array.from({ length: 81 }, (_, index) => String(1000 + index))))).status, 400, 'more than 80 stocks');
    assert.equal((await post(alice, { ...start, guestTerms: true })).status, 400, 'a member does not accept the guest statement');
    const began = await post(alice, start);
    assert.equal(began.status, 200); assert.match(began.headers.get('cache-control'), /no-store/);
    let state = began.body.state;
    assert.equal(state.cursor, 0); assert.equal(state.revision, 0); assert.equal(state.cash, 10000000);
    assert.deepEqual(state.codes, HOT); assert.deepEqual(began.body.catalog.symbols.map(symbol => symbol.code), HOT);
    assert.ok(Object.values(state.bars).every(bars => bars.length === 0));
    assert.deepEqual(Object.keys(began.body.tape).sort(), [...HOT].sort()); assert.ok(Object.values(began.body.tape).every(rows => rows.length === 0));
    assert.equal(began.body.catalog.date, '2026-10-27'); assert.equal(began.body.catalog.maxCursor, 90);
    assertNoFuture(began.body, 'start');
    assert.equal((await post(alice, start)).body.state.id, state.id);
    assert.deepEqual((await post(alice, { ...startOf(['2330', '2317']), requestId: randomUUID() })).body.state.codes, HOT, 'one unfinished run per lesson: a second start gives it back');
    assert.equal((await get(bob)).body.state, null);
    assert.equal((await post(bob, nextAction(state, 'advance'))).status, 404);
    t.diagnostic('HTTP start: stocks checked against the picker, the plan kept, one unfinished run per lesson, nothing of the run is another learner\'s');

    stage = 'one minute at a time';
    assert.equal((await post(alice, { ...nextAction(state, 'advance'), cursor: 90 })).status, 400);
    assert.equal((await post(alice, { ...nextAction(state, 'advance'), view: '2603' })).status, 400, 'books only of the run\'s stocks');
    assert.equal((await post(alice, nextAction(state, 'order', { code: '2330', side: 'buy', lots: 1 }))).status, 409, 'no order before the first minute is seen');
    await ready(state);
    const advance = nextAction(state, 'advance', { view: '2330' });
    const duplicate = await Promise.all([post(alice, advance), post(alice, advance)]);
    assert.ok(duplicate.every(value => value.status === 200 && value.body.state.cursor === 1 && value.body.state.revision === 1));
    state = duplicate[0].body.state;
    assert.deepEqual(state.bars, {}, 'a step does not repeat the bars the desk already has');
    for (const reply of duplicate) {
      assertNoFuture(reply.body, 'advance 1');
      for (const code of HOT) assert.deepEqual(reply.body.delta.trades[code], cellRows(tradesOf('2026-10-27', code), 0));
      assert.equal(reply.body.delta.book.code, '2330'); assert.equal(reply.body.delta.book.sizes, true);
    }
    assert.equal(duplicate[0].body.delta.index.t, 0); assert.equal(duplicate[0].body.delta.index.p.length, 12);
    assert.equal((await post(alice, nextAction(state, 'advance'))).status, 429, 'one minute a second');
    assert.equal((await post(alice, { ...advance, expectedRevision: 1 })).status, 409);
    const snapshot = await get(alice);
    assert.equal(snapshot.body.state.cursor, 1);
    assertNoFuture(snapshot.body, 'snapshot at 1');
    for (const code of HOT) {
      const firstCell = cellRows(tradesOf('2026-10-27', code), 0);
      assert.deepEqual(snapshot.body.state.bars[code].map(bar => [bar.o, bar.c, bar.v]), [[firstCell[0][1], firstCell.at(-1)[1], firstCell.reduce((sum, row) => sum + row[2], 0)]]);
      assert.deepEqual(snapshot.body.tape[code], firstCell.slice(-40));
    }
    t.diagnostic('HTTP advance: the cell\'s own trades, bars and TAIEX minute only, one concurrent advance, server pace enforced');

    stage = 'paper orders matched against the real trades';
    const rows = tradesOf('2026-10-27', '2330');
    const previousClose = began.body.catalog.symbols[0].previousClose;
    assert.equal((await post(alice, nextAction(state, 'order', { code: '2330', side: 'sell', lots: 1 }))).status, 400, 'no short selling');
    const tooMany = await post(alice, nextAction(state, 'order', { code: '2330', side: 'buy', lots: 401 }));
    assert.equal(tooMany.status, 400, 'an order is at most 400 lots');
    assert.equal(tooMany.body.message, '請確認練習資料、操作編號與目前進度');
    const most = await post(alice, nextAction(state, 'order', { code: '2330', side: 'buy', lots: 400 }));
    assert.equal(most.status, 400, '400 lots of 2330 is more than the cash');
    assert.equal(most.body.message, '目前模擬資金不足，無法委託', '400 lots is a size the server takes; the cash refuses it');
    assert.equal((await post(alice, nextAction(state, 'order', { code: '2603', side: 'buy', lots: 1 }))).status, 400, 'only the run\'s stocks');
    assert.equal((await post(alice, nextAction(state, 'order', { code: '2330', side: 'buy', lots: 1, limitPrice: previousClose + 0.003 }))).status, 400, 'a limit on the tick grid');
    assert.equal((await post(alice, nextAction(state, 'order', { code: '2330', side: 'buy', lots: 1, limitPrice: previousClose * 1.2 }))).status, 400, 'a limit within 10% of the reference');
    assert.equal((await post(alice, nextAction(state, 'order', { code: '2330', side: 'buy', lots: 1, entryMode: 'lightning' }))).status, 400, 'lightning needs a limit');
    const marketBuy = nextAction(state, 'order', { code: '2330', side: 'buy', lots: 1 });
    const queued = await post(alice, marketBuy);
    assert.equal(queued.status, 200); state = queued.body.state;
    assert.equal(state.orders[0].status, 'pending'); assert.equal(state.orders[0].price, undefined); assert.equal(state.fills.length, 0);
    assert.equal((await post(alice, marketBuy)).body.state.orders.length, 1, 'a retried order is one order');
    assert.equal((await post(alice, nextAction(state, 'order', { code: '2330', side: 'buy', lots: 1 }))).status, 409, 'one waiting order at a time');
    await ready(state);
    const filled = await post(alice, nextAction(state, 'advance'));
    assert.equal(filled.status, 200); state = filled.body.state;
    const firstTrade = fillAfter(rows, 1, 'buy');
    assert.equal(state.cursor, 2); assert.equal(state.fills.length, 1);
    assert.equal(state.fills[0].price, firstTrade.price, 'a market order fills at the first trade after it');
    assert.equal(state.fills[0].ms, firstTrade.ms); assert.equal(state.fills[0].t, Math.floor(firstTrade.ms / 1000));
    assert.equal(state.orders[0].status, 'filled'); assert.equal(state.orders[0].price, firstTrade.price);
    assert.equal(state.positions[0].shares, 1000);
    const notional = money(firstTrade.price * 1000);
    assert.equal(state.cash, money(10000000 - notional - commission(notional)));
    assert.equal(state.equity, money(state.cash + lastBefore(rows, 2, previousClose) * 1000));
    assertNoFuture(filled.body, 'advance 2');
    // A limit sell at the last price waits for a trade that touches it; the fill is the rules' own.
    const limit = lastBefore(rows, 2, previousClose);
    const sellLimit = nextAction(state, 'order', { code: '2330', side: 'sell', lots: 1, limitPrice: limit });
    state = (await post(alice, sellLimit)).body.state;
    assert.equal(state.orders[1].status, 'pending'); assert.equal(state.orders[1].limitPrice, limit);
    const expectedSell = fillAfter(rows, 2, 'sell', limit);
    for (let step = 0; step < 6 && state.orders[1].status === 'pending'; step += 1) {
      await ready(state);
      const reply = await post(alice, nextAction(state, 'advance'));
      assert.equal(reply.status, 200); state = reply.body.state;
      const shouldBeFilled = expectedSell !== null && Math.floor(expectedSell.ms / CELL) < state.cursor;
      assert.equal(state.orders[1].status, shouldBeFilled ? 'filled' : 'pending', 'cursor ' + state.cursor);
    }
    t.diagnostic(`limit sell at ${limit}: ${state.orders[1].status}, independent fill ${JSON.stringify(expectedSell)}, market buy filled ${JSON.stringify(firstTrade)}`);
    if (state.orders[1].status === 'filled') {
      assert.equal(state.orders[1].price, expectedSell.price); assert.equal(state.fills[1].ms, expectedSell.ms);
      assert.equal(state.positions.length, 0);
      const sold = money(expectedSell.price * 1000);
      assert.equal(state.cash, money(10000000 - notional - commission(notional) + sold - commission(sold) - Math.round(sold * DAYTRADE_TAX)));
    } else {
      state = (await post(alice, nextAction(state, 'cancel', { orderId: state.orders[1].id }))).body.state;
      assert.equal(state.orders[1].reason, '由學員取消');
    }
    // A buy limit no trade can touch keeps waiting, costs nothing and can be withdrawn.
    const low = limitDown(previousClose);
    const cashBefore = state.cash;
    state = (await post(alice, nextAction(state, 'order', { code: '2330', side: 'buy', lots: 1, limitPrice: low }))).body.state;
    await ready(state);
    state = (await post(alice, nextAction(state, 'advance'))).body.state;
    assert.equal(state.orders.at(-1).status, 'pending'); assert.equal(state.cash, cashBefore);
    const waiting = state.orders.at(-1).id;
    state = (await post(alice, nextAction(state, 'cancel', { orderId: waiting }))).body.state;
    assert.equal(state.orders.at(-1).status, 'cancelled'); assert.equal(state.orders.at(-1).reason, '由學員取消'); assert.equal(state.cash, cashBefore);
    assert.equal((await post(alice, nextAction(state, 'cancel', { orderId: waiting }))).status, 409, 'nothing waiting to cancel');
    t.diagnostic('HTTP orders: market fills at the first trade after it, a limit at the first trade or at its own price, costs as the rules say, cancel returns the cash');

    stage = 'finish, records and the next run';
    const finish = nextAction(state, 'finish', { reflection: REVIEW });
    assert.equal((await post(alice, { ...finish, reflection: ' ' })).status, 400);
    const final = await post(alice, finish);
    assert.equal(final.status, 200); state = final.body.state;
    assert.equal(state.completed, true); assert.equal(state.reflection, REVIEW);
    assert.deepEqual((await post(alice, finish)).body.state, state);
    assert.equal((await post(alice, nextAction(state, 'advance'))).status, 409);
    assert.equal((await post(alice, nextAction(state, 'abandon'))).status, 409);
    const noRun = await get(alice);
    assert.equal(noRun.body.state, null, 'with no unfinished run, a plain read opens the newest day\'s picker'); assert.ok(noRun.body.picker);
    const finishedRead = await get(alice, '?lesson=' + NEWEST);
    assert.equal(finishedRead.body.state.completed, true); assert.ok(finishedRead.body.picker, 'a finished run read by its lesson comes with the day\'s picker');
    assertNoFuture(finishedRead.body, 'a finished run');
    const [record] = finishedRead.body.records;
    assert.deepEqual({ ...record, id: undefined, pnl: undefined }, { id: undefined, lessonId: NEWEST, date: '2026-10-27', codes: 5, pnl: undefined, reflected: true, abandoned: false, retired: false, completed: true });
    assert.equal(record.id, state.id); assert.equal(record.pnl, money(state.equity - 10000000));
    const finished = state;

    stage = 'the default list, a quiet stock, no TAIEX, abandon';
    const bobStart = { ...startOf(picker.defaults), plan: plan(picker.defaults[0]) };
    const bobBegan = await post(bob, bobStart);
    assert.equal(bobBegan.status, 200);
    assert.equal(bobBegan.body.catalog.note.title, picker.note.title, 'a run of the default list carries the default\'s wording');
    assert.equal(bobBegan.body.catalog.symbols.length, 63);
    let bobState = bobBegan.body.state;
    await ready(bobState);
    const bobAdvanced = await post(bob, nextAction(bobState, 'advance', { view: picker.defaults[0] }));
    assert.equal(bobAdvanced.status, 200);
    assert.equal(Object.keys(bobAdvanced.body.delta.trades).length, 63);
    assertNoFuture(bobAdvanced.body, 'a run of the default list');
    bobState = bobAdvanced.body.state;
    const quiet = FIXTURE.thin;
    const quietRows = tradesOf('2026-10-22', quiet);
    const quietStart = await post(bob, { ...startOf([quiet, '2330']), plan: plan(quiet) }, undefined, '?lesson=' + MIDDLE);
    assert.equal(quietStart.status, 200);
    assert.equal(quietStart.body.catalog.lessonId, MIDDLE); assert.equal(quietStart.body.state.lessonId, MIDDLE);
    assert.equal((await get(bob, '?lesson=' + NEWEST)).body.state.cursor, 1, 'each lesson keeps its own run');
    let quietState = quietStart.body.state;
    assert.equal((await post(bob, nextAction(quietState, 'advance'), undefined, '?lesson=' + NEWEST)).status, 404, 'a run is only found under its own lesson');
    const advanceQuiet = async () => {
      await ready(quietState);
      const reply = await post(bob, nextAction(quietState, 'advance'), undefined, '?lesson=' + MIDDLE);
      assert.equal(reply.status, 200); quietState = reply.body.state;
      assertNoFuture(reply.body, 'quiet run');
      assert.equal(reply.body.delta.index, null, 'no TAIEX file, no TAIEX minute');
      return reply.body.delta;
    };
    assert.equal((await post(bob, nextAction(quietState, 'order', { code: quiet, side: 'buy', lots: 1 }), undefined, '?lesson=' + MIDDLE)).status, 409, 'no order before the first minute is seen');
    for (let cell = 0; cell < FIXTURE.thinFirstCell; cell += 1) {
      const delta = await advanceQuiet();
      assert.equal(delta.bars[quiet], null, 'no bar before the first trade'); assert.deepEqual(delta.trades[quiet], []);
      assert.ok(delta.bars['2330'], 'the busy stock has its bar');
      if (cell === 0) {
        const sent = await post(bob, nextAction(quietState, 'order', { code: quiet, side: 'buy', lots: 1 }), undefined, '?lesson=' + MIDDLE);
        assert.equal(sent.status, 200); quietState = sent.body.state;
      }
    }
    const midRead = await get(bob, '?lesson=' + MIDDLE);
    assert.deepEqual(midRead.body.state.bars[quiet], [], 'no bars yet'); assert.deepEqual(midRead.body.tape[quiet], []);
    assert.equal(midRead.body.state.orders[0].status, 'pending', 'a market order waits for the first trade');
    const open = await advanceQuiet();
    const firstOfQuiet = quietRows[0];
    assert.equal(open.cell, FIXTURE.thinFirstCell);
    assert.equal(open.bars[quiet].o, firstOfQuiet[1]); assert.deepEqual(open.trades[quiet], cellRows(quietRows, FIXTURE.thinFirstCell));
    assert.equal(quietState.orders[0].status, 'filled');
    assert.equal(quietState.fills[0].ms, firstOfQuiet[0]); assert.equal(quietState.fills[0].price, firstOfQuiet[1]);
    const gaveUp = await post(bob, nextAction(quietState, 'abandon'), undefined, '?lesson=' + MIDDLE);
    assert.equal(gaveUp.status, 200); assert.equal(gaveUp.body.state.completed, true); assert.equal(gaveUp.body.state.abandoned, true);
    assert.equal((await post(bob, nextAction(gaveUp.body.state, 'abandon'), undefined, '?lesson=' + MIDDLE)).status, 409);
    const bobRecords = (await get(bob)).body.records;
    assert.equal(bobRecords.length, 2); assert.equal(bobRecords.find(record => record.lessonId === MIDDLE).abandoned, true);
    t.diagnostic('HTTP real-trade edges: a stock with no trade yet has no bar, a market order waits for its first trade and fills at it, no TAIEX on a day without one, abandon ends a run');

    stage = 'traffic limits per practiser';
    const burst = await Promise.all(Array.from({ length: 36 }, () => Promise.all(Array.from({ length: 10 }, () => get(dave)))));
    const answers = burst.flat();
    const limited = answers.filter(answer => answer.status === 429);
    assert.ok(limited.length >= 150, 'a practiser has 180 requests a minute: ' + limited.length + ' refused of 360');
    assert.ok(answers.filter(answer => answer.status === 200).length <= 180);
    assert.equal(limited[0].headers.get('retry-after'), '1');
    assert.equal(limited[0].body.message, '操作較頻繁，請稍候再試');
    assert.equal((await get(carol)).status, 200, 'another practiser behind the same address is not affected');

    stage = 'graceful restart and durable runs';
    await close(); await launch();
    const reread = await get(alice, '?lesson=' + NEWEST);
    assert.deepEqual(bare(reread.body.state), bare(finished));
    assert.deepEqual((await post(alice, finish)).body.state, finished);
    assert.equal((await get(bob, '?lesson=' + NEWEST)).body.state.cursor, 1);
    assert.deepEqual((await get(bob)).body.records, bobRecords);
    assert.deepEqual((await get(carol)).body.state, null);
    const restarted = await post(alice, { ...start, requestId: randomUUID() });
    assert.equal(restarted.status, 200); assert.notEqual(restarted.body.state.id, finished.id); assert.equal(restarted.body.state.cursor, 0);
    assert.equal((await post(alice, start)).body.state.id, finished.id, 'an old request id keeps answering with its own run');
    assert.equal((await get(alice)).body.state.id, restarted.body.state.id);

    stage = 'durable lightning limits and exact-price retries';
    state = restarted.body.state;
    await ready(state);
    state = (await post(alice, nextAction(state, 'advance'))).body.state;
    const lowLimit = limitDown(previousClose);
    assert.ok(lowLimit < rows.find(row => row[0] >= CELL)[1], 'the fixture has an unmarketable buy limit');
    const lightning = nextAction(state, 'order', { code: '2330', side: 'buy', lots: 1, limitPrice: lowLimit, entryMode: 'lightning' });
    assert.equal((await post(alice, { ...lightning, limitPrice: lowLimit + .001 })).status, 400);
    const queuedLimits = await Promise.all([post(alice, lightning), post(alice, lightning)]);
    assert.ok(queuedLimits.every(result => result.status === 200));
    state = queuedLimits[0].body.state;
    assert.equal(state.orders.length, 1); assert.equal(state.fills.length, 0);
    assert.equal(state.orders[0].limitPrice, lowLimit); assert.equal(state.orders[0].entryMode, 'lightning');
    assert.equal((await post(alice, { ...lightning, limitPrice: stepTick(lowLimit, 1) })).status, 409);
    await close(); await launch();
    assert.deepEqual(bare((await get(alice)).body.state), bare(state));
    assert.deepEqual((await post(alice, lightning)).body.state, state);
    await ready(state);
    state = (await post(alice, nextAction(state, 'advance'))).body.state;
    assert.equal(state.orders[0].status, 'pending'); assert.equal(state.cash, 10000000); assert.equal(state.fills.length, 0);
    state = (await post(alice, nextAction(state, 'cancel', { orderId: state.orders[0].id }))).body.state;
    assert.equal(state.orders[0].status, 'cancelled'); assert.equal(state.cash, 10000000);
    const marketable = stepTick(lastBefore(rows, state.cursor, previousClose), 1);
    const fillable = nextAction(state, 'order', { code: '2330', side: 'buy', lots: 1, limitPrice: marketable, entryMode: 'lightning' });
    const submittedAt = state.cursor;
    state = (await post(alice, fillable)).body.state;
    assert.equal(state.orders.at(-1).status, 'pending');
    await ready(state);
    state = (await post(alice, nextAction(state, 'advance'))).body.state;
    const expectedLimitFill = fillAfter(rows, submittedAt, 'buy', marketable);
    t.diagnostic(`marketable limit ${marketable} sent at ${submittedAt}: independent fill ${JSON.stringify(expectedLimitFill)}, order ${state.orders.at(-1).status}`);
    if (Math.floor(expectedLimitFill.ms / CELL) === submittedAt) {
      assert.equal(state.orders.at(-1).status, 'filled'); assert.equal(state.fills[0].price, expectedLimitFill.price);
      assert.equal(state.fills.length, 1);
      assert.ok(state.fills[0].price <= marketable, 'a marketable limit never pays more than its limit');
    } else assert.equal(state.orders.at(-1).status, 'pending');
    assert.deepEqual((await post(alice, fillable)).body.state, state);
    t.diagnostic('HTTP lightning limits: legal price required, concurrent duplicate sends create one order, changed-price retries rejected, pending limit survives restart, cancel returns the cash, a marketable limit fills as the rules say');

    stage = 'an old lesson\'s unfinished run after the retirement';
    await close();
    const { PGlite } = await import('@electric-sql/pglite');
    const database = new PGlite({ dataDir: env.PGLITE_DATA_DIR });
    let retiredRunId;
    try {
      const owner = (await database.query('SELECT id FROM "user" WHERE email = $1', ['alice@example.invalid'])).rows[0];
      assert.ok(owner, 'alice exists');
      retiredRunId = randomUUID();
      const order = randomUUID();
      const old = {
        id: retiredRunId, lessonId: RETIRED, cursor: 30, revision: 12, plan: plan('2330', { bias: 'bullish' }), startingCash: 10000000, cash: 7065825, equity: 9995825,
        positions: [{ code: '2330', shares: 2000, averageCost: 1465 }],
        orders: [{ id: order, code: '2330', side: 'buy', shares: 2000, status: 'filled', submittedCursor: 5, price: 1465 }],
        fills: [{ id: order, code: '2330', side: 'buy', shares: 2000, price: 1465, fee: 4175, tax: 0, t: 360 }],
        completed: false, reflection: '', nextAdvanceAt: 0, startedAt: Date.parse('2026-10-06T09:05:00+08:00'),
      };
      await database.query(`INSERT INTO morning_sessions (id, user_id, lesson_id, state_json, completed, created_at, updated_at)
        VALUES ($1, $2, $3, $4::jsonb, FALSE, NOW() - INTERVAL '22 days', NOW() - INTERVAL '22 days')`, [retiredRunId, owner.id, RETIRED, JSON.stringify(old)]);
    } finally { await database.close(); }
    await launch();
    const oldRead = await get(alice, '?lesson=' + RETIRED);
    assert.equal(oldRead.status, 200); assert.equal(oldRead.body.retired, true);
    assert.deepEqual(oldRead.body.state.bars, {}); assert.equal(oldRead.body.state.id, retiredRunId); assert.equal(oldRead.body.state.completed, false);
    assert.equal(Object.hasOwn(oldRead.body, 'tape'), false); assert.equal(Object.hasOwn(oldRead.body, 'picker'), false);
    assert.equal(oldRead.body.records.find(record => record.id === retiredRunId).retired, true);
    const plain = await get(alice);
    assert.equal(plain.body.state.lessonId, NEWEST, 'the open run of a daily lesson is what opens by default');
    const oldState = oldRead.body.state;
    for (const action of [nextAction(oldState, 'advance'), nextAction(oldState, 'order', { code: '2330', side: 'sell', lots: 1 }), nextAction(oldState, 'cancel', { orderId: randomUUID() })])
      assert.equal((await post(alice, action, undefined, '?lesson=' + RETIRED)).status, 409, 'a retired run can only be finished or abandoned');
    assert.equal((await post(alice, startOf(HOT), undefined, '?lesson=' + RETIRED)).status, 404, 'no run starts on a retired lesson');
    const oldFinished = await post(alice, nextAction(oldState, 'finish', { reflection: REVIEW }), undefined, '?lesson=' + RETIRED);
    assert.equal(oldFinished.status, 200); assert.equal(oldFinished.body.state.completed, true); assert.equal(oldFinished.body.retired, true);
    t.diagnostic('HTTP retired lesson: opens as text, cannot advance, order or start, can be finished');

    for (const value of [password, gateCode, secret, ...jars.flatMap(jar => [...jar.values()])])
      assert.equal(logs.includes(value), false, 'Generated credentials must not appear in app logs');
    t.diagnostic('HTTP morning restart: identity, completed cursor, positions, plan/reflection and request ledger survive; new run starts separately');
  } catch (error) { t.diagnostic('Failure stage: ' + stage); throw error; }
  finally {
    await close();
    if (resolve(runtime).startsWith(resolve(tmpdir()) + sep) && basename(runtime).startsWith('morning-http-test-') && dirname(env.PGLITE_DATA_DIR) === runtime)
      await rm(runtime, { recursive: true, force: true });
  }
});
