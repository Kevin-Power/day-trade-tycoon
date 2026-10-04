const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A successful kill request is not an exit acknowledgment. Retain the actual
// ChildProcess and its database acknowledgment across stop attempts.
export function trackOwnedProcess(child, { gracefulTimeoutMs = 30000, exitTimeoutMs = 5000 } = {}) {
  let exited = child.exitCode != null || child.signalCode != null;
  let spawnFailed = false;
  let shutdownRequested = false;
  let shutdownComplete = false;
  let shutdownFailed = false;
  let gracefulWaited = false;
  let pendingStop = null;
  const observers = new Set();
  const running = () => !exited && !spawnFailed;
  const notify = () => { for (const observer of observers) observer(); };
  child.on('exit', () => { exited = true; notify(); });
  child.on('error', () => {
    // A failed spawn has no process to stop. An error on a real child (including
    // a failed kill or IPC write) must never be mistaken for process exit.
    if (child.pid == null) spawnFailed = true;
    notify();
  });
  child.on('message', (message) => {
    if (!shutdownRequested || exited) return;
    if (message?.type === 'shutdown-complete') shutdownComplete = true;
    if (message?.type === 'shutdown-error') shutdownFailed = true;
    notify();
  });
  function waitUntil(predicate, timeoutMs) {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => { clearTimeout(timer); observers.delete(check); resolve(); };
      const check = () => { if (predicate()) finish(); };
      const timer = setTimeout(finish, timeoutMs);
      observers.add(check);
      check();
    });
  }
  async function attemptStop(graceful) {
    if (running() && graceful && !shutdownRequested) {
      shutdownRequested = true;
      if (child.connected) {
        try {
          child.send({ type: 'shutdown' }, (error) => {
            if (error) { shutdownFailed = true; notify(); }
          });
        } catch { shutdownFailed = true; }
      } else shutdownFailed = true;
    }
    if (running() && graceful && !gracefulWaited) {
      gracefulWaited = true;
      await waitUntil(() => !running() || shutdownComplete || shutdownFailed, gracefulTimeoutMs);
    }
    if (running()) {
      try { child.kill(); } catch { return { exited: false, clean: false }; }
      await waitUntil(() => !running(), exitTimeoutMs);
    }
    return { exited: !running(), clean: !running() && shutdownComplete && !shutdownFailed };
  }
  return {
    get pid() { return child.pid; },
    running,
    stop(graceful = false) {
      if (!pendingStop) pendingStop = attemptStop(graceful).finally(() => { pendingStop = null; });
      return pendingStop;
    },
  };
}

// This controller deliberately remains alive with its ownership lease when an
// owned child has not exited. A later attempt can observe a late exit and finish.
export function createOwnedShutdown({ endTunnel, endApp, childrenRunning, onStopping, onRetry, onStopped, releaseOwnership, drainMs = 1000, retryMs = 1000, wait = sleep }) {
  let pendingStop = null;
  async function reportRetry(error, reason, attempt) {
    // Diagnostic I/O failure must not interrupt child cleanup or free the lease.
    try { await onRetry(error, reason, attempt); } catch { /* Keep ownership and retry. */ }
  }
  async function shutdown(reason) {
    let attempt = 0;
    let drained = false;
    try { await onStopping(reason); } catch (error) { await reportRetry(error, reason, attempt); }
    for (;;) {
      attempt++;
      try {
        await endTunnel();
        if (!drained) { await wait(drainMs); drained = true; }
        const clean = await endApp();
        if (childrenRunning()) throw new Error('Owned children have not exited.');
        await onStopped(clean, reason);
        await releaseOwnership();
        return clean;
      } catch (error) {
        await reportRetry(error, reason, attempt);
        await wait(retryMs);
      }
    }
  }
  return (reason) => {
    if (!pendingStop) pendingStop = shutdown(reason);
    return pendingStop;
  };
}
