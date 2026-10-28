// A disposable classroom for the daily-lesson QA scripts (real-day-check --release, perf-lessons): a built release
// (.output/server/index.mjs) on a loopback port with its own PGlite folder, the classroom gate and members created
// through the real sign-up route. Nothing here touches a production service or its data; the market data is whatever
// directory the caller names (read only by the app). Every request can carry its own client address, as a proxy
// would send it in cf-connecting-ip.
import { fork } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { Agent, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { fromCrossJSON, toJSONAsync } from 'seroval';
import { defaultSerovalPlugins } from '@tanstack/router-core';

const here = dirname(fileURLToPath(import.meta.url));
const wait = ms => new Promise(done => setTimeout(done, ms));

function send(agent, base, path, { method, headers, body }) {
  return new Promise((done, fail) => {
    const started = performance.now();
    const outgoing = httpRequest(base + path, { method, headers, agent, timeout: 60_000 }, response => {
      const firstByte = performance.now() - started;
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', fail);
      response.on('end', () => done({
        status: response.statusCode, headers: response.headers, raw: Buffer.concat(chunks),
        ms: performance.now() - started, firstByteMs: firstByte,
      }));
    });
    outgoing.on('error', fail);
    outgoing.on('timeout', () => outgoing.destroy(new Error('request timed out')));
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
}

/**
 * Starts the release and waits until it answers /api/health. `marketData` is MARKET_DATA_DIR ('' for none);
 * `now` pins the daily question's clock (DAILY_NOW_ISO). Resolves to the classroom handle.
 */
export async function startClassroom({ entry, marketData, port, now = '2026-10-19T07:00:00+08:00', label = 'lessons-qa' }) {
  const release = resolve(entry);
  await access(release);
  const vacant = createServer();
  await new Promise((done, fail) => { vacant.once('error', fail); vacant.listen(port, '127.0.0.1', done); });
  await new Promise(done => vacant.close(done));
  const runtime = await mkdtemp(join(tmpdir(), `${label}-`));
  const base = `http://127.0.0.1:${port}`;
  const origin = `https://${label}.invalid`;
  const password = randomBytes(20).toString('base64url');
  const gateCode = randomBytes(18).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const gateHash = ['scrypt', salt, scryptSync(gateCode, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')].join('$');
  const env = {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port),
    BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: secret, DATABASE_URL: '', PGLITE_DATA_DIR: join(runtime, 'pglite'),
    VITE_AUTH_ENABLED: 'true', CLASSROOM_AUTH_ENABLED: 'true', CLASSROOM_TRUST_PROXY: 'true', CLASSROOM_GATE_PASSWORD_HASH: gateHash,
    CLASSROOM_CODE: 'LESSONSQA', MARKET_DATA_DIR: marketData ?? '', DAILY_NOW_ISO: now, CLASSROOM_TEACHER_IDS: '', TEACHER_EMAILS: '',
    ADMIN_SETUP_EMAIL: '', ADMIN_SETUP_TOKEN: '', GROK_PROJECT_ID: '', GROK_AUTH_CLIENT_ID: '', GROK_AUTH_CLIENT_SECRET: '',
  };
  let profileId;
  for (const file of await readdir(join(dirname(release), '_ssr'))) {
    if (!file.endsWith('.mjs')) continue;
    const text = await readFile(join(dirname(release), '_ssr', file), 'utf8');
    const match = text.match(/upsertMyProfile_createServerFn_handler = createServerRpc\(\{\s*id: "([a-f0-9]+)"/)
      || text.match(/(?:var|const|let) upsertMyProfile = [\s\S]*?createSsrRpc\("([a-f0-9]+)"\)/);
    if (match) profileId = match[1];
  }
  if (!profileId) throw new Error('The built profile setup RPC was not found');
  const agent = new Agent({ keepAlive: true, maxSockets: 256 });
  let logs = '';
  let app = fork(join(here, 'lessons-runner.mjs'), [release], { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const capture = chunk => { logs = (logs + chunk.toString()).slice(-1_000_000); };
  app.stdout.on('data', capture);
  app.stderr.on('data', capture);
  const memoryWaiters = [];
  app.on('message', message => {
    if (message?.type === 'memory') memoryWaiters.splice(0).forEach(done => done(message));
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (app.exitCode !== null || app.signalCode !== null) throw new Error('The classroom exited during startup:\n' + logs.slice(-1500));
    try {
      const health = await send(agent, base, '/api/health', { method: 'GET', headers: {} });
      if (health.status === 200 && JSON.parse(health.raw.toString()).ok) break;
    } catch { /* still starting */ }
    if (Date.now() > deadline) throw new Error('The classroom was not ready in time');
    await wait(100);
  }

  /** One request. `jar` is a Map of cookies; `ip` is the client address the proxy would report. */
  async function request(path, { method = 'GET', data, jar = new Map(), ip = '192.0.2.50', headers = {}, origin: sent = origin } = {}) {
    const outgoing = { 'cf-connecting-ip': ip, ...headers };
    if (sent) outgoing.origin = sent;
    if (jar.size) outgoing.cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
    let body;
    if (data !== undefined) {
      body = JSON.stringify(data);
      outgoing['content-type'] = 'application/json';
      outgoing['content-length'] = String(Buffer.byteLength(body));
    }
    const result = await send(agent, base, path, { method, headers: outgoing, body });
    for (const cookie of [].concat(result.headers['set-cookie'] ?? [])) {
      const pair = cookie.split(';')[0];
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value) jar.set(name, value); else jar.delete(name);
    }
    const text = result.raw.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch { /* the caller looks at the status */ }
    return { status: result.status, headers: result.headers, raw: result.raw, text, body: json, ms: result.ms, firstByteMs: result.firstByteMs };
  }

  async function profileRpc(jar, ip) {
    const headers = {
      origin, 'sec-fetch-site': 'same-origin', 'x-tsr-serverFn': 'true', accept: 'application/json', 'content-type': 'application/json',
      cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), 'cf-connecting-ip': ip,
    };
    const body = JSON.stringify(await toJSONAsync({ data: { displayName: 'Lessons QA student', classCode: 'LESSONSQA', acceptTos: true } }, { plugins: defaultSerovalPlugins }));
    const result = await send(agent, base, '/_serverFn/' + profileId, { method: 'POST', headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) }, body });
    let decoded = null;
    try {
      const payload = JSON.parse(result.raw.toString('utf8'));
      decoded = result.headers['x-tss-serialized'] ? fromCrossJSON(payload, { plugins: defaultSerovalPlugins }) : payload;
    } catch { /* a refused call may not carry JSON */ }
    return result.status === 200 && !decoded?.error && (decoded?.result?.ok ?? decoded?.ok) === true;
  }

  // The gate checks at most four codes at a time (and ten minutes of failures per address), so one entry is made and
  // every member takes the same gate cookie(s).
  let gate;
  const enter = () => (gate ??= (async () => {
    const jar = new Map();
    const entered = await request('/api/gate', { method: 'POST', data: { password: gateCode }, jar, ip: '192.0.2.99' });
    if (entered.status !== 200) throw new Error(`The classroom gate refused the code (${entered.status})`);
    return jar;
  })());
  /** A member signed in with an accepted classroom profile. Sign-up has its own per-address limit, so each member comes from its own address. */
  async function member(index) {
    const ip = `192.0.2.${100 + (index % 150)}`;
    const jar = new Map(await enter());
    const signedUp = await request('/api/auth/sign-up/email', { method: 'POST', jar, ip, data: { name: `QA ${index}`, email: `qa-${index}-${randomBytes(4).toString('hex')}@example.invalid`, password } });
    if (signedUp.status !== 200) throw new Error(`Sign-up failed (${signedUp.status})`);
    if (!(await profileRpc(jar, ip))) throw new Error('The classroom profile was refused');
    return jar;
  }
  /** `count` members, a few at a time (password hashing is slow). */
  async function members(count, width = 4) {
    const out = new Array(count);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(width, count) }, async () => {
      while (next < count) { const at = next++; out[at] = await member(at); }
    }));
    return out;
  }

  const memory = () => new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('No memory report from the server')), 5000);
    memoryWaiters.push(message => { clearTimeout(timer); done(message); });
    app.send({ type: 'memory' });
  });

  async function stop() {
    agent.destroy();
    if (app && app.exitCode === null && app.signalCode === null) {
      const owned = app;
      const exit = new Promise(done => owned.once('exit', done));
      const closed = new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error('Database shutdown not acknowledged')), 25_000);
        owned.on('message', message => {
          if (message?.type === 'shutdown-complete') { clearTimeout(timer); done(); }
          if (message?.type === 'shutdown-error') { clearTimeout(timer); fail(new Error('Database shutdown failed')); }
        });
      });
      owned.send({ type: 'shutdown' });
      try { await closed; } finally { owned.kill(); await exit; }
    }
    if (resolve(runtime).startsWith(resolve(tmpdir()) + sep)) await rm(runtime, { recursive: true, force: true });
  }

  return { base, origin, runtime, request, member, members, memory, stop, logs: () => logs, pid: app.pid };
}
