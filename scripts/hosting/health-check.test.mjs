import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { probeHealth } from './health-check.mjs';

const sensitive = 'never-log-response-or-error-secret';
const fakeClock = () => { let time = 100; return () => { const result = time; time += 7; return result; }; };
const probe = (fetchImpl) => probeHealth(`http://example.invalid/${sensitive}`, { fetchImpl, now: fakeClock() });

test('health accepts existing payload contracts and reports bounded duration/status', async () => {
  for (const value of [{ ok: true }, { status: 'ok' }, { status: 'healthy' }]) {
    const result = await probe(async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(value);
    });
    assert.deepEqual(result, { ok: true, kind: 'healthy', durationMs: 7, status: 200 });
  }
});

test('HTTP, JSON and unhealthy payload failures expose no body, URL or raw error', async () => {
  for (const [fetchImpl, expected] of [
    [async () => new Response(sensitive, { status: 503 }), { ok: false, kind: 'http-error', durationMs: 7, status: 503 }],
    [async () => new Response(sensitive, { status: 200 }), { ok: false, kind: 'invalid-json', durationMs: 7 }],
    [async () => Response.json({ error: sensitive }), { ok: false, kind: 'unhealthy-payload', durationMs: 7, status: 200 }],
    [async () => Response.json(null), { ok: false, kind: 'unhealthy-payload', durationMs: 7, status: 200 }],
    [async () => { throw new TypeError(sensitive); }, { ok: false, kind: 'request-error', durationMs: 7 }],
    [async () => { throw new DOMException(sensitive, 'TimeoutError'); }, { ok: false, kind: 'timeout', durationMs: 7 }],
  ]) {
    const result = await probe(fetchImpl);
    assert.deepEqual(result, expected);
    assert.equal(JSON.stringify(result).includes(sensitive), false);
  }
});

test('an actual stalled loopback response body is classified as timeout and the request is aborted', { timeout: 5000 }, async () => {
  let requestClosed;
  let received = false;
  let closeDeadline;
  const closed = new Promise((resolve) => { requestClosed = resolve; });
  const server = createServer((request, response) => {
    received = true;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{');
    request.once('close', requestClosed);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await probeHealth(`http://127.0.0.1:${server.address().port}`, { timeoutMs: 1000 });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'timeout');
    assert.ok(result.durationMs >= 500);
    assert.equal(received, true, 'the fixture must receive the request to exercise body timeout');
    await Promise.race([
      closed,
      new Promise((_, reject) => { closeDeadline = setTimeout(() => reject(new Error('Timed out waiting for fixture request closure.')), 2000); }),
    ]);
  } finally {
    clearTimeout(closeDeadline);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
