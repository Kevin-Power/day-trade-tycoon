import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, createConnection } from 'node:net';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function vacantPort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
async function rawRequest(port, path) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
    let response = ''; socket.on('data', (chunk) => response += chunk);
    socket.once('end', () => resolve(response)); socket.once('error', reject);
    socket.setTimeout(5000, () => socket.destroy(new Error('Request timed out.')));
  });
}

test('Windows offline server serves packaged assets and blocks escaped paths without an API fallback', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'daytrade-offline-test-'));
  const app = join(fixture, 'app'); mkdirSync(app);
  copyFileSync(join(root, 'src/offline/serve.ps1'), join(fixture, 'serve.ps1'));
  writeFileSync(join(app, 'index.html'), '<h1>offline fixture</h1>');
  writeFileSync(join(app, 'module.js'), 'export const value=42;');
  writeFileSync(join(fixture, 'private.txt'), 'must never be served');
  mkdirSync(join(fixture, 'app-sibling'));
  writeFileSync(join(fixture, 'app-sibling', 'private.txt'), 'prefix collision must never be served');
  const port = await vacantPort();
  const server = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(fixture, 'serve.ps1'), '-Port', String(port), '-NoBrowser'], { windowsHide: true, stdio: 'pipe' });
  let stderr = ''; server.stderr.on('data', (chunk) => stderr += chunk); server.stdout.resume();
  try {
    let response;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { response = await fetch(`http://127.0.0.1:${port}/`); break; } catch { await delay(100); }
    }
    assert.ok(response, stderr);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /offline fixture/);
    const module = await fetch(`http://127.0.0.1:${port}/module.js`);
    assert.match(module.headers.get('content-type'), /javascript/);
    assert.equal(await module.text(), 'export const value=42;');
    const head = await fetch(`http://127.0.0.1:${port}/module.js`, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.ok(Number(head.headers.get('content-length')) > 0);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/gate`)).status, 404);
    for (const escaped of ['/../private.txt', '/%2e%2e/private.txt', '/%2e%2e/app-sibling/private.txt', '/%2e%2e%5cprivate.txt']) {
      const raw = await rawRequest(port, escaped);
      assert.match(raw, /^HTTP\/1\.1 403/); assert.doesNotMatch(raw, /must never be served/);
    }
    assert.equal(server.exitCode, null);
  } finally {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    if (server.exitCode === null) server.kill();
    await Promise.race([exited, delay(1000)]);
    // The only removal target is this test-created temp directory, never the user's package.
    rmSync(fixture, { recursive: true, force: true });
  }
});
