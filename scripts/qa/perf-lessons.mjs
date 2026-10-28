// Load run of the daily lessons (Task 17): a class of practisers on one classroom (a built release on PGlite, loopback
// only), all behind the same client address, each advancing a minute about every second ("2×") for a fixed time.
//   1. size probes: one practiser plays a whole morning (90 minutes) with the day's default list and another with
//      80 stocks; every step's reply is measured (raw, gzip level 6, brotli quality 5 — the server sends none of
//      its own) together with the GET snapshots at 1, 30, 60 and 90 and the picker read.
//   2. load: N practisers (default 30), requests OVERLAPPING in time (a request is sent while others are still being
//      answered): "spread" gives every practiser its own random phase within the second, "burst" sends all of them within a few
//      milliseconds of each other every 1.1 s. Each practiser advances, now and then sends a market order, and reads
//      once as a page refresh would. Latency is measured at the client, from sending to the whole body; the server's
//      RSS and heap are read every second through the runner's `memory` message.
// Standard (Task 17): p95 < 300 ms for the advances, and no 429 and no 5xx.
// Usage: node scripts/qa/perf-lessons.mjs --release <abs .output/server/index.mjs> --data <market-data folder | fixture>
//          [--lesson 2026-10-27] [--port 18903] [--users 30] [--seconds 30] [--modes spread,burst] [--no-probe] [--out <folder>]
// `--data fixture` writes the QA fixture to a temp folder; any other folder is only read by the app (use a scratch copy
// of real data, see real-day-check.mjs).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { writeMarketFixture } from './make-market-fixture.mjs';
import { startClassroom } from './lessons-server.mjs';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument ${arg}`);
    const key = arg.slice(2);
    if (key === 'no-probe') out[key] = true;
    else out[key] = argv[++index];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
if (!args.release || !args.data) throw new Error('Usage: --release <abs entry> --data <folder|fixture> [--lesson 2026-10-27] [--port 18903] [--users 30] [--seconds 30] [--modes uniform,burst] [--no-probe] [--out <folder>]');
const users = Number(args.users ?? 30);
const seconds = Number(args.seconds ?? 30);
const modes = (args.modes ?? 'spread,burst').split(',').filter(Boolean);
const wait = ms => new Promise(done => setTimeout(done, ms));
const sleepUntil = at => wait(Math.max(0, at - performance.now()));
const STANDARD_P95_MS = 300;

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
const round = (value, digits = 1) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const stats = values => ({
  n: values.length, min: round(Math.min(...values)), p50: round(percentile(values, 50)), p90: round(percentile(values, 90)),
  p95: round(percentile(values, 95)), p99: round(percentile(values, 99)), max: round(Math.max(...values)),
  mean: round(values.reduce((sum, value) => sum + value, 0) / (values.length || 1)),
});
const sizeOf = raw => ({
  raw: raw.length,
  gzip: gzipSync(raw, { level: 6 }).length,
  brotli: brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length,
});
const kb = bytes => (bytes / 1024).toFixed(1) + ' KB';

const dataFolder = args.data === 'fixture' ? await mkdtemp(join(tmpdir(), 'perf-lessons-data-')) : resolve(args.data);
if (args.data === 'fixture') await writeMarketFixture(dataFolder);
const classroom = await startClassroom({ entry: args.release, marketData: dataFolder, port: Number(args.port ?? 18903), label: 'perf-lessons' });
const report = { when: new Date().toISOString(), data: args.data === 'fixture' ? 'QA fixture' : args.data, users, seconds, modes, node: process.version };
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
let exitCode = 0;

try {
  // ── Setup: the members, the picker (cold and warm) ─────────────────────────────────────────────────────────────
  const baseline = await classroom.memory();
  const jars = await classroom.members(users + 2);
  const queryOf = date => (date ? `?lesson=fubon-${date.replaceAll('-', '')}-am` : '');
  const query = queryOf(args.lesson);
  const coldGet = await classroom.request('/api/morning' + query, { jar: jars[users] });
  if (coldGet.status !== 200 || !coldGet.body?.picker) throw new Error(`The picker read answered ${coldGet.status}`);
  const warmGet = await classroom.request('/api/morning' + query, { jar: jars[users + 1] });
  const picker = coldGet.body.picker;
  const defaults = picker.defaults;
  const maxList = [...picker.symbols].sort((a, b) => (b.previousValue ?? -1) - (a.previousValue ?? -1) || (a.code < b.code ? -1 : 1)).slice(0, 80).map(symbol => symbol.code);
  report.day = { lesson: picker.lessonId, stocksOffered: picker.symbols.length, defaults: defaults.length, maxList: maxList.length, books: picker.booksAvailable, taiex: picker.taiexAvailable };
  report.picker = { cold: { ms: round(coldGet.ms), ...sizeOf(coldGet.raw) }, warm: { ms: round(warmGet.ms), ...sizeOf(warmGet.raw) } };
  console.log(`picker read: cold ${round(coldGet.ms)} ms, warm ${round(warmGet.ms)} ms, ${kb(coldGet.raw.length)} raw / ${kb(report.picker.cold.gzip)} gzip / ${kb(report.picker.cold.brotli)} brotli`);

  const planOf = focusCode => ({ exerciseId: 'first-order', bias: 'observe', focusCode, reason: '壓力測試', entry: '依腳本', stop: '依腳本' });
  const startRun = async (jar, codes) => {
    const reply = await classroom.request('/api/morning' + query, { method: 'POST', jar, data: { action: 'start', requestId: randomUUID(), plan: planOf(codes[0]), codes } });
    if (reply.status !== 200) throw new Error(`start answered ${reply.status}: ${reply.text.slice(0, 200)}`);
    return reply;
  };

  // ── 1. Size probes: a whole morning each, with orders now and then ─────────────────────────────────────────────
  async function probe(name, jar, codes) {
    const steps = [];
    const snapshots = [];
    const began = await startRun(jar, codes);
    let state = began.body.state;
    const focus = codes[0];
    const startMs = began.ms;
    const snapshot = async at => {
      const reply = await classroom.request('/api/morning' + query, { jar });
      snapshots.push({ cursor: at, status: reply.status, ms: round(reply.ms), ...sizeOf(reply.raw) });
    };
    let side = 'buy';
    for (let cursor = 1; cursor <= 90; cursor += 1) {
      await wait(Math.max(0, state.nextAdvanceAt - Date.now()) + 15);
      const reply = await classroom.request('/api/morning' + query, { method: 'POST', jar,
        data: { action: 'advance', id: state.id, expectedRevision: state.revision, requestId: randomUUID(), view: focus } });
      if (reply.status !== 200) throw new Error(`probe ${name}: advance ${cursor} answered ${reply.status} ${reply.text.slice(0, 120)}`);
      state = reply.body.state;
      steps.push({ cursor, ms: round(reply.ms), ttfb: round(reply.firstByteMs), trades: Object.values(reply.body.delta.trades).reduce((sum, rows) => sum + rows.length, 0), ...sizeOf(reply.raw) });
      if ([1, 30, 60].includes(cursor)) await snapshot(cursor);
      if (cursor % 20 === 5 && cursor < 90) {
        const order = await classroom.request('/api/morning' + query, { method: 'POST', jar,
          data: { action: 'order', id: state.id, expectedRevision: state.revision, requestId: randomUUID(), code: focus, side, lots: 1 } });
        if (order.status === 200) { state = order.body.state; side = side === 'buy' ? 'sell' : 'buy'; }
        steps.at(-1).orderMs = round(order.ms);
      }
    }
    await snapshot(90);
    const atEnd = snapshots.at(-1);
    const finished = await classroom.request('/api/morning' + query, { method: 'POST', jar,
      data: { action: 'finish', id: state.id, expectedRevision: state.revision, requestId: randomUUID(), reflection: '壓力測試完成' } });
    const after = await classroom.request('/api/morning' + query, { jar });
    const summary = {
      stocks: codes.length, startMs: round(startMs),
      steps: { count: steps.length, ms: stats(steps.map(step => step.ms)), ttfbMs: stats(steps.map(step => step.ttfb)) },
      worstStep: steps.reduce((worst, step) => (step.raw > worst.raw ? step : worst), steps[0]),
      medianStepBytes: { raw: percentile(steps.map(step => step.raw), 50), gzip: percentile(steps.map(step => step.gzip), 50), brotli: percentile(steps.map(step => step.brotli), 50) },
      tradesPerStepMax: Math.max(...steps.map(step => step.trades)),
      snapshots, getAtCursor90: atEnd,
      finish: { status: finished.status, ms: round(finished.ms) },
      getAfterFinish: { ms: round(after.ms), ...sizeOf(after.raw) },
    };
    console.log(`probe ${name} (${codes.length} stocks): step ms p50 ${summary.steps.ms.p50} / p95 ${summary.steps.ms.p95} / max ${summary.steps.ms.max}; worst step ${kb(summary.worstStep.raw)} raw ${kb(summary.worstStep.gzip)} gzip ${kb(summary.worstStep.brotli)} br; ` +
      `GET at 90: ${kb(atEnd.raw)} raw ${kb(atEnd.gzip)} gzip ${kb(atEnd.brotli)} br in ${atEnd.ms} ms`);
    return { summary, steps };
  }
  if (!args['no-probe']) {
    const [defaultProbe, maxProbe] = await Promise.all([probe('default list', jars[users], defaults), probe('80 stocks', jars[users + 1], maxList)]);
    report.probes = { defaultList: defaultProbe.summary, eightyStocks: maxProbe.summary };
    report.probeSteps = { defaultList: defaultProbe.steps, eightyStocks: maxProbe.steps };
  }

  // ── 2. Load ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async function load(mode) {
    // Runs of the previous mode are given up, then everybody starts a new one at once.
    await Promise.all(jars.slice(0, users).map(async jar => {
      const open = await classroom.request('/api/morning' + query, { jar });
      if (open.body?.state && !open.body.state.completed) {
        await classroom.request('/api/morning' + query, { method: 'POST', jar, data: { action: 'abandon', id: open.body.state.id, expectedRevision: open.body.state.revision, requestId: randomUUID() } });
      }
    }));
    const startTimes = [];
    const runs = await Promise.all(jars.slice(0, users).map(async (jar, index) => {
      const codes = [...defaults.slice(index % defaults.length), ...defaults.slice(0, index % defaults.length)];
      const reply = await startRun(jar, codes);
      startTimes.push(reply.ms);
      return { jar, state: reply.body.state, focus: codes[0], user: index, side: 'buy', phase: Math.random() * 1100 };
    }));
    const memory = [await classroom.memory()];
    const records = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const overlapAtSend = [];
    const timed = async (run, kind, path, init) => {
      overlapAtSend.push(inFlight);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const sent = performance.now();
      try {
        const reply = await classroom.request(path, { jar: run.jar, ...init });
        records.push({ mode, kind, user: run.user, at: sent - loadStart, ms: reply.ms, ttfb: reply.firstByteMs, status: reply.status, bytes: reply.raw.length, message: reply.status >= 400 ? (reply.body?.message ?? '') : undefined });
        return reply;
      } catch (error) {
        records.push({ mode, kind, user: run.user, at: sent - loadStart, ms: performance.now() - sent, status: 0, bytes: 0, message: String(error?.message ?? error) });
        return null;
      } finally { inFlight -= 1; }
    };
    const T0 = performance.now() + 1500;
    const loadStart = T0;
    const stop = T0 + seconds * 1000;
    const period = 1100;
    const sampler = (async () => {
      while (performance.now() < stop + 500) {
        await wait(1000);
        try { memory.push(await classroom.memory()); } catch { /* the next sample */ }
      }
    })();
    const cpuBefore = memory[0].cpuMicros;
    const wallBefore = Date.now();
    await Promise.all(runs.map(async run => {
      const slotOf = k => T0 + (mode === 'burst' ? k * period + (run.user % 5) * 3 : run.phase + k * period);
      let step = 0;
      let refreshed = false;
      for (;;) {
        const slot = mode === 'burst' ? slotOf(step) : null;
        if (mode === 'burst') await sleepUntil(slot); else if (step === 0) await sleepUntil(slotOf(0));
        if (performance.now() >= stop) break;
        const query1 = '/api/morning' + query;
        const reply = await timed(run, 'advance', query1, { method: 'POST', data: { action: 'advance', id: run.state.id, expectedRevision: run.state.revision, requestId: randomUUID(), view: run.focus } });
        if (reply?.status === 200) {
          run.state = reply.body.state;
          step += 1;
          if (step % 8 === 3 && run.state.cursor < 89) {
            const order = await timed(run, 'order', query1, { method: 'POST', data: { action: 'order', id: run.state.id, expectedRevision: run.state.revision, requestId: randomUUID(), code: run.focus, side: run.side, lots: 1 } });
            if (order?.status === 200) { run.state = order.body.state; run.side = run.side === 'buy' ? 'sell' : 'buy'; }
          }
          if (!refreshed && performance.now() - T0 > (seconds * 1000) / 2) {
            refreshed = true;
            await timed(run, 'get', query1, {});
          }
        } else {
          // Not part of the plan (a refused advance): read the run again and go on.
          const read = await timed(run, 'resync', query1, {});
          if (read?.status === 200 && read.body?.state) run.state = read.body.state;
          step += 1;
        }
        if (performance.now() >= stop) break;
        if (mode !== 'burst') await wait(1000 + 10 + Math.random() * 25);
      }
    }));
    await sampler;
    const cpuAfter = (await classroom.memory()).cpuMicros;
    const wallMs = Date.now() - wallBefore;
    const byKind = kind => records.filter(record => record.kind === kind);
    const advances = byKind('advance');
    const ok = advances.filter(record => record.status === 200);
    const statuses = {};
    for (const record of records) statuses[record.status] = (statuses[record.status] ?? 0) + 1;
    const rate429 = records.filter(record => record.status === 429);
    const fiveXX = records.filter(record => record.status >= 500 || record.status === 0);
    const rss = memory.map(sample => sample.rss);
    const heap = memory.map(sample => sample.heapUsed);
    const summary = {
      mode, practisers: users, seconds, requests: records.length,
      advance: { ...stats(ok.map(record => record.ms)), ttfbP95: round(percentile(ok.map(record => record.ttfb), 95)), answered: ok.length, notOk: advances.length - ok.length },
      order: byKind('order').length ? stats(byKind('order').map(record => record.ms)) : null,
      get: byKind('get').length ? stats(byKind('get').map(record => record.ms)) : null,
      all: stats(records.map(record => record.ms)),
      start: { ...stats(startTimes), note: 'everybody starts at once, the day\'s data already read' },
      statuses, rateLimited429: rate429.length, rateLimited429Messages: [...new Set(rate429.map(record => record.message))], serverErrors: fiveXX.length, serverErrorMessages: [...new Set(fiveXX.map(record => record.message))],
      overlap: { maxInFlight, meanInFlightAtSend: round(overlapAtSend.reduce((sum, value) => sum + value, 0) / overlapAtSend.length, 2), shareSentWithAnotherInFlight: round(overlapAtSend.filter(value => value > 0).length / overlapAtSend.length, 3) },
      requestsPerSecond: round(records.length / (wallMs / 1000)),
      bytesPerAdvanceMedian: percentile(ok.map(record => record.bytes), 50),
      server: {
        rssMB: { start: round(baseline.rss / 1048576), before: round(rss[0] / 1048576), peak: round(Math.max(...rss) / 1048576), end: round(rss.at(-1) / 1048576) },
        heapUsedMB: { before: round(heap[0] / 1048576), peak: round(Math.max(...heap) / 1048576), end: round(heap.at(-1) / 1048576) },
        heapTotalMB: round(Math.max(...memory.map(sample => sample.heapTotal)) / 1048576), heapLimitMB: round(memory[0].heapLimit / 1048576),
        externalMB: round(Math.max(...memory.map(sample => sample.external)) / 1048576),
        cpuPercentOfOneCore: round(((cpuAfter - cpuBefore) / 1000 / wallMs) * 100),
      },
    };
    console.log(`\n[${mode}] ${users} practisers x ${seconds} s: ${records.length} requests, max ${maxInFlight} in flight`);
    console.log(`  advance ms  p50 ${summary.advance.p50}  p90 ${summary.advance.p90}  p95 ${summary.advance.p95}  p99 ${summary.advance.p99}  max ${summary.advance.max}  (${summary.advance.answered} answered, ${summary.advance.notOk} not)`);
    console.log(`  all     ms  p50 ${summary.all.p50}  p95 ${summary.all.p95}  max ${summary.all.max};  statuses ${JSON.stringify(statuses)}`);
    console.log(`  start   ms  p50 ${summary.start.p50}  p95 ${summary.start.p95}  max ${summary.start.max}`);
    console.log(`  server RSS ${summary.server.rssMB.before} -> peak ${summary.server.rssMB.peak} MB, heap used ${summary.server.heapUsedMB.before} -> peak ${summary.server.heapUsedMB.peak} MB (limit ${summary.server.heapLimitMB}), CPU ${summary.server.cpuPercentOfOneCore}% of one core`);
    return { summary, records };
  }
  report.load = {};
  const allRecords = {};
  for (const mode of modes) {
    const { summary, records } = await load(mode);
    report.load[mode] = summary;
    allRecords[mode] = records;
  }
  report.generator = { eventLoopDelayMs: { p99: round(loopDelay.percentile(99) / 1e6), max: round(loopDelay.max / 1e6) } };
  const verdicts = [];
  for (const [mode, summary] of Object.entries(report.load)) {
    verdicts.push([`${mode}: advance p95 ${summary.advance.p95} ms < ${STANDARD_P95_MS} ms`, summary.advance.p95 < STANDARD_P95_MS]);
    verdicts.push([`${mode}: no 429 (${summary.rateLimited429})`, summary.rateLimited429 === 0]);
    verdicts.push([`${mode}: no 5xx or dropped request (${summary.serverErrors})`, summary.serverErrors === 0]);
    verdicts.push([`${mode}: every advance answered 200 (${summary.advance.notOk} not)`, summary.advance.notOk === 0]);
  }
  report.verdicts = verdicts.map(([what, ok]) => ({ what, ok }));
  console.log('\n' + verdicts.map(([what, ok]) => `${ok ? 'PASS' : 'FAIL'}  ${what}`).join('\n'));
  if (verdicts.some(([, ok]) => !ok)) exitCode = 1;
  report.serverLogTail = classroom.logs().split('\n').filter(line => /error|warn|fail/i.test(line)).slice(-10);
  if (args.out) {
    await mkdir(resolve(args.out), { recursive: true });
    const name = args.label ?? (args.data === 'fixture' ? 'fixture' : 'real');
    await writeFile(join(resolve(args.out), `perf-${name}.json`), JSON.stringify(report, null, 1));
    await writeFile(join(resolve(args.out), `perf-${name}-requests.json`), JSON.stringify(allRecords));
  }
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  loopDelay.disable();
  await classroom.stop();
  if (args.data === 'fixture' && resolve(dataFolder).startsWith(resolve(tmpdir()) + sep)) await rm(dataFolder, { recursive: true, force: true });
}
process.exit(exitCode);
