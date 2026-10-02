import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const supervisor = join(here, 'supervisor.mjs');
async function vacantPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function fixture(port) {
  const runtime = mkdtempSync(join(tmpdir(), 'daytrade-hosting-test-'));
  mkdirSync(join(runtime, 'secrets'));
  // Node acts as a fake cloudflared executable; its "tunnel" script makes no network calls.
  writeFileSync(join(runtime, 'tunnel'), 'setInterval(() => {}, 1000);');
  writeFileSync(join(runtime, 'secrets', 'tunnel.yml'), '# isolated fixture, no real tunnel');
  const secret = 'test-secret-only-000000000000000000000000';
  writeFileSync(join(runtime, 'secrets', 'app.env'), `BETTER_AUTH_URL=https://example.invalid\nBETTER_AUTH_SECRET=${secret}\nCLASSROOM_AUTH_ENABLED=true\nCLASSROOM_GATE_PASSWORD_HASH=fake-test-hash-only\n`);
  writeFileSync(join(runtime, 'hosting.json'), JSON.stringify({ appEntry: join(here, 'fixtures', 'test-app.mjs'), port, cloudflaredPath: process.execPath, tunnelConfig: join(runtime, 'secrets', 'tunnel.yml') }));
  return { runtime, secret };
}
const run = (command, runtime) => exec(process.execPath, [supervisor, command, '--runtime', runtime], { timeout: 115000, windowsHide: true });

test('isolated host lifecycle protects an active database and publishes verified offline backup', { timeout: 120000 }, async () => {
  const { runtime, secret } = fixture(await vacantPort());
  try {
    const started = JSON.parse((await run('start', runtime)).stdout);
    assert.equal(started.status, 'running');
    const status = JSON.parse((await run('status', runtime)).stdout);
    assert.equal(status.healthy, true);
    assert.equal(status.supervisorRunning, true);
    const duplicate = JSON.parse((await run('start', runtime)).stdout);
    assert.equal(duplicate.alreadyRunning, true);
    assert.equal(duplicate.state.supervisorPid, started.supervisorPid);
    await assert.rejects(run('backup', runtime), /live service or maintenance/);
    await fetch(`http://127.0.0.1:${started.port}/fixture-crash`);
    const recoveryDeadline = Date.now() + 35000;
    let recovered;
    while (Date.now() < recoveryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      recovered = JSON.parse(readFileSync(join(runtime, 'state.json'), 'utf8'));
      if (recovered.status === 'running' && recovered.restartCount >= 1 && recovered.appPid !== started.appPid) break;
    }
    assert.equal(recovered.status, 'running');
    assert.ok(recovered.restartCount >= 1);
    assert.notEqual(recovered.appPid, started.appPid);
    const stopped = JSON.parse((await run('stop', runtime)).stdout);
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.lastCleanShutdown, true);
    assert.equal(existsSync(join(runtime, 'data', 'pglite', 'closed')), true);
    const backup = JSON.parse((await run('backup', runtime)).stdout);
    assert.equal(backup.verified, true);
    const manifest = JSON.parse(readFileSync(join(backup.backup, 'manifest.json'), 'utf8'));
    for (const file of manifest.files) {
      const bytes = readFileSync(join(backup.backup, file.path));
      assert.equal(bytes.length, file.size);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
    const appLog = readFileSync(join(runtime, 'logs', 'app.log'), 'utf8');
    assert.equal(appLog.includes(secret), false);
    assert.match(appLog, /\[redacted\]/);
    // Unclean state must never be promoted to a verified backup.
    writeFileSync(join(runtime, 'state.json'), JSON.stringify({ status: 'stopped-unclean', lastCleanShutdown: false }));
    await assert.rejects(run('backup', runtime), /acknowledged clean database shutdown/);
  } finally {
    await run('stop', runtime).catch(() => {});
    // Only this test-created temporary directory is removed; never a production runtime.
    // eslint-disable-next-line no-unsafe-finally -- Fail closed before removing an unverified test path.
    if (!readFileSync(join(runtime, 'hosting.json'), 'utf8').includes('test-app.mjs')) throw new Error('Fixture ownership lost.');
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('occupied loopback port is retained and its unrelated listener is not terminated', { timeout: 15000 }, async () => {
  const listener = createServer((socket) => socket.end('unrelated'));
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const { runtime } = fixture(listener.address().port);
  try {
    await assert.rejects(run('start', runtime), /Supervisor exited/);
    assert.equal(listener.listening, true);
    assert.match(readFileSync(join(runtime, 'logs', 'supervisor.log'), 'utf8'), /port is occupied/);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('preflight failure persists its stage without logging protected environment values', { timeout: 15000 }, async () => {
  const { runtime } = fixture(await vacantPort());
  const invalidSecret = 'short-sensitive-test-secret';
  try {
    writeFileSync(join(runtime, 'secrets', 'app.env'), `BETTER_AUTH_SECRET=${invalidSecret}\n`);
    await assert.rejects(run('run', runtime), /at least 32 characters/);
    const log = readFileSync(join(runtime, 'logs', 'supervisor.log'), 'utf8');
    assert.match(log, /Starting supervisor pid=/);
    assert.match(log, /Fatal during loading protected application environment: Error/);
    assert.equal(log.includes(invalidSecret), false);
    assert.equal(existsSync(join(runtime, 'state.json')), false);
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});
