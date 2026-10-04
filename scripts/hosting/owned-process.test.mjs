import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { trackOwnedProcess, createOwnedShutdown } from './owned-process.mjs';

class FakeChild extends EventEmitter {
  pid = 12345;
  exitCode = null;
  signalCode = null;
  connected = true;
  killed = false;
  killCalls = 0;
  sendCalls = 0;
  kill() { this.killed = true; this.killCalls++; this.onKill?.(); return true; }
  send(message, done) { this.sendCalls++; this.onSend?.(message); done(this.sendError); }
  exit(code = 0, signal = null) { this.exitCode = code; this.signalCode = signal; this.emit('exit', code, signal); }
}
const track = (child) => trackOwnedProcess(child, { gracefulTimeoutMs: 5, exitTimeoutMs: 5 });

test('kill acceptance and repeated timeouts retain the owned child until actual exit', async () => {
  const child = new FakeChild();
  const owned = track(child);
  const listeners = child.eventNames().map((name) => [name, child.listenerCount(name)]);
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.deepEqual(await owned.stop(), { exited: false, clean: false });
    assert.equal(child.killed, true);
    assert.equal(owned.pid, 12345);
    assert.equal(owned.running(), true);
  }
  assert.deepEqual(child.eventNames().map((name) => [name, child.listenerCount(name)]), listeners);
  child.exit(null, 'SIGTERM');
  assert.deepEqual(await owned.stop(), { exited: true, clean: false });
  assert.equal(owned.running(), false);
  assert.equal(child.killCalls, 3);
});

test('concurrent stop requests share one attempt and preserve a clean acknowledgment through a late exit', async () => {
  const child = new FakeChild();
  child.onSend = () => child.emit('message', { type: 'shutdown-complete' });
  const owned = track(child);
  const first = owned.stop(true);
  assert.equal(owned.stop(true), first);
  assert.deepEqual(await first, { exited: false, clean: false });
  assert.equal(child.sendCalls, 1);
  assert.equal(child.killCalls, 1);
  child.onKill = () => queueMicrotask(() => child.exit(null, 'SIGTERM'));
  assert.deepEqual(await owned.stop(true), { exited: true, clean: true });
  assert.equal(child.sendCalls, 1);
  assert.equal(child.killCalls, 2);
});

test('a late acknowledgment is retained for retry without repeating the graceful wait', async () => {
  const child = new FakeChild();
  const owned = track(child);
  assert.deepEqual(await owned.stop(true), { exited: false, clean: false });
  child.emit('message', { type: 'shutdown-complete' });
  child.exit();
  assert.deepEqual(await owned.stop(true), { exited: true, clean: true });
  assert.equal(child.sendCalls, 1);
});

test('exit without acknowledgment and shutdown-error both remain unclean', async () => {
  for (const message of [null, { type: 'shutdown-error' }]) {
    const child = new FakeChild();
    child.onSend = () => { if (message) child.emit('message', message); };
    child.onKill = () => queueMicrotask(() => child.exit(null, 'SIGTERM'));
    const owned = track(child);
    assert.deepEqual(await owned.stop(true), { exited: true, clean: false });
    // An out-of-order acknowledgment cannot turn an already observed exit clean.
    child.emit('message', { type: 'shutdown-complete' });
    assert.deepEqual(await owned.stop(true), { exited: true, clean: false });
  }
});

test('a kill failure on a real child does not count as exit; a failed spawn has no owned process', async () => {
  const child = new FakeChild();
  child.onKill = () => { child.emit('error', new Error('kill failed')); throw new Error('kill failed'); };
  const owned = track(child);
  assert.deepEqual(await owned.stop(), { exited: false, clean: false });
  assert.equal(owned.running(), true);
  child.onKill = () => queueMicrotask(() => child.exit());
  assert.deepEqual(await owned.stop(), { exited: true, clean: false });
  const failed = new FakeChild();
  failed.pid = undefined;
  const failedOwned = track(failed);
  failed.emit('error', new Error('spawn failed'));
  assert.deepEqual(await failedOwned.stop(), { exited: true, clean: false });
  assert.equal(failed.killCalls, 0);
});

test('failed IPC is unclean even if the child subsequently sends a success message', async () => {
  const child = new FakeChild();
  child.sendError = new Error('IPC unavailable');
  child.onSend = () => child.emit('message', { type: 'shutdown-complete' });
  child.onKill = () => queueMicrotask(() => child.exit());
  assert.deepEqual(await track(child).stop(true), { exited: true, clean: false });
});

test('shutdown retries retain ownership and both handles until late exits, then release exactly once', async () => {
  const tunnelChild = new FakeChild();
  const appChild = new FakeChild();
  let tunnel = track(tunnelChild);
  let app = track(appChild);
  let clean = false, released = 0, retries = 0, drains = 0;
  tunnelChild.onKill = () => { if (tunnelChild.killCalls === 2) queueMicrotask(() => tunnelChild.exit()); };
  appChild.onSend = () => appChild.emit('message', { type: 'shutdown-complete' });
  appChild.onKill = () => { if (appChild.killCalls === 2) queueMicrotask(() => appChild.exit()); };
  const stop = createOwnedShutdown({
    async endTunnel() {
      if (!tunnel) return;
      if (!(await tunnel.stop()).exited) throw new Error('tunnel still alive');
      tunnel = null;
    },
    async endApp() {
      if (!app) return clean;
      const result = await app.stop(true);
      if (!result.exited) throw new Error('app still alive');
      clean = result.clean; app = null; return clean;
    },
    childrenRunning: () => Boolean(tunnel?.running() || app?.running()),
    onStopping() {},
    onRetry(error, reason, attempt) {
      retries++;
      assert.equal(released, 0);
      assert.equal(reason, 'operator');
      assert.equal(attempt, retries);
      if (retries === 1) {
        assert.match(error.message, /tunnel/);
        assert.equal(tunnel.running(), true);
        assert.equal(appChild.sendCalls, 0, 'database close waits for tunnel exit');
      } else {
        assert.match(error.message, /app/);
        assert.equal(tunnel, null);
        assert.equal(app.running(), true);
      }
    },
    onStopped(result) { assert.equal(result, true); assert.equal(tunnel, null); assert.equal(app, null); },
    releaseOwnership() { assert.equal(tunnel, null); assert.equal(app, null); released++; },
    drainMs: 7, retryMs: 0,
    async wait(ms) { if (ms === 7) drains++; },
  });
  const pending = stop('operator');
  assert.equal(stop('SIGTERM'), pending);
  assert.equal(await pending, true);
  assert.equal(retries, 2);
  assert.equal(drains, 1);
  assert.equal(released, 1);
});

test('diagnostic failures cannot abandon children or release ownership before the stopped state is saved', async () => {
  let live = true, attempts = 0, stoppedWrites = 0, released = 0;
  const stop = createOwnedShutdown({
    async endTunnel() {},
    async endApp() { if (++attempts === 1) throw new Error('still alive'); live = false; return false; },
    childrenRunning: () => live,
    onStopping() { throw new Error('state unavailable'); },
    onRetry() { assert.equal(released, 0); throw new Error('logging unavailable'); },
    onStopped(clean) {
      assert.equal(clean, false);
      assert.equal(live, false);
      if (++stoppedWrites === 1) throw new Error('state unavailable');
    },
    releaseOwnership() { assert.equal(stoppedWrites, 2); released++; },
    wait: async () => {},
  });
  assert.equal(await stop('supervisor-failure'), false);
  assert.equal(released, 1);
  assert.equal(attempts, 3);
});

test('ownership remains held if a stop callback mistakenly returns while a child is alive', async () => {
  let live = true, failures = 0, released = 0;
  const stop = createOwnedShutdown({
    async endTunnel() {}, async endApp() { return false; },
    childrenRunning: () => live,
    onStopping() {},
    onRetry(error) { assert.match(error.message, /have not exited/); assert.equal(released, 0); failures++; live = false; },
    onStopped(clean) { assert.equal(clean, false); },
    releaseOwnership() { released++; }, wait: async () => {},
  });
  await stop('operator');
  assert.equal(failures, 1);
  assert.equal(released, 1);
});
