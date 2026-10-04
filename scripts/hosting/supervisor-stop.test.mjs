import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const supervisor = join(here, 'supervisor.mjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readState = (runtime) => { try { return JSON.parse(readFileSync(join(runtime, 'state.json'), 'utf8')); } catch { return null; } };
async function bounded(promise, timeoutMs, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
async function waitFor(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(50); }
  throw new Error(message);
}
async function fixture(port) {
  if (!port) {
    const listener = createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
  }
  const runtime = mkdtempSync(join(tmpdir(), 'daytrade-stop-fault-test-'));
  mkdirSync(join(runtime, 'secrets'));
  writeFileSync(join(runtime, 'tunnel'), 'setInterval(() => {}, 1000);');
  writeFileSync(join(runtime, 'secrets', 'tunnel.yml'), '# isolated fixture; no network tunnel');
  writeFileSync(join(runtime, 'secrets', 'app.env'), 'BETTER_AUTH_URL=https://example.invalid\nBETTER_AUTH_SECRET=fixture-only-000000000000000000000000\nCLASSROOM_AUTH_ENABLED=true\nCLASSROOM_GATE_PASSWORD_HASH=fixture-only-hash\n');
  writeFileSync(join(runtime, 'hosting.json'), JSON.stringify({ appEntry: join(here, 'fixtures', 'test-app.mjs'), port, cloudflaredPath: process.execPath, tunnelConfig: join(runtime, 'secrets', 'tunnel.yml') }));
  return runtime;
}
function removeFixture(runtime) {
  // Fail closed before removing anything except this test's own verified path.
  assert.equal(runtime.startsWith(join(tmpdir(), 'daytrade-stop-fault-test-')), true);
  assert.equal(JSON.parse(readFileSync(join(runtime, 'hosting.json'), 'utf8')).appEntry, join(here, 'fixtures', 'test-app.mjs'));
  rmSync(runtime, { recursive: true, force: true });
}
const run = (command, runtime) => exec(process.execPath, [supervisor, command, '--runtime', runtime], { timeout: 5000, windowsHide: true });

test('manual stop retains the pipe lease across a Windows lock-file cleanup failure and finally exits zero', { skip: process.platform !== 'win32', timeout: 45000 }, async () => {
  const runtime = await fixture();
  const child = spawn(process.execPath, [supervisor, 'run', '--runtime', runtime], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
  const exited = once(child, 'exit');
  let locker, lockerExited;
  try {
    const started = await waitFor(() => { const state = readState(runtime); return state?.status === 'running' && state; }, 'Fixture did not become healthy.');
    assert.equal(started.supervisorPid, child.pid);
    const script = "$ErrorActionPreference = 'Stop'\n$fixtureLock = [IO.File]::Open($env:HOSTING_FIXTURE_LOCK, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)\ntry { [Console]::Out.WriteLine('READY'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $fixtureLock.Dispose() }";
    locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOSTING_FIXTURE_LOCK: join(runtime, 'service.lock') },
    });
    lockerExited = once(locker, 'exit');
    await bounded(new Promise((resolve, reject) => {
      locker.stdout.on('data', (data) => { if (String(data).includes('READY')) resolve(); });
      locker.once('error', reject);
      locker.once('exit', () => reject(new Error('Fixture file locker exited before readiness.')));
    }), 5000, 'Fixture file locker did not become ready.');
    writeFileSync(join(runtime, 'stop-request.json'), JSON.stringify({ instanceId: started.instanceId }));
    await waitFor(() => readState(runtime)?.status === 'stop-failed', 'Cleanup failure was not retried.');
    const status = JSON.parse((await run('status', runtime)).stdout);
    assert.equal(status.supervisorRunning, true, 'the ownership pipe must remain held while cleanup is retried');
    assert.equal(status.runtimeOwner.pid, child.pid);
    assert.equal(status.state.appPid, null);
    assert.equal(status.state.tunnelPid, null);
    assert.equal(child.exitCode, null);
    await assert.rejects(run('backup', runtime), /live service or maintenance/);
    const duplicate = JSON.parse((await run('start', runtime)).stdout);
    assert.equal(duplicate.alreadyRunning, true);
    assert.equal(duplicate.state.supervisorPid, child.pid);
    locker.stdin.end('\n');
    assert.deepEqual(await bounded(lockerExited, 5000, 'Fixture file locker did not exit.'), [0, null]);
    assert.deepEqual(await bounded(exited, 10000, 'Supervisor did not complete the shutdown retry.'), [0, null]);
    const stopped = JSON.parse((await run('status', runtime)).stdout);
    assert.equal(stopped.supervisorRunning, false);
    assert.equal(stopped.state.status, 'stopped');
    assert.equal(stopped.state.lastCleanShutdown, true);
    assert.equal(JSON.parse((await run('backup', runtime)).stdout).verified, true);
  } finally {
    if (locker && locker.exitCode === null) { locker.stdin.end('\n'); await bounded(lockerExited, 5000, 'Fixture locker cleanup timed out.'); }
    if (child.exitCode === null && child.signalCode === null) {
      const state = readState(runtime);
      if (state?.supervisorPid === child.pid) writeFileSync(join(runtime, 'stop-request.json'), JSON.stringify({ instanceId: state.instanceId }));
      await bounded(exited, 15000, 'Fixture supervisor cleanup timed out; retaining its temporary directory.');
    }
    removeFixture(runtime);
  }
});

test('an actual supervisor failure still exits one and leaves the unrelated listener alive', { timeout: 10000 }, async () => {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const runtime = await fixture(listener.address().port);
  try {
    await assert.rejects(run('run', runtime), (error) => error.code === 1);
    assert.equal(listener.listening, true);
    assert.equal(readState(runtime).status, 'stopped-unclean');
    assert.equal(readState(runtime).lastCleanShutdown, false);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
    removeFixture(runtime);
  }
});

test('backup cleanup failure releases maintenance ownership and exits with an error instead of hanging', { timeout: 10000 }, async () => {
  const runtime = await fixture();
  mkdirSync(join(runtime, 'data', 'pglite'), { recursive: true });
  writeFileSync(join(runtime, 'data', 'pglite', 'fixture-data'), 'offline fixture data');
  writeFileSync(join(runtime, 'state.json'), JSON.stringify({ status: 'stopped', lastCleanShutdown: true }));
  // A preload only for this child injects the exact cleanup error at this test's
  // own lock path. No production hooks, files, processes or schedules are used.
  const faultSource = `import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.unlinkSync;
    fs.unlinkSync = function(path) {
      if (String(path) === ${JSON.stringify(join(runtime, 'service.lock'))}) {
        throw Object.assign(new Error('Fixture cleanup denied.'), { code: 'EPERM' });
      }
      return original.apply(this, arguments);
    };
    syncBuiltinESMExports();`;
  try {
    await assert.rejects(exec(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(faultSource)}`, supervisor, 'backup', '--runtime', runtime], { timeout: 5000, windowsHide: true }), (error) => {
      assert.equal(error.killed, false, 'the backup command must finish without the test timeout killing it');
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Fixture cleanup denied/);
      return true;
    });
    const status = JSON.parse((await run('status', runtime)).stdout);
    assert.equal(status.runtimeOwner, null);
    assert.equal(status.state.status, 'stopped');
    assert.equal(status.state.lastCleanShutdown, true);
    assert.equal(JSON.parse((await run('backup', runtime)).stdout).verified, true, 'a stale owner record cannot prevent the next verified offline backup');
  } finally {
    removeFixture(runtime);
  }
});
