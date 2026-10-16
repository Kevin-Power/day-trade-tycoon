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

const entrySetting = process.env.CLASSROOM_TEST_RELEASE;
const here = dirname(fileURLToPath(import.meta.url));
const origin = 'https://guest-test.invalid';
const wait = ms => new Promise(done => setTimeout(done, ms));

test('real HTTP guest flow: gate-only guest accounts, start-to-consent, practice moves into the new account', {
  skip: !entrySetting ? 'Set CLASSROOM_TEST_RELEASE to an immutable built server/index.mjs' : false,
  timeout: 150000,
}, async t => {
  const entry = resolve(entrySetting);
  await access(entry);
  const port = 18797;
  const vacant = createServer();
  await new Promise((done, fail) => { vacant.once('error', fail); vacant.listen(port, '127.0.0.1', done); });
  await new Promise(done => vacant.close(done));
  const runtime = await mkdtemp(join(tmpdir(), 'guest-http-test-'));
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
    CLASSROOM_CODE: 'GUESTTEST', CLASSROOM_TEACHER_IDS: '', TEACHER_EMAILS: '', ADMIN_SETUP_EMAIL: '', ADMIN_SETUP_TOKEN: '',
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
    const outgoing = new Headers({ origin, 'cf-connecting-ip': '192.0.2.71', ...headers });
    if (jar.size) outgoing.set('cookie', [...jar].map(([key, value]) => key + '=' + value).join('; '));
    if (data !== undefined) outgoing.set('content-type', 'application/json');
    const result = await fetch(base + path, { method, headers: outgoing, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(20000) });
    absorb(jar, result);
    const text = await result.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* assertions report status, never credentials */ }
    return { status: result.status, body, headers: result.headers };
  }
  async function profileRpc(jar) {
    const headers = { origin, 'sec-fetch-site': 'same-origin', 'x-tsr-serverFn': 'true', accept: 'application/json', 'content-type': 'application/json',
      cookie: [...jar].map(([key, value]) => key + '=' + value).join('; ') };
    const result = await fetch(base + '/_serverFn/' + profileId, { method: 'POST', headers,
      body: JSON.stringify(await toJSONAsync({ data: { displayName: 'Guest fixture student', classCode: 'GUESTTEST', acceptTos: true } }, { plugins: defaultSerovalPlugins })),
      signal: AbortSignal.timeout(20000) });
    let decoded = null;
    try {
      const payload = await result.json();
      decoded = result.headers.get('x-tss-serialized') ? fromCrossJSON(payload, { plugins: defaultSerovalPlugins }) : payload;
    } catch { /* a refused call may not carry JSON */ }
    return { status: result.status, ok: result.status === 200 && !decoded?.error && (decoded?.result?.ok ?? decoded?.ok) === true };
  }
  async function launch() {
    app = fork(join(here, 'app-runner.mjs'), [entry], { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const capture = chunk => { logs = (logs + chunk.toString()).slice(-1000000); };
    app.stdout.on('data', capture); app.stderr.on('data', capture);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (app.exitCode !== null || app.signalCode !== null) throw new Error('Isolated guest app exited during startup');
      try { const result = await fetch(base + '/api/health', { signal: AbortSignal.timeout(2500) }); if (result.ok && (await result.json()).ok) return; } catch { /* readiness */ }
      await wait(100);
    }
    throw new Error('Isolated guest app readiness timed out');
  }
  async function close() {
    if (!app || app.exitCode !== null || app.signalCode !== null) return;
    const owned = app;
    const exit = new Promise(done => owned.once('exit', done));
    const closed = new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Guest database shutdown not acknowledged')), 25000);
      owned.on('message', message => {
        if (message?.type === 'shutdown-complete') { clearTimeout(timer); done(); }
        if (message?.type === 'shutdown-error') { clearTimeout(timer); fail(new Error('Guest database shutdown failed')); }
      });
    });
    owned.send({ type: 'shutdown' });
    try { await closed; } finally { owned.kill(); await exit; app = undefined; }
  }
  const admitted = async () => {
    const jar = newJar();
    assert.equal((await request('/api/gate', { method: 'POST', data: { password: gateCode }, jar })).status, 200);
    return jar;
  };
  const post = (jar, data) => request('/api/morning', { method: 'POST', jar, data });
  const nextAction = (state, action, extra = {}) => ({ action, id: state.id, expectedRevision: state.revision, requestId: randomUUID(), ...extra });
  const ready = state => wait(Math.max(0, state.nextAdvanceAt - Date.now()) + 30);
  const session = async jar => (await request('/api/auth/get-session', { jar })).body;
  try {
    await launch();
    stage = 'guest accounts need the classroom gate';
    assert.equal((await request('/api/auth/sign-in/anonymous', { method: 'POST', data: {} })).status, 403);
    const guest = await admitted();
    const created = await request('/api/auth/sign-in/anonymous', { method: 'POST', data: {}, jar: guest });
    assert.equal(created.status, 200);
    assert.ok(created.headers.getSetCookie().some(cookie => cookie.includes('session_token=')));
    const guestSession = await session(guest);
    assert.equal(guestSession.user.isAnonymous, true);
    assert.equal(guestSession.user.name, '訪客');
    assert.equal((await request('/api/auth/sign-in/anonymous', { method: 'POST', data: {}, jar: guest })).status, 400);
    const initial = await request('/api/morning', { jar: guest });
    assert.equal(initial.status, 200); assert.equal(initial.body.state, null);
    t.diagnostic('guest accounts: refused without the gate, named 訪客, one per browser, can read the lesson');

    stage = 'guest practice after accepting the statement on start';
    const code = initial.body.catalog.symbols[0].code;
    const start = { action: 'start', requestId: randomUUID(), plan: { exerciseId: 'first-order', bias: 'bullish', focusCode: code,
      reason: '開盤後走強，想等它站上前高', entry: '價格站上前高（圖上標「前高」的虛線）再買', stop: '跌回前高下方就賣出' } };
    assert.equal((await post(guest, start)).status, 403);
    const began = await post(guest, { ...start, requestId: randomUUID(), guestTerms: true });
    assert.equal(began.status, 200);
    let state = began.body.state;
    await ready(state);
    state = (await post(guest, nextAction(state, 'advance'))).body.state;
    state = (await post(guest, nextAction(state, 'order', { code, side: 'buy', lots: 1 }))).body.state;
    await ready(state);
    state = (await post(guest, nextAction(state, 'advance'))).body.state;
    assert.equal(state.cursor, 2); assert.equal(state.fills.length, 1);
    assert.equal((await profileRpc(guest)).ok, false, 'A guest must not create a classroom profile');
    t.diagnostic('guest practice: start refused until the statement is accepted, then orders fill normally; no classroom profile');

    stage = 'sign-up moves the guest practice into the new account';
    const oldGuest = newJar(guest);
    const signedUp = await request('/api/auth/sign-up/email', { method: 'POST', jar: guest,
      data: { name: 'Guest fixture', email: 'guest-owner@example.invalid', password } });
    assert.equal(signedUp.status, 200);
    assert.equal((await request('/api/morning', { jar: guest })).status, 403);
    assert.equal((await profileRpc(guest)).ok, true);
    assert.deepEqual((await request('/api/morning', { jar: guest })).body.state, state);
    assert.equal((await session(guest)).user.isAnonymous, false);
    assert.equal(await session(oldGuest), null, 'The guest and its sessions are deleted after linking');
    t.diagnostic('linking: practice moved, profile step still required, guest deleted');

    stage = 'an account keeps its own unfinished run';
    const carol = await admitted();
    assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', jar: carol,
      data: { name: 'Carol fixture', email: 'carol@example.invalid', password } })).status, 200);
    assert.equal((await profileRpc(carol)).ok, true);
    const carolRun = (await post(carol, { ...start, requestId: randomUUID() })).body.state;
    const visitor = await admitted();
    assert.equal((await request('/api/auth/sign-in/anonymous', { method: 'POST', data: {}, jar: visitor })).status, 200);
    assert.equal((await post(visitor, { ...start, requestId: randomUUID(), guestTerms: true })).status, 200);
    const signedIn = await request('/api/auth/sign-in/email', { method: 'POST', jar: visitor,
      data: { email: 'carol@example.invalid', password } });
    assert.equal(signedIn.status, 200);
    assert.ok(signedIn.headers.getSetCookie().some(cookie => cookie.startsWith('day-tycoon-link-notice=skipped')));
    assert.equal((await request('/api/morning', { jar: carol })).body.state.id, carolRun.id);
    t.diagnostic('conflict: the account run is kept and the learner is told once');

    for (const value of [password, gateCode, secret, ...jars.flatMap(jar => [...jar.values()])])
      assert.equal(logs.includes(value), false, 'Generated credentials must not appear in app logs');
  } catch (error) { t.diagnostic('Failure stage: ' + stage); throw error; }
  finally {
    await close();
    if (resolve(runtime).startsWith(resolve(tmpdir()) + sep) && basename(runtime).startsWith('guest-http-test-') && dirname(env.PGLITE_DATA_DIR) === runtime)
      await rm(runtime, { recursive: true, force: true });
  }
});
