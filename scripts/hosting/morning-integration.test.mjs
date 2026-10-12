import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromCrossJSON, toJSONAsync } from 'seroval';
import { defaultSerovalPlugins } from '@tanstack/router-core';
import { limitDown, limitUp, stepTick } from '../../src/lib/market/ticks.ts';

const entrySetting = process.env.CLASSROOM_TEST_RELEASE;
const here = dirname(fileURLToPath(import.meta.url));
const origin = 'https://morning-test.invalid';
const wait = ms => new Promise(done => setTimeout(done, ms));

test('real HTTP morning replay: private completed bars, durable cursor and exactly-once paper orders', {
  skip: !entrySetting ? 'Set CLASSROOM_TEST_RELEASE to an immutable built server/index.mjs' : false,
  timeout: 120000,
}, async t => {
  const entry = resolve(entrySetting);
  await access(entry);
  const port = 18796;
  const vacant = createServer();
  await new Promise((done, fail) => { vacant.once('error', fail); vacant.listen(port, '127.0.0.1', done); });
  await new Promise(done => vacant.close(done));
  const runtime = await mkdtemp(join(tmpdir(), 'morning-http-test-'));
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
    CLASSROOM_CODE: 'MORNINGTEST', CLASSROOM_TEACHER_IDS: '', TEACHER_EMAILS: '', ADMIN_SETUP_EMAIL: '', ADMIN_SETUP_TOKEN: '',
    GROK_PROJECT_ID: '', GROK_AUTH_CLIENT_ID: '', GROK_AUTH_CLIENT_SECRET: '',
  };
  const source = JSON.parse(await readFile(join(here, '../../server/data/morning-2026-10-06.json'), 'utf8'));
  const additionalSource = JSON.parse(await readFile(join(here, '../../server/data/morning-2026-10-05.json'), 'utf8'));
  const approvedSources = [additionalSource, source];
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
    return { status: result.status, body, headers: result.headers };
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
  const post = (jar, data, headers) => request('/api/morning', { method: 'POST', jar, data, headers });
  const additionalPath = '/api/morning?lesson=' + encodeURIComponent(additionalSource.catalog.lessonId);
  const additionalPost = (jar, data) => request(additionalPath, { method: 'POST', jar, data });
  const nextAction = (state, action, extra = {}) => ({ action, id: state.id, expectedRevision: state.revision, requestId: randomUUID(), ...extra });
  const ready = state => wait(Math.max(0, state.nextAdvanceAt - Date.now()) + 30);
  try {
    await launch();
    stage = 'authentication and explicit consent';
    assert.equal((await request('/api/morning')).status, 403);
    assert.equal((await post(new Map(), { action: 'start' })).status, 403);
    const admitted = newJar();
    assert.equal((await request('/api/gate', { method: 'POST', data: { password: gateCode }, jar: admitted })).status, 200);
    assert.equal((await request('/api/morning', { jar: admitted })).status, 401);
    const alice = newJar(admitted); const bob = newJar(admitted);
    for (const [index, jar] of [alice, bob].entries()) {
      assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', jar, data: { name: 'Morning fixture', email: 'morning' + index + '@example.invalid', password } })).status, 200);
      assert.equal((await request('/api/morning', { jar })).status, 403);
      await createProfile(jar);
      const initial = await request('/api/morning', { jar });
      assert.equal(initial.status, 200); assert.equal(initial.body.state, null);
      assert.equal(initial.body.catalog.lessonId, source.catalog.lessonId);
      assert.equal(Object.hasOwn(initial.body.catalog, 'bars'), false);
      assert.deepEqual(initial.body.lessons.map(lesson => lesson.lessonId).sort(), approvedSources.map(value => value.catalog.lessonId).sort());
      for (const lesson of initial.body.lessons) {
        assert.deepEqual(Object.keys(lesson).sort(), ['date', 'end', 'lessonId', 'maxCursor', 'start', 'symbols', 'title']);
        for (const symbol of lesson.symbols) assert.deepEqual(Object.keys(symbol).sort(), ['code', 'name']);
      }
    }
    const code = source.catalog.symbols[0].code;
    const start = { action: 'start', requestId: randomUUID(), plan: { exerciseId: 'first-order', bias: 'observe', focusCode: code,
      reason: '先觀察背景與價格', entry: '確認自己的條件後再進場', stop: '理由不成立時離場' } };
    for (const badOrigin of ['', 'https://attacker.invalid']) assert.equal((await post(alice, start, { origin: badOrigin })).status, 403);
    assert.equal((await post(alice, { ...start, plan: { ...start.plan, exerciseId: 'unapproved' } })).status, 400);
    const began = await post(alice, start);
    assert.equal(began.status, 200); assert.match(began.headers.get('cache-control'), /no-store/);
    let state = began.body.state;
    assert.equal(state.cursor, 0); assert.equal(state.revision, 0); assert.equal(state.cash, 10000000);
    assert.ok(Object.values(state.bars).every(bars => bars.length === 0));
    assert.equal((await post(alice, start)).body.state.id, state.id);
    assert.deepEqual((await post(alice, { ...start, requestId: randomUUID(), plan: { ...start.plan, exerciseId: 'review', reason: 'Do not overwrite' } })).body.state.plan, start.plan);
    assert.equal((await request('/api/morning', { jar: bob })).body.state, null);
    assert.equal((await post(bob, nextAction(state, 'advance'))).status, 404);
    assert.equal((await request('/api/morning?id=' + state.id, { jar: bob })).status, 400);
    assert.equal((await post(alice, { ...nextAction(state, 'advance'), cursor: 90 })).status, 400);
    assert.equal((await post(alice, nextAction(state, 'order', { code, side: 'buy', lots: 1 }))).status, 409);
    await ready(state);
    const advance = nextAction(state, 'advance');
    const duplicate = await Promise.all([post(alice, advance), post(alice, advance)]);
    assert.ok(duplicate.every(value => value.status === 200 && value.body.state.cursor === 1 && value.body.state.revision === 1));
    state = duplicate[0].body.state;
    for (const symbol of source.catalog.symbols) assert.deepEqual(state.bars[symbol.code], source.bars[symbol.code].slice(0, 1));
    assert.equal((await post(alice, nextAction(state, 'advance'))).status, 429);
    assert.equal((await post(alice, { ...advance, expectedRevision: 1 })).status, 409);
    t.diagnostic('HTTP morning: gate/session/consent and exact origin required; no future bars or foreign state; start plan immutable, one concurrent advance, server pace enforced');

    stage = 'approved lessons and independently owned progress';
    for (const query of ['lesson=', 'lesson=unknown', 'lesson=2026-10-07', 'lesson=2026-10-02',
      'lesson=' + source.catalog.lessonId + '&lesson=' + source.catalog.lessonId,
      'lesson=' + source.catalog.lessonId + '&cursor=90']) {
      assert.equal((await request('/api/morning?' + query, { jar: alice })).status, 400);
      assert.equal((await request('/api/morning?' + query, { method: 'POST', jar: alice, data: start })).status, 400);
    }
    assert.deepEqual((await request('/api/morning?lesson=' + source.catalog.lessonId, { jar: alice })).body.state, state);
    assert.equal((await request(additionalPath, { jar: alice })).body.state, null);
    assert.equal((await additionalPost(alice, start)).status, 409, 'An existing request ID cannot be replayed under a different source hash');
    assert.equal((await additionalPost(alice, nextAction(state, 'advance'))).status, 404);
    assert.equal((await post(alice, { ...nextAction(state, 'advance'), lessonId: additionalSource.catalog.lessonId })).status, 400);
    const additionalStart = { ...start, requestId: randomUUID(), plan: { ...start.plan, exerciseId: 'patience' } };
    const additionalBegan = await additionalPost(alice, additionalStart);
    assert.equal(additionalBegan.status, 200);
    assert.equal(additionalBegan.body.catalog.lessonId, additionalSource.catalog.lessonId);
    let additionalState = additionalBegan.body.state;
    assert.notEqual(additionalState.id, state.id); assert.equal(additionalState.cursor, 0);
    assert.equal(additionalState.plan.exerciseId, 'patience');
    assert.ok(Object.values(additionalState.bars).every(bars => bars.length === 0));
    assert.equal((await post(alice, nextAction(additionalState, 'advance'))).status, 404);
    assert.equal((await additionalPost(bob, nextAction(additionalState, 'advance'))).status, 404);
    assert.equal((await request(additionalPath, { jar: bob })).body.state, null);
    await ready(additionalState);
    const additionalAdvance = nextAction(additionalState, 'advance');
    const additionalAdvanced = await additionalPost(alice, additionalAdvance);
    assert.equal(additionalAdvanced.status, 200); additionalState = additionalAdvanced.body.state;
    assert.equal(additionalState.cursor, 1);
    for (const symbol of additionalSource.catalog.symbols)
      assert.deepEqual(additionalState.bars[symbol.code], additionalSource.bars[symbol.code].slice(0, 1));
    assert.equal((await post(alice, additionalAdvance)).status, 409);
    assert.deepEqual((await request('/api/morning', { jar: alice })).body.state, state);
    t.diagnostic('HTTP morning lessons: exact approved query only, safe metadata, original default unchanged, source-bound retries and independently owned progress; exercise immutable');

    stage = 'paper orders and known-minute valuation';
    assert.equal((await post(alice, nextAction(state, 'order', { code, side: 'sell', lots: 1 }))).status, 400);
    assert.equal((await post(alice, nextAction(state, 'order', { code, side: 'buy', lots: 4 }))).status, 400);
    const order = nextAction(state, 'order', { code, side: 'buy', lots: 1 });
    const queued = await post(alice, order);
    assert.equal(queued.status, 200); state = queued.body.state;
    assert.equal(state.orders[0].status, 'pending'); assert.equal(state.orders[0].price, undefined); assert.equal(state.fills.length, 0);
    assert.equal((await post(alice, order)).body.state.orders.length, 1);
    assert.equal((await post(alice, nextAction(state, 'order', { code, side: 'buy', lots: 1 }))).status, 409);
    await ready(state);
    const filled = await post(alice, nextAction(state, 'advance'));
    assert.equal(filled.status, 200); state = filled.body.state;
    assert.equal(state.cursor, 2); assert.equal(state.fills.length, 1);
    assert.equal(state.fills[0].price, source.bars[code][1].o);
    assert.equal(state.fills[0].t, 60); assert.equal(state.positions[0].shares, 1000);
    for (const symbol of source.catalog.symbols) assert.deepEqual(state.bars[symbol.code], source.bars[symbol.code].slice(0, 2));
    const notional = source.bars[code][1].o * 1000;
    assert.equal(state.cash, 10000000 - notional - Math.max(20, Math.round(notional * .001425 * .6)));
    assert.equal(state.equity, Math.round((state.cash + source.bars[code][1].c * 1000) * 100) / 100);
    state = (await post(alice, nextAction(state, 'order', { code, side: 'sell', lots: 1 }))).body.state;
    const pendingId = state.orders.at(-1).id;
    state = (await post(alice, nextAction(state, 'cancel', { orderId: pendingId }))).body.state;
    assert.equal(state.orders.at(-1).status, 'cancelled'); assert.equal(state.positions[0].shares, 1000);
    state = (await post(alice, nextAction(state, 'order', { code, side: 'sell', lots: 1 }))).body.state;
    const finish = nextAction(state, 'finish', { reflection: '我先保留持倉，說明觀察與原先判斷的差異。' });
    assert.equal((await post(alice, { ...finish, reflection: ' ' })).status, 400);
    const final = await post(alice, finish);
    assert.equal(final.status, 200); state = final.body.state;
    assert.equal(state.completed, true); assert.equal(state.cursor, 2);
    assert.equal(state.orders.at(-1).status, 'cancelled'); assert.equal(state.positions[0].shares, 1000); assert.equal(state.fills.length, 1);
    assert.deepEqual((await post(alice, finish)).body.state, state);
    assert.deepEqual((await request(additionalPath, { jar: alice })).body.state, additionalState);
    assert.deepEqual((await additionalPost(alice, additionalAdvance)).body.state, additionalState);
    assert.equal((await request(additionalPath, { jar: bob })).body.state, null);
    assert.equal((await post(alice, nextAction(state, 'advance'))).status, 409);
    t.diagnostic('HTTP morning orders: pending until next minute OPEN, long-only lots enforced, exact paper costs, cancel and finish keep holdings without forced liquidation');

    stage = 'graceful restart and durable replay';
    await close(); await launch();
    assert.deepEqual((await request('/api/morning', { jar: alice })).body.state, state);
    assert.deepEqual((await post(alice, finish)).body.state, state);
    assert.deepEqual((await request(additionalPath, { jar: alice })).body.state, additionalState);
    assert.deepEqual((await additionalPost(alice, additionalAdvance)).body.state, additionalState);
    assert.equal((await request(additionalPath, { jar: bob })).body.state, null);
    assert.equal((await request('/api/morning', { jar: bob })).body.state, null);
    assert.equal((await post(bob, nextAction(state, 'advance'))).status, 404);
    const restarted = await post(alice, { ...start, requestId: randomUUID() });
    assert.equal(restarted.status, 200); assert.notEqual(restarted.body.state.id, state.id); assert.equal(restarted.body.state.cursor, 0);
    assert.equal((await post(alice, start)).body.state.id, state.id);
    assert.equal((await request('/api/morning', { jar: alice })).body.state.id, restarted.body.state.id);
    stage = 'durable lightning limits and exact-price retries';
    state = restarted.body.state;
    await ready(state);
    state = (await post(alice, nextAction(state, 'advance'))).body.state;
    const previousClose = source.catalog.symbols.find(symbol => symbol.code === code).previousClose;
    const lowLimit = limitDown(previousClose);
    assert.ok(lowLimit < source.bars[code][1].o, 'Fixture has an unmarketable buy limit');
    const lightning = nextAction(state, 'order', { code, side: 'buy', lots: 1, limitPrice: lowLimit, entryMode: 'lightning' });
    assert.equal((await post(alice, { ...lightning, limitPrice: lowLimit + .001 })).status, 400);
    const queuedLimits = await Promise.all([post(alice, lightning), post(alice, lightning)]);
    assert.ok(queuedLimits.every(result => result.status === 200));
    state = queuedLimits[0].body.state;
    assert.equal(state.orders.length, 1); assert.equal(state.fills.length, 0);
    assert.equal(state.orders[0].limitPrice, lowLimit); assert.equal(state.orders[0].entryMode, 'lightning');
    assert.equal((await post(alice, { ...lightning, limitPrice: stepTick(lowLimit, 1) })).status, 409);
    await close(); await launch();
    assert.deepEqual((await request('/api/morning', { jar: alice })).body.state, state);
    assert.deepEqual((await post(alice, lightning)).body.state, state);
    await ready(state);
    state = (await post(alice, nextAction(state, 'advance'))).body.state;
    assert.equal(state.orders[0].status, 'pending'); assert.equal(state.cash, 10000000); assert.equal(state.fills.length, 0);
    state = (await post(alice, nextAction(state, 'cancel', { orderId: state.orders[0].id }))).body.state;
    assert.equal(state.orders[0].status, 'cancelled'); assert.equal(state.cash, 10000000);
    const nextOpen = source.bars[code][state.cursor].o;
    const buyLimit = stepTick(nextOpen, 1);
    assert.ok(buyLimit <= limitUp(previousClose));
    const fillable = nextAction(state, 'order', { code, side: 'buy', lots: 1, limitPrice: buyLimit, entryMode: 'lightning' });
    state = (await post(alice, fillable)).body.state;
    assert.equal(state.orders.at(-1).status, 'pending');
    await ready(state);
    state = (await post(alice, nextAction(state, 'advance'))).body.state;
    assert.equal(state.orders.at(-1).status, 'filled'); assert.equal(state.orders.at(-1).limitPrice, buyLimit);
    assert.equal(state.fills.length, 1); assert.equal(state.fills[0].price, nextOpen);
    assert.equal(state.positions[0].shares, 1000);
    assert.equal(state.cash, 10000000 - nextOpen * 1000 - Math.max(20, Math.round(nextOpen * 1000 * .001425 * .6)));
    assert.deepEqual((await post(alice, fillable)).body.state, state);
    assert.deepEqual((await request(additionalPath, { jar: alice })).body.state, additionalState);
    t.diagnostic('HTTP lightning limits: legal price required, concurrent duplicate sends create one order, changed-price retries rejected, pending limit survives restart, missed OPEN leaves order pending, cancel preserves cash, favorable OPEN fills once');
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
