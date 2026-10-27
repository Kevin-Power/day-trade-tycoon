import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { SessionEvidence, sessionWindow, DEFAULT_SYMBOLS } from './fubon-session.mjs';

const date = '2026-10-27', w = sessionWindow(date);
const create = () => new SessionEvidence({ date, startedWall: w.prepare, startedMono: 0 });
const state = (generation = 1, status = 'connected') => ({ state: status, generation, reason: null, readOnly: true, liveOrders: false,
  rows: DEFAULT_SYMBOLS.map(symbol => ({ symbol, acknowledged: status === 'connected', tradeFresh: true, bookFresh: true, issue: null })) });
function frame(e, { wall = w.open, symbol = '2330', channel = 'trades', epoch = 1, sourceEvent = 'data',
  time = wall * 1000, sequence = Math.floor((wall - w.open) / 1000) + 10, size = sequence + 1,
  trial = false, accepted = true, acknowledged = true, rowTime = time } = {}) {
  const data = { symbol, type: 'EQUITY', exchange: 'TWSE', time, price: 100, serial: sequence, isTrial: trial,
    bids: [{ price: 99, size }], asks: [{ price: 101, size }], name: 'NEVER_PERSIST_THIS' };
  const row = { symbol, tradeTime: rowTime, bookTime: rowTime, price: 100, bids: data.bids, asks: data.asks, acknowledged, issue: null };
  e.observe({ epoch, message: { kind: 'quote', channel, sourceEvent, data }, result: accepted ? 'ACCEPTED' : 'INVALID_BOOK',
    row, wall, mono: wall - w.prepare });
}

test('REST and WS snapshots, heartbeat and trial cannot create new trades or book changes', () => {
  const e = create();
  for (let i = 0; i < 5; i++) {
    frame(e, { wall: w.open + i * 1000, channel: 'snapshot' });
    frame(e, { wall: w.open + i * 1000, sourceEvent: 'snapshot' });
    frame(e, { wall: w.open + i * 1000, channel: 'books', sourceEvent: 'snapshot' });
    frame(e, { wall: w.open + i * 1000, trial: true });
    e.observe({ message: { kind: 'heartbeat' } });
  }
  assert.equal(e.totals['2330'].newTrades, 0); assert.equal(e.totals['2330'].bookChanges, 0);
  assert.equal(e.totals['2330'].restSnapshot, 5); assert.equal(e.totals['2330'].trial, 5);
});

test('strict source advancement and book content changes; ignored or rejected data cannot count', () => {
  const e = create();
  frame(e); frame(e); // Duplicate.
  frame(e, { wall: w.open + 1000, sequence: 9 }); // Serial regression.
  frame(e, { wall: w.open + 2000, accepted: false });
  frame(e, { wall: w.open + 3000, rowTime: w.open * 1000 }); // Store ignored frame.
  frame(e, { wall: w.open + 4000 });
  assert.equal(e.totals['2330'].newTrades, 1);
  frame(e, { channel: 'books', size: 1 });
  frame(e, { channel: 'books', wall: w.open + 1000, size: 1 });
  frame(e, { channel: 'books', wall: w.open + 2000, size: 2 });
  assert.equal(e.totals['2330'].bookChanges, 1);
  assert.equal(e.totals['2330'].rejected, 1);
});

test('same-time higher trade serial counts but same-time changed book does not', () => {
  const e = create(); frame(e); frame(e, { sequence: 11 }); frame(e, { sequence: 11 });
  frame(e, { channel: 'books', size: 1 }); frame(e, { channel: 'books', size: 2 });
  assert.equal(e.totals['2330'].newTrades, 1); assert.equal(e.totals['2330'].bookChanges, 0);
});

test('source provenance unavailable is fail closed; normal incomplete ACK is warming', () => {
  const e = create(); frame(e, { sourceEvent: null }); frame(e, { acknowledged: false });
  assert.equal(e.totals['2330'].warming, 1); assert.equal(e.totals['2330'].rejected, 0);
  assert.ok(e.finish(w.stop, w.stop - w.prepare).incomplete.includes('SOURCE_EVENT_UNAVAILABLE'));
});

test('brief protocol errors are preserved without raw messages, even before the next poll', () => {
  const events = [], e = new SessionEvidence({ date, startedWall: w.prepare, startedMono: 0, emit: event => events.push(event) });
  e.observe({ epoch: 1, message: { kind: 'symbol_error', symbol: '2330', code: 'SNAPSHOT_RATE_LIMIT', secret: 'NEVER_PERSIST_THIS' }, wall: w.open, mono: 300000 });
  e.observe({ epoch: 1, message: { kind: 'fault', code: 'UNTRUSTED_SECRET' }, wall: w.open, mono: 300000 });
  assert.equal(e.protocolErrors.SNAPSHOT_RATE_LIMIT, 1); assert.equal(e.protocolErrors.UNKNOWN, 1);
  assert.ok(!JSON.stringify(events).includes('NEVER_PERSIST_THIS')); assert.ok(!JSON.stringify(events).includes('UNTRUSTED_SECRET'));
});

test('reconnect recovery needs new-generation WS data from all symbols and both channels', () => {
  const e = create(); e.inject(1, w.reconnect, w.reconnect - w.prepare);
  for (const symbol of DEFAULT_SYMBOLS) for (const channel of ['trades', 'books'])
    frame(e, { symbol, channel, epoch: 3, sourceEvent: 'snapshot', wall: w.reconnect + 1000 });
  e.sample(state(3), w.reconnect + 1000, w.reconnect + 1000 - w.prepare);
  assert.equal(e.injection.recoveredWall, undefined);
  for (const symbol of DEFAULT_SYMBOLS) for (const channel of ['trades', 'books'])
    frame(e, { symbol, channel, epoch: 3, wall: w.reconnect + 2000 });
  e.sample(state(3), w.reconnect + 2000, w.reconnect + 2000 - w.prepare);
  assert.equal(e.injection.recoveryMs, 2000); assert.equal(e.injection.newGeneration, 3);
});

function fullDay({ omitSecond = -1, omitSymbol = null } = {}) {
  const e = create();
  for (const symbol of DEFAULT_SYMBOLS) for (const channel of ['trades', 'books'])
    frame(e, { symbol, channel, wall: w.open - 1000, sourceEvent: 'snapshot' });
  for (let second = 0; second < 16200; second++) {
    if (second === omitSecond) continue;
    const wall = w.open + second * 1000, generation = wall >= w.reconnect + 2000 ? 3 : 1;
    if (wall === w.reconnect) e.inject(1, wall, wall - w.prepare);
    if (wall !== w.reconnect + 1000) for (const symbol of DEFAULT_SYMBOLS) if (symbol !== omitSymbol)
      for (const channel of ['trades', 'books']) frame(e, { wall, symbol, channel, epoch: generation });
    e.sample(state(generation, wall === w.reconnect + 1000 ? 'reconnecting' : 'connected'), wall, wall - w.prepare);
    e.flush(wall);
  }
  return e;
}

test('full window, all symbols and controlled recovery can pass; evidence has no quote values', () => {
  const e = fullDay(), summary = e.finish(w.stop, w.stop - w.prepare);
  assert.equal(summary.status, 'PASS', JSON.stringify(summary.incomplete.concat(summary.review)));
  assert.equal(summary.coveredSeconds, 16200); assert.equal(summary.coverageMinutes, 270);
  assert.equal(summary.productionUiVerified, false); assert.equal(summary.orderRequests, 0);
  const serialized = JSON.stringify([...e.minutes.values()].map(m => e.minuteRecord(m))) + JSON.stringify(summary);
  assert.ok(!serialized.includes('NEVER_PERSIST_THIS')); assert.ok(!serialized.includes('"price"')); assert.ok(!serialized.includes('"bids"'));
});

test('missing a second or a symbol cannot pass even with a long run', () => {
  const missed = fullDay({ omitSecond: 200 });
  assert.ok(missed.finish(w.stop, w.stop - w.prepare).incomplete.includes('MISSING_COVERAGE'));
  const missingSymbol = fullDay({ omitSymbol: '6488' });
  assert.ok(missingSymbol.finish(w.stop, w.stop - w.prepare).incomplete.includes('MISSING_WS_CHANGES:6488'));
});

test('late start, interruption, final clock jump and collector stall are incomplete', () => {
  const e = create(); e.startedWall = w.open + 1000;
  e.sample(state(), w.open + 1000, 0); e.sample(state(), w.open + 11000, 10000);
  const r = e.finish(w.close, 11000, 'SIGTERM');
  for (const code of ['LATE_START', 'EARLY_OR_INTERRUPTED_END', 'COLLECTION_GAP', 'CLOCK_DRIFT']) assert.ok(r.incomplete.includes(code), code);
});

test('dry run does not initialize broker and records strict policy and source hashes', () => {
  const child = spawnSync(process.execPath, ['scripts/verify-fubon-session.mjs', '--date', date, '--dry-run'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const output = JSON.parse(child.stdout); assert.equal(output.status, 'DRY_RUN_NO_CONNECTION');
  assert.equal(output.orderRequests, 0); assert.equal(output.expectedSubscriptionCount, 6);
  assert.match(output.hashes['tools/fubon-live/worker.py'], /^[a-f0-9]{64}$/);
});
