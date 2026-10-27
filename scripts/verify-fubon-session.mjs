// Run manually/by the thread heartbeat only. No scheduler, order API, browser
// authentication or production process is modified by this collector.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, appendFileSync, fsyncSync, closeSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { SessionEvidence, sessionWindow, DEFAULT_SYMBOLS, POLICY } from './lib/fubon-session.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = data => createHash('sha256').update(data).digest('hex');
const delay = ms => new Promise(done => setTimeout(done, ms));
const options = parseArgs({ options: { date: { type: 'string', default: '2026-10-27' },
  live: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
  output: { type: 'string' }, 'stop-at': { type: 'string', default: '13:35' }, help: { type: 'boolean', default: false } } }).values;

async function main() {
  if (options.help) {
    console.log('node --experimental-strip-types scripts/verify-fubon-session.mjs --date 2026-10-27 --dry-run\n' +
      'node --experimental-strip-types scripts/verify-fubon-session.mjs --date 2026-10-27 --live [--output artifacts/fubon-session] [--stop-at 13:35]');
    return;
  }
  const window = sessionWindow(options.date);
  if (!/^\d{2}:\d{2}$/.test(options['stop-at'])) throw new Error('INVALID_STOP_TIME');
  const stopAt = Date.parse(`${options.date}T${options['stop-at']}:00+08:00`);
  if (!Number.isFinite(stopAt) || stopAt <= window.open || stopAt > window.stop) throw new Error('STOP_TIME_OUT_OF_RANGE');
  const service = join(homedir(), 'YilutekServices/DayTradeTycoon');
  const config = { enabled: true, verification: true,
    python: join(service, 'fetcher/.venv/Scripts/python.exe'), worker: join(root, 'tools/fubon-live/worker.py'),
    credentials: join(homedir(), '.fubon/credentials.local.py') };
  const sourceFiles = ['scripts/verify-fubon-session.mjs', 'scripts/lib/fubon-session.mjs',
    'src/lib/broker/fubon-feed.server.ts', 'src/lib/broker/fubon-feed.ts', 'tools/fubon-live/worker.py',
    'tools/fubon-daily/fubon_daily/credentials.py', 'package-lock.json'];
  const hashes = Object.fromEntries(sourceFiles.map(file => [file, sha(readFileSync(join(root, file)))]));
  const workerText = readFileSync(config.worker, 'utf8');
  if (!workerText.includes('sourceEvent=event')) throw new Error('SOURCE_EVENT_UNAVAILABLE');
  let productionReference = { available: false };
  try {
    const hosting = JSON.parse(readFileSync(join(service, 'hosting.json'), 'utf8'));
    const entry = resolve(service, hosting.appEntry), worker = join(dirname(entry), 'fubon-live/worker.py');
    const content = readFileSync(worker, 'utf8'), normalize = text => text.replaceAll('\r\n', '\n');
    productionReference = { available: true, appEntry: entry, worker, workerSha256: sha(content),
      workspaceWorkerSha256: hashes['tools/fubon-live/worker.py'],
      differsOnlyBySourceEvent: normalize(workerText.replace(', sourceEvent=event', '')) === normalize(content),
      identical: normalize(workerText) === normalize(content) };
  } catch { /* No credentials/config values or exception details are recorded. */ }
  const preparation = { schema: 1, readOnly: true, orderRequests: 0, date: options.date, symbols: DEFAULT_SYMBOLS,
    window, stopAt, policy: POLICY, hashes, productionReference,
    setup: { pythonExists: existsSync(config.python), workerExists: existsSync(config.worker), credentialFileExists: existsSync(config.credentials) },
    scope: 'isolated_readonly_broker_session', productionUiVerified: false,
    plannedReconnect: '10:30 Asia/Taipei, one own-worker socket disconnect, latest start 10:35',
    rawMarketDataSaved: false, expectedSubscriptionCount: DEFAULT_SYMBOLS.length * 2,
    pollingMs: 500, latencyMeaning: 'source timestamp age, not exchange-to-client latency with synchronized clock proof',
    sourceEventRequired: true, noTickLossClaim: true };
  if (!options.live || options['dry-run']) { console.log(JSON.stringify({ ...preparation, status: 'DRY_RUN_NO_CONNECTION' }, null, 2)); return; }
  const now = Date.now();
  // Refuse a wrong date or unattended multi-day wait. A late start is allowed
  // solely to gather partial evidence, and can never receive full-day PASS.
  if (now < window.prepare - 5 * 60000 || now >= stopAt) throw new Error('OUTSIDE_APPROVED_SESSION_WINDOW');
  if (Object.values(preparation.setup).some(value => !value)) throw new Error('LOCAL_SETUP_REQUIRED');
  if (!productionReference.available || (!productionReference.identical && !productionReference.differsOnlyBySourceEvent)) throw new Error('PRODUCTION_WORKER_PROVENANCE_MISMATCH');
  const locks = join(root, 'artifacts/fubon-session'); mkdirSync(locks, { recursive: true });
  const lockPath = join(locks, `${options.date}.active.json`), runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const lock = { runId, pid: process.pid, date: options.date, createdAt: new Date().toISOString() };
  try { writeFileSync(lockPath, JSON.stringify(lock), { flag: 'wx' }); }
  catch { throw new Error('SESSION_LOCK_EXISTS_INSPECT_BEFORE_RETRY'); }
  let feed, fd, evidence, abortReason = null, eventHash = '0'.repeat(64), eventCount = 0;
  let resultDirectory;
  const requestStop = signal => { abortReason = signal; };
  process.once('SIGINT', () => requestStop('SIGINT')); process.once('SIGTERM', () => requestStop('SIGTERM'));
  try {
    const outputBase = resolve(options.output ?? locks); mkdirSync(outputBase, { recursive: true });
    resultDirectory = join(outputBase, `${options.date}-${runId}`);
    mkdirSync(resultDirectory, { recursive: false });
    fd = openSync(join(resultDirectory, 'events.jsonl'), 'wx');
    const emit = event => {
      const content = { sequence: ++eventCount, previousSha256: eventHash, ...event };
      eventHash = sha(JSON.stringify(content)); appendFileSync(fd, JSON.stringify({ ...content, sha256: eventHash }) + '\n');
      if (['minute', 'injection', 'recovery', 'finish'].includes(event.type)) fsyncSync(fd);
    };
    writeFileSync(join(resultDirectory, 'manifest.json'), JSON.stringify({ ...preparation, runId,
      pid: process.pid, nodeVersion: process.version, createdAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ status: 'PREPARED', runId, pid: process.pid, directory: resultDirectory }));
    while (!abortReason && Date.now() < window.prepare) await delay(500);
    const startedWall = Date.now(), startedMono = performance.now();
    evidence = new SessionEvidence({ date: options.date, startedWall, startedMono, emit });
    emit({ type: 'start', at: new Date(startedWall).toISOString(), late: startedWall > window.open });
    const verifySources = stage => {
      const observed = Object.fromEntries(sourceFiles.map(file => [file, sha(readFileSync(join(root, file)))]));
      const matching = sourceFiles.every(file => observed[file] === hashes[file]);
      emit({ type: 'provenance', stage, at: new Date().toISOString(), matching, hashes: observed });
      if (!matching) { evidence.errors.add('SOURCE_CHANGED_DURING_RUN'); abortReason = 'SOURCE_CHANGED_DURING_RUN'; }
      return matching;
    };
    verifySources('before_import');
    if (!abortReason) {
      const { FubonFeed } = await import('../src/lib/broker/fubon-feed.server.ts');
      feed = new FubonFeed(config);
      // Local verification hooks preserve the original implementation and
      // inspect its return value and resulting row; no production debug route.
      if (typeof feed.message !== 'function' || typeof feed.store?.receive !== 'function') throw new Error('VERIFICATION_HOOK_UNAVAILABLE');
      const originalStart = feed.start.bind(feed);
      feed.start = () => { if (verifySources('before_worker_start')) originalStart(); };
      let received = null;
      const originalReceive = feed.store.receive.bind(feed.store);
      feed.store.receive = (epoch, channel, input, wall) => {
        const result = originalReceive(epoch, channel, input, wall); received = { epoch, channel, input, result }; return result;
      };
      const originalMessage = feed.message.bind(feed);
      feed.message = (epoch, message) => {
        received = null; originalMessage(epoch, message);
        try {
          const wall = Date.now();
          if (message.kind !== 'quote') evidence.observe({ epoch, message, wall, mono: performance.now() });
          else if (received && received.epoch === epoch && received.input === message.data) {
            const row = feed.store.view([message.data.symbol], wall, feed.state === 'connected')[0];
            evidence.observe({ epoch, message, result: received.result, row, wall, mono: performance.now() });
          }
        } catch { abortReason = 'OBSERVER_ERROR'; }
      };
      const client = randomUUID(), deadline = startedMono + Math.max(0, stopAt - startedWall) + 10000;
      while (!abortReason && Date.now() < stopAt && performance.now() < deadline) {
        const wall = Date.now(), mono = performance.now(), state = feed.touch(client, DEFAULT_SYMBOLS, wall);
        state.subscriptionCount = feed.store.active.size;
        evidence.sample(state, wall, mono); evidence.flush(wall);
        if (state.state === 'stopped') { abortReason = 'FEED_STOPPED'; break; }
        if (evidence.canInject(state, wall)) {
          if (!feed.child?.stdin?.writable) { abortReason = 'INJECTION_PIPE_UNAVAILABLE'; break; }
          evidence.inject(state.generation, wall, mono);
          feed.child.stdin.write(JSON.stringify({ verifyDisconnect: true }) + '\n', error => { if (error) abortReason = 'INJECTION_WRITE_FAILED'; });
        }
        await delay(500);
      }
      if (!abortReason && performance.now() >= deadline && Date.now() < stopAt) abortReason = 'MONOTONIC_DEADLINE';
    }
    const reason = abortReason ?? (stopAt < window.stop ? 'requested_partial_end' : 'scheduled_end');
    verifySources('finish');
    const summary = evidence.finish(Date.now(), performance.now(), reason);
    emit({ type: 'finish', at: summary.finishedAt, status: summary.status, reason });
    fsyncSync(fd);
    writeFileSync(join(resultDirectory, 'summary.json'), JSON.stringify({ ...summary, runId,
      events: { count: eventCount, finalSha256: eventHash }, provenance: preparation.hashes, productionReference }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ status: summary.status, passed: summary.passed, directory: resultDirectory,
      incomplete: summary.incomplete, review: summary.review }));
    process.exitCode = summary.passed ? 0 : 2;
  } catch (error) {
    if (resultDirectory) writeFileSync(join(resultDirectory, 'aborted.json'), JSON.stringify({ status: 'INCOMPLETE',
      at: new Date().toISOString(), code: /^[A-Z_]+$/.test(error?.message) ? error.message : 'COLLECTOR_EXCEPTION',
      readOnly: true, passed: false }), { flag: 'wx' });
    throw new Error('COLLECTOR_INCOMPLETE_SEE_ARTIFACTS');
  } finally {
    feed?.close(); if (fd !== undefined) closeSync(fd);
    // Never remove another process's lock, or automatically erase a crash lock.
    if (existsSync(lockPath) && JSON.parse(readFileSync(lockPath, 'utf8')).runId === runId) unlinkSync(lockPath);
  }
}
main().catch(error => { console.error(JSON.stringify({ status: 'INCOMPLETE', passed: false,
  code: /^[A-Z_]+$/.test(error?.message) ? error.message : 'INVALID_ARGUMENT_OR_SETUP' })); process.exitCode = 2; });
