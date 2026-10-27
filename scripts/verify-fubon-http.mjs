import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const runtime = await mkdtemp(join(tmpdir(), 'fubon-readonly-qa-'));
const port = 18824, origin = `http://127.0.0.1:${port}`;
const live = process.argv.includes('--live'), serve = process.argv.includes('--serve');
const gate = 'Fubon-local-QA-only', password = 'Local-QA-only-2026!';
const salt = randomBytes(16).toString('hex'), token = randomBytes(32).toString('hex');
const gateHash = ['scrypt', salt, scryptSync(gate, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')].join('$');
const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port),
  BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), CLASSROOM_LOCAL_ONLY: 'true', CLASSROOM_TRUST_PROXY: 'false',
  CLASSROOM_AUTH_ENABLED: 'true', VITE_AUTH_ENABLED: 'true', DATABASE_URL: '', PGLITE_DATA_DIR: join(runtime, 'db'),
  CLASSROOM_GATE_PASSWORD_HASH: gateHash, ADMIN_SETUP_EMAIL: 'fubon-owner@example.invalid', ADMIN_SETUP_TOKEN: token,
  CLASSROOM_TEACHER_IDS: '', TEACHER_EMAILS: '', GROK_PROJECT_ID: '', GROK_AUTH_CLIENT_ID: '', GROK_AUTH_CLIENT_SECRET: '',
  FUBON_READONLY_ENABLED: live ? 'true' : 'false', FUBON_READONLY_WORKER: resolve('.output/server/fubon-live/worker.py'),
};
const app = fork(resolve('scripts/hosting/app-runner.mjs'), [resolve('.output/server/index.mjs')], {
  env, cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
// Do not print runtime logs or cookies; report only explicit assertions.
app.stdout.resume(); app.stderr.resume();
const owner = new Map(), student = new Map();
const delay = ms => new Promise(done => setTimeout(done, ms));
async function request(path, { jar = new Map(), method = 'GET', data, customOrigin = origin } = {}) {
  const headers = { origin: customOrigin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(data ? { 'content-type': 'application/json' } : {}) };
  const response = await fetch(origin + path, { method, headers, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(15000) });
  for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'); const at = pair.indexOf('='); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  return { status: response.status, headers: response.headers, body: await response.json() };
}
const evidence = { started: new Date().toISOString(), live, checks: [], market: null };
async function check(name, promise, expected) { const r = await promise; assert.equal(r.status, expected, name); evidence.checks.push({ name, status: r.status }); return r; }
try {
  let healthy = false;
  for (let i = 0; i < 120; i++) { try { if ((await request('/api/health')).status === 200) { healthy = true; break; } } catch {} await delay(250); }
  assert.ok(healthy, 'isolated server ready');
  await check('no gate rejected', request('/api/broker/quotes?access=1'), 403);
  await check('owner gate', request('/api/gate', { jar: owner, method: 'POST', data: { password: gate } }), 200);
  await check('gate without user rejected', request('/api/broker/quotes?access=1', { jar: owner }), 401);
  await check('test owner setup', request('/api/admin/setup', { jar: owner, method: 'POST', data: { email: env.ADMIN_SETUP_EMAIL, name: '行情驗證帳號', password, token, acceptTos: true } }), 200);
  await check('owner login', request('/api/auth/sign-in/email', { jar: owner, method: 'POST', data: { email: env.ADMIN_SETUP_EMAIL, password } }), 200);
  await check('owner allowed', request('/api/broker/quotes?access=1', { jar: owner }), 200);
  await check('student gate', request('/api/gate', { jar: student, method: 'POST', data: { password: gate } }), 200);
  await check('test student signup', request('/api/auth/sign-up/email', { jar: student, method: 'POST', data: { email: 'fubon-student@example.invalid', name: '驗證學員', password } }), 200);
  await check('student cannot read personal broker feed', request('/api/broker/quotes?access=1', { jar: student }), 403);
  await check('cross origin blocked', request('/api/broker/quotes?access=1', { jar: owner, customOrigin: 'https://evil.invalid' }), 403);
  await check('quote write rejected', request('/api/broker/quotes', { jar: owner, method: 'POST', data: { order: 'buy' } }), 405);
  const lock = await check('real orders remain locked', request('/api/broker/order', { jar: owner, method: 'POST', data: { symbol: '2330' } }), 501);
  assert.equal(lock.body.code, 'LIVE_LOCKED');
  const query = `/api/broker/quotes?client=${randomUUID()}&symbols=2330,2317`;
  const until = Date.now() + (live ? 40000 : 1000);
  do {
    const r = await request(query, { jar: owner }); assert.equal(r.status, 200); assert.match(r.headers.get('cache-control'), /no-store/);
    assert.equal(r.body.liveOrders, false); assert.equal(r.body.readOnly, true);
    if (!live || r.body.rows.every(row => row.acknowledged && row.bookTime && row.tradeTime)) {
      evidence.market = { state: r.body.state, symbols: r.body.rows.map(row => ({ symbol: row.symbol, bookTime: row.bookTime, tradeTime: row.tradeTime, issue: row.issue })) }; break;
    }
    await delay(500);
  } while (Date.now() < until);
  assert.ok(evidence.market, 'HTTP returned validated broker quote snapshots');
  evidence.finished = new Date().toISOString();
  await writeFile(resolve('artifacts/fubon-live-http-2026-10-23.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  if (serve) {
    const stopFile = resolve('artifacts/fubon-qa-stop');
    console.log(JSON.stringify({ localPreview: origin + '/morning?feed=fubon', testGate: gate, testEmail: env.ADMIN_SETUP_EMAIL, testPassword: password, stopFile }));
    for (;;) { try { await access(stopFile); break; } catch {} await delay(1000); }
  }
} finally {
  if (app.exitCode === null) {
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('database shutdown not acknowledged')), 25000);
      app.on('message', m => { if (m?.type === 'shutdown-complete') { clearTimeout(timer); app.kill(); done(); } });
      app.send({ type: 'shutdown' });
    });
  }
}
