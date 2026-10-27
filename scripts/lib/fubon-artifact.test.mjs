import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifySessionArtifact } from '../verify-fubon-session-artifact.mjs';
import { sessionWindow, POLICY, DEFAULT_SYMBOLS } from './fubon-session.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const date = '2026-10-27', window = sessionWindow(date);
const stamp = value => new Date(value).toISOString();

function fixture(t, { minutes = 270, passed = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fubon-artifact-test-'));
  t.after(() => {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('fubon-artifact-test-'))
      throw new Error('Refuse cleanup outside this test temporary directory.');
    rmSync(target, { recursive: true, force: true });
  });
  const hashes = { 'offline-fixture.js': sha('offline fixture source') };
  const manifest = { schema: 1, runId: 'offline-only-run', date, window, policy: POLICY,
    hashes, symbols: DEFAULT_SYMBOLS, readOnly: true, orderRequests: 0 };
  const records = [
    { type: 'start', at: stamp(window.prepare), late: false },
    { type: 'provenance', stage: 'before_import', at: stamp(window.prepare), matching: true, hashes },
    { type: 'provenance', stage: 'before_worker_start', at: stamp(window.prepare), matching: true, hashes },
  ];
  for (let index = 0; index < minutes; index++) records.push({ type: 'minute', index,
    at: stamp(window.open + index * 60000), coveredSeconds: 60, connectedSeconds: 60,
    plannedSeconds: 0, unexpectedDisconnectedSeconds: 0, subscriptionsMin: 6, subscriptionsMax: 6,
    samples: 120, pollGapMs: 500, clockDriftMs: 0, generations: [1], states: ['connected'],
    symbols: Object.fromEntries(DEFAULT_SYMBOLS.map(symbol => [symbol, {
      counts: { wsData: 120, newTrades: 60, bookChanges: 60 }, acknowledgedSeconds: 60,
      tradeFreshSeconds: 60, bookFreshSeconds: 60, issueSeconds: 0, unexpectedUnsubscribedSeconds: 0,
    }])) });
  records.push({ type: 'provenance', stage: 'finish', at: stamp(window.stop), matching: true, hashes });
  const summary = { schema: 1, runId: manifest.runId, date, scope: 'isolated_readonly_broker_session',
    status: passed ? 'PASS' : 'INCOMPLETE', passed, readOnly: true, orderRequests: 0,
    productionUiVerified: false, startedAt: stamp(window.prepare), finishedAt: stamp(window.stop),
    durationMs: window.stop - window.prepare, reason: 'scheduled_end', policy: POLICY, provenance: hashes,
    incomplete: passed ? [] : ['MISSING_COVERAGE'], review: [], coverageMinutes: minutes,
    coveredSeconds: minutes * 60, expectedSeconds: 16200, maxPollGapMs: 500, maxClockDriftMs: 0,
    unplannedDisconnects: 0, injection: { generation: 1, newGeneration: 3, wall: window.reconnect,
      recoveredWall: window.reconnect + 10000, recoveryMs: 10000 },
    totals: Object.fromEntries(DEFAULT_SYMBOLS.map(symbol => [symbol, { newTrades: minutes * 60, bookChanges: minutes * 60 }])),
  };
  records.push({ type: 'finish', at: summary.finishedAt, status: summary.status, reason: summary.reason });
  function save() {
    let previous = '0'.repeat(64);
    const lines = records.map((record, index) => {
      const content = { sequence: index + 1, previousSha256: previous, ...record };
      previous = sha(JSON.stringify(content));
      return JSON.stringify({ ...content, sha256: previous });
    });
    summary.events = { count: records.length, finalSha256: previous };
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary));
    writeFileSync(join(directory, 'events.jsonl'), lines.join('\n') + '\n');
  }
  save();
  return { directory, manifest, summary, records, save };
}

test('complete internally consistent fixture verifies integrity and keeps production UI unverified', t => {
  const { directory } = fixture(t);
  const result = verifySessionArtifact(directory);
  assert.equal(result.integrityVerified, true, JSON.stringify(result.errors));
  assert.equal(result.recordedSessionStatus, 'PASS');
  assert.equal(result.recordedSessionPassed, true);
  assert.equal(result.productionUiVerified, false);
  assert.match(result.eventsFileSha256, /^[a-f0-9]{64}$/);
});

test('intact partial evidence verifies integrity without upgrading the recorded session result', t => {
  const { directory } = fixture(t, { minutes: 2, passed: false });
  const result = verifySessionArtifact(directory);
  assert.equal(result.integrityVerified, true, JSON.stringify(result.errors));
  assert.equal(result.recordedSessionStatus, 'INCOMPLETE');
  assert.equal(result.recordedSessionPassed, false);
});

test('editing one saved event without updating its chain is detected', t => {
  const { directory } = fixture(t);
  const path = join(directory, 'events.jsonl'), lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  const event = JSON.parse(lines[3]); event.coveredSeconds = 59; lines[3] = JSON.stringify(event);
  writeFileSync(path, lines.join('\n') + '\n');
  const result = verifySessionArtifact(directory);
  assert.equal(result.integrityVerified, false);
  assert.ok(result.errors.includes('CHAIN:4'));
});

test('a missing final newline is treated as incomplete persisted evidence', t => {
  const { directory } = fixture(t), path = join(directory, 'events.jsonl');
  writeFileSync(path, readFileSync(path, 'utf8').trimEnd());
  const result = verifySessionArtifact(directory);
  assert.equal(result.integrityVerified, false);
  assert.ok(result.errors.includes('INCOMPLETE_LAST_LINE'));
});

test('a truncated JSON event fails closed through the command line', t => {
  const { directory } = fixture(t), path = join(directory, 'events.jsonl');
  writeFileSync(path, readFileSync(path, 'utf8').slice(0, -20));
  const child = spawnSync(process.execPath, ['scripts/verify-fubon-session-artifact.mjs', directory], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.deepEqual(JSON.parse(child.stderr), { integrityVerified: false, errors: ['MISSING_OR_INVALID_ARTIFACT'] });
});

test('missing summary fails closed without inventing a session result', t => {
  const { directory } = fixture(t);
  rmSync(join(directory, 'summary.json'));
  const child = spawnSync(process.execPath, ['scripts/verify-fubon-session-artifact.mjs', directory], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.deepEqual(JSON.parse(child.stderr), { integrityVerified: false, errors: ['MISSING_OR_INVALID_ARTIFACT'] });
});

test('a self-consistent hash chain cannot validate PASS with missing trading minutes', t => {
  const { directory } = fixture(t, { minutes: 269, passed: true });
  const result = verifySessionArtifact(directory);
  assert.equal(result.integrityVerified, false);
  assert.ok(result.errors.includes('PASS_WITH_MISSING_COVERAGE'));
});

test('unparseable run timestamps cannot validate PASS even when the finish event agrees', t => {
  const f = fixture(t);
  f.summary.startedAt = 'invalid-start'; f.summary.finishedAt = 'invalid-finish';
  f.records.at(-1).at = f.summary.finishedAt; f.save();
  const result = verifySessionArtifact(f.directory);
  assert.equal(result.integrityVerified, false);
  assert.ok(result.errors.includes('PASS_WITH_INCOMPLETE_WINDOW'));
});

test('string values cannot stand in for boolean passed and read-only invariants', t => {
  const f = fixture(t);
  f.summary.passed = 'true'; f.summary.readOnly = 'false'; f.save();
  assert.equal(verifySessionArtifact(f.directory).integrityVerified, false);
});
