import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { initialize, verifyPackage } from './launcher.mjs';

const exec = promisify(execFile);
const packagePath = process.env.ONPREM_TEST_PACKAGE;
const here = dirname(fileURLToPath(import.meta.url));

test('extracted standalone package: Chrome admission, owner setup, cookies, no daily lessons, restart and consistent backup', {
  skip: !packagePath ? 'Set ONPREM_TEST_PACKAGE to an extracted immutable package directory' : false,
  timeout: 150000,
}, async t => {
  const isolated = await mkdtemp(join(tmpdir(), 'onprem-http-browser-'));
  const root = join(isolated, 'DayTradeTycoon-OnPrem');
  const evidence = resolve(here, '../../artifacts/onprem-reference-20261009/validation');
  await mkdir(evidence, { recursive: true });
  await cp(resolve(packagePath), root, { recursive: true, filter: source => !['data', 'backups'].includes(source.split(/[\\/]/).at(-1)) });
  await verifyPackage(root);
  const config = await initialize(root, { ownerEmail: 'portable-owner@example.invalid', classCode: 'PORTABLE', port: 18798 });
  const base = 'http://127.0.0.1:' + config.port;
  const password = randomBytes(20).toString('base64url');
  let launcher;
  let closed;
  let browser;
  let browserName;
  let logs = '';
  let clean = true;
  async function start() {
    clean = false;
    launcher = fork(join(root, 'launcher.mjs'), ['start'], {
      cwd: isolated, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, DATABASE_URL: 'postgres://must-not-be-used.invalid/db', CLASSROOM_AUTH_ENABLED: 'false',
        HOST: '0.0.0.0', NITRO_HOST: '0.0.0.0', BETTER_AUTH_URL: 'https://must-not-be-used.invalid' },
    });
    launcher.stdout.on('data', chunk => { logs += chunk.toString(); });
    launcher.stderr.on('data', chunk => { logs += chunk.toString(); });
    closed = new Promise(done => launcher.once('exit', (code, signal) => done({ code, signal })));
    let timer;
    try {
      await Promise.race([
        new Promise((done, fail) => {
          timer = setTimeout(() => fail(new Error('Launcher readiness timed out')), 45000);
          launcher.on('message', message => { if (message?.type === 'ready') { assert.equal(message.origin, base); done(); } });
        }),
        closed.then(() => { throw new Error('Launcher exited before readiness: ' + logs.slice(-1800)); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function stop() {
    if (!launcher || launcher.exitCode !== null || launcher.signalCode !== null) return;
    let acknowledged = false;
    launcher.on('message', message => { if (message?.type === 'shutdown-complete') acknowledged = true; });
    launcher.send({ type: 'shutdown' });
    let timer;
    try {
      const exit = await Promise.race([closed, new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('Launcher stop timed out')), 35000); })]);
      assert.equal(exit.code, 0); assert.equal(acknowledged, true); clean = true;
    } finally { clearTimeout(timer); }
  }
  try {
    await start();
    await assert.rejects(exec(process.execPath, [join(root, 'launcher.mjs'), 'backup'], { cwd: isolated, windowsHide: true }), /正在執行或備份/);
    await assert.rejects(exec(process.execPath, [join(root, 'launcher.mjs'), 'start'], { cwd: isolated, windowsHide: true }), /正在執行或備份/);
    assert.equal((await fetch(base + '/api/morning')).status, 403);
    try { browser = await chromium.launch({ channel: 'chrome', headless: true }); browserName = 'Chrome'; }
    catch { browser = await chromium.launch({ channel: 'msedge', headless: true }); browserName = 'Edge'; }
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const blockedExternal = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === base) return route.continue();
      blockedExternal.push(url.origin); return route.abort();
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(base + '/setup#token=' + config.setupToken);
    await page.getByLabel('教室入場碼', { exact: true }).fill(config.gateCode);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '進入教室', exact: true }).click();
    await page.getByLabel('講師顯示名稱', { exact: true }).fill('地端驗收講師');
    await page.getByLabel('設定帳號密碼', { exact: true }).fill(password);
    await page.getByLabel('再次輸入密碼', { exact: true }).fill(password);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '建立講師帳號', exact: true }).click();
    await page.getByText('講師帳號已建立', { exact: true }).waitFor();
    await page.getByRole('link', { name: '前往登入', exact: true }).click();
    await page.getByLabel('電子信箱', { exact: true }).fill(config.ownerEmail);
    await page.getByLabel('帳號密碼', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登入，繼續下一步', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/');
    const request = context.request;
    const get = path => request.get(base + path);
    const post = data => request.post(base + '/api/morning', { headers: { origin: base }, data });
    const session = await (await get('/api/auth/get-session')).json();
    assert.equal(session.user.email, config.ownerEmail);
    const cookieNames = (await context.cookies()).map(cookie => cookie.name);
    assert.ok(cookieNames.includes('classroom_gate')); assert.ok(cookieNames.includes('classroom.session_token'));
    assert.ok(!(await context.cookies()).some(cookie => cookie.name.startsWith('__Host-')));
    // An on-premises classroom has no daily lessons (they come from market data it does not carry): the practice API
    // says so in one sentence, for a read and for a start, and nothing of any lesson is sent. The learner's own runs
    // would still be listed (`records`); a fresh classroom has none.
    const NO_LESSONS = '此教室沒有每日教材';
    const info = await (await get('/api/morning')).json();
    assert.deepEqual(info, { unavailable: NO_LESSONS });
    assert.equal((await request.post(base + '/api/morning', { headers: { origin: 'https://wrong.invalid' }, data: {} })).status(), 403);
    const began = await post({ action: 'start', requestId: randomUUID(), codes: ['2330'], plan: { exerciseId: 'first-order', bias: 'observe',
      focusCode: '2330', reason: '地端沒有教材驗收', entry: '先觀察再決定', stop: '條件失效時離場' } });
    assert.equal(began.status(), 200);
    assert.deepEqual(await began.json(), { unavailable: NO_LESSONS });
    const named = await get('/api/morning?lesson=fubon-20261027-am');
    assert.equal(named.status(), 200);
    assert.deepEqual(await named.json(), { unavailable: NO_LESSONS });
    await page.goto(base + '/morning');
    await page.getByText(NO_LESSONS, { exact: true }).waitFor({ state: 'attached' });
    await page.screenshot({ path: join(evidence, 'desktop.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.setViewportSize({ width: 375, height: 812 });
    // Resize observers and responsive chart layout finish after the viewport command returns.
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: join(evidence, 'mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const privateDownload = await get('/api/download/offline'); assert.equal(privateDownload.status(), 200);
    const stableSettings = await readFile(join(root, 'data/config.json'), 'utf8');
    await stop();
    await start();
    assert.equal(await readFile(join(root, 'data/config.json'), 'utf8'), stableSettings);
    assert.equal((await (await get('/api/auth/get-session')).json()).user.id, session.user.id);
    assert.deepEqual(await (await get('/api/morning')).json(), { unavailable: NO_LESSONS });
    assert.equal((await (await get('/api/admin/setup')).json()).available, false);
    await page.reload();
    await page.getByText(NO_LESSONS, { exact: true }).waitFor({ state: 'attached' });
    await page.screenshot({ path: join(evidence, 'restarted.png'), fullPage: true });
    assert.deepEqual(pageErrors, []);
    await stop();
    const backedUp = await exec(process.execPath, [join(root, 'launcher.mjs'), 'backup'], { cwd: isolated, windowsHide: true });
    assert.match(backedUp.stdout, /備份完成/);
    await verifyPackage(root);
    const result = { passed: true, browser: browserName, browserMode: 'headless installed browser', productionChanged: false,
      packageRoot: resolve(packagePath), testedOutsideRepository: true, networkRestrictedToLoopback: true,
      attemptedExternalOrigins: [...new Set(blockedExternal)], desktop: '1366x900', mobile: '375x812',
      cookiesSurviveRestart: true, noDailyLessonsSentenceSurvivesRestart: true, databaseShutdownAcknowledged: true, backupPassed: true, pageErrors };
    await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    t.diagnostic(JSON.stringify(result));
  } finally {
    await browser?.close();
    await stop().catch(() => undefined);
    await writeFile(join(evidence, 'launcher.log'), logs);
    if (clean) await rm(isolated, { recursive: true, force: true });
    else t.diagnostic('Unclean test runtime preserved: ' + isolated);
  }
});
