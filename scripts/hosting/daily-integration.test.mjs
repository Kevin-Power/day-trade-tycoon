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
import { writeMarketFixture } from '../qa/make-market-fixture.mjs';
import { defaultSerovalPlugins } from '@tanstack/router-core';

const entrySetting = process.env.CLASSROOM_TEST_RELEASE;
const here = dirname(fileURLToPath(import.meta.url));
const origin = 'https://daily-test.invalid';
const wait = ms => new Promise(done => setTimeout(done, ms));

test('real HTTP daily question: gate, no answer before answering, one answer each, class counts', {
  skip: !entrySetting ? 'Set CLASSROOM_TEST_RELEASE to an immutable built server/index.mjs' : false,
  timeout: 150000,
}, async t => {
  const entry = resolve(entrySetting);
  await access(entry);
  const port = 18798;
  const vacant = createServer();
  await new Promise((done, fail) => { vacant.once('error', fail); vacant.listen(port, '127.0.0.1', done); });
  await new Promise(done => vacant.close(done));
  const runtime = await mkdtemp(join(tmpdir(), 'daily-http-test-'));
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
    CLASSROOM_CODE: 'DAILYTEST', MARKET_DATA_DIR: marketData, DAILY_NOW_ISO: '2026-10-19T07:00:00+08:00', CLASSROOM_TEACHER_IDS: '', TEACHER_EMAILS: '', ADMIN_SETUP_EMAIL: '', ADMIN_SETUP_TOKEN: '',
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
    const outgoing = new Headers({ origin, 'cf-connecting-ip': '192.0.2.81', ...headers });
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
      body: JSON.stringify(await toJSONAsync({ data: { displayName: 'Guest fixture student', classCode: 'DAILYTEST', acceptTos: true } }, { plugins: defaultSerovalPlugins })),
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
  const daily = (jar, data, query = '') => request('/api/daily' + query, data === undefined ? { jar } : { method: 'POST', jar, data });
  const member = async (email) => {
    const jar = await admitted();
    assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', jar, data: { name: 'Daily fixture', email, password } })).status, 200);
    assert.equal((await profileRpc(jar)).ok, true);
    return jar;
  };
  try {
    await launch();
    stage = 'the gate comes first';
    assert.equal((await request('/api/daily')).status, 403);

    stage = 'before answering nothing after the question minute is sent';
    const guest = await admitted();
    assert.equal((await request('/api/auth/sign-in/anonymous', { method: 'POST', data: {}, jar: guest })).status, 200);
    const first = await daily(guest);
    assert.equal(first.status, 200);
    const question = first.body.question;
    assert.equal(question.dataDate, '2026-10-14');
    assert.equal(question.issueDate, '2026-10-19');
    assert.ok(question.bars.length > 0 && question.bars.every(bar => bar.t <= question.questionT));
    assert.equal(JSON.stringify(first.body).includes('higherHigh'), false);
    assert.equal(first.body.reveal, null);
    assert.equal(first.body.needsTerms, true);
    t.diagnostic('daily question: gate required; the answer is not in the response before answering');

    stage = 'answering reveals the day and the class counts';
    assert.equal((await daily(guest, { questionId: question.dataDate, choice: 'enter', guestTerms: true })).status, 400);
    const answered = await daily(guest, { questionId: question.dataDate, choice: 'enter', stopPrice: question.stops.pullback, guestTerms: true });
    assert.equal(answered.status, 200);
    assert.ok(answered.body.reveal.entry);
    assert.ok(answered.body.reveal.bars.some(bar => bar.t > question.questionT));
    assert.equal(answered.body.reveal.counts.total, 1);
    assert.equal(answered.body.progress.streak, 1);
    const alice = await member('daily-alice@example.invalid');
    const watched = await daily(alice, { questionId: question.dataDate, choice: 'watch' });
    assert.equal(watched.status, 200);
    assert.deepEqual(watched.body.reveal.counts, { enter: 1, watch: 1, skip: 0, total: 2 });
    assert.equal((await daily(alice, { questionId: question.dataDate, choice: 'skip' })).body.answer.choice, 'watch');
    t.diagnostic('daily answers: stop required to enter, one answer each, counts shared');

    stage = 'only teachers may see the reveal without answering';
    const carol = await member('daily-carol@example.invalid');
    assert.equal((await daily(carol, undefined, '?reveal=1')).body.reveal, null);
    assert.equal((await daily(carol, { questionId: '2026-10-13', choice: 'watch' })).status, 409);

    for (const value of [password, gateCode, secret, ...jars.flatMap(jar => [...jar.values()])])
      assert.equal(logs.includes(value), false, 'Generated credentials must not appear in app logs');
  } catch (error) { t.diagnostic('Failure stage: ' + stage); throw error; }
  finally {
    await close();
    if (resolve(runtime).startsWith(resolve(tmpdir()) + sep) && basename(runtime).startsWith('daily-http-test-') && dirname(env.PGLITE_DATA_DIR) === runtime)
      await rm(runtime, { recursive: true, force: true });
  }
});
