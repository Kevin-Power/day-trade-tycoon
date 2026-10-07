import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildMorningExpansion, normalizeExpansionMinute, normalizeExpansionDaily, previousFiveCloses,
  prepareMorningExpansion, MinuteCoverageError } from './prepare-morning-expansion.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function minuteFixture() {
  const dir = 'research/daily-market/2026-10-06-collection/intraday';
  const manifest = JSON.parse(readFileSync(resolve(root, dir, 'requests.json'), 'utf8'));
  const item = manifest.attempts.find(row => row.id === 'yahoo-2330-7d-1m');
  const bytes = readFileSync(resolve(root, dir, item.rawFile));
  return { bytes, request: { sha256: item.sha256, url: item.url, status: item.httpStatus, fetchedAt: item.completedAt, path: `${dir}/${item.rawFile}` } };
}
function changedMinute(mutator) {
  const { bytes, request } = minuteFixture();
  const raw = JSON.parse(bytes.toString('utf8'));
  mutator(raw.chart.result[0]);
  const changed = Buffer.from(JSON.stringify(raw));
  return { bytes: changed, request: { ...request, sha256: sha(changed) } };
}
function dailyFixture() {
  const dir = 'research/daily-market/2026-10-06-strategy-supplement/daily-prices';
  const manifest = JSON.parse(readFileSync(resolve(root, dir, 'manifest.json'), 'utf8'));
  const item = manifest.requests.find(row => row.symbol === '2330' && row.month === '2026-09');
  return { bytes: readFileSync(resolve(root, dir, item.rawFile)), request: {
    sha256: item.rawSha256, url: item.url, status: item.httpStatus, fetchedAt: item.completedAt, path: `${dir}/${item.rawFile}`,
  } };
}

test('expansion reproduces exactly one complete 450-bar lesson and refuses both observed gap dates', () => {
  const { datasets, report } = buildMorningExpansion(root);
  assert.deepEqual(report.availableDates, ['2026-10-05']);
  assert.deepEqual(report.unavailableDates, ['2026-10-02', '2026-10-07']);
  assert.equal(datasets.length, 1);
  const { dataset } = datasets[0];
  assert.equal(dataset.catalog.lessonId, 'morning-20261005-v1-bd566804b809');
  assert.equal(dataset.provenance.volumeVerified, false);
  assert.deepEqual(dataset.catalog.symbols.map(row => row.previousClose), [2500, 251, 4950, 332, 1885]);
  assert.deepEqual(dataset.catalog.symbols.map(row => row.previous5CloseMean), [2488, 251.5, 5009, 334.9, 1885]);
  assert.equal(dataset.catalog.videoUrl, null);
  assert.match(dataset.catalog.context[0].asOf, /2026-10-05.*缺資料/);
  assert.deepEqual(report.lessons[0].failedSymbols[0].issues.map(issue => issue.time), ['09:45:00', '09:51:00', '10:01:00']);
  assert.deepEqual(report.lessons[2].failedSymbols.map(row => [row.code, row.issues[0].time]), [['2330', '10:07:00'], ['2454', '09:42:00']]);
  assert.equal(prepareMorningExpansion({ root, check: true }).readyBars, 450);
});

test('all retained 10/05 timestamps and original OHLCV survive without transforms; zero volume is preserved', () => {
  const { bytes, request } = minuteFixture();
  const result = normalizeExpansionMinute(bytes, request, '2330', '2026-10-05');
  const raw = JSON.parse(bytes.toString('utf8')).chart.result[0];
  const quote = raw.indicators.quote[0];
  assert.equal(result.bars.length, 90);
  assert.equal(result.bars[0].v, 0);
  result.bars.forEach((bar, index) => {
    const at = result.audit.sourceFirstRow + index;
    assert.deepEqual(bar, { t: index * 60, o: quote.open[at], h: quote.high[at], l: quote.low[at], c: quote.close[at], v: quote.volume[at] });
  });
  assert.equal(result.audit.lastMinute, '10:29');
  assert.equal(result.audit.revealedThrough, '10:30');
});

test('minute evidence rejects changed bytes, wrong symbol, wrong currency/timezone/granularity and premature fetch', () => {
  const { bytes, request } = minuteFixture();
  assert.throws(() => normalizeExpansionMinute(Buffer.concat([bytes, Buffer.from(' ')]), request, '2330', '2026-10-05'), /SHA/);
  for (const [field, value] of [['symbol', '2317.TW'], ['currency', 'USD'], ['exchangeTimezoneName', 'UTC'], ['gmtoffset', 0], ['dataGranularity', '1d']]) {
    const changed = changedMinute(result => { result.meta[field] = value; });
    assert.throws(() => normalizeExpansionMinute(changed.bytes, changed.request, '2330', '2026-10-05'));
  }
  assert.throws(() => normalizeExpansionMinute(bytes, { ...request, fetchedAt: '2026-10-05T02:29:59Z' }, '2330', '2026-10-05'), /full lesson window/);
});

test('minute gaps, duplicate/shifted timestamps, null values and invalid OHLC cannot create a lesson', () => {
  const start = Date.parse('2026-10-05T09:00:00+08:00') / 1000;
  const mutations = [
    result => { const index = result.timestamp.indexOf(start); result.timestamp[index] += 1; },
    result => { const index = result.timestamp.indexOf(start); result.timestamp[index + 1] = start; },
    result => { const index = result.timestamp.indexOf(start); result.timestamp.splice(index, 1); for (const values of Object.values(result.indicators.quote[0])) values.splice(index, 1); },
    ...['open', 'high', 'low', 'close', 'volume'].map(key => result => { result.indicators.quote[0][key][result.timestamp.indexOf(start)] = null; }),
    result => { const index = result.timestamp.indexOf(start); result.indicators.quote[0].high[index] = 1; },
    result => { const index = result.timestamp.indexOf(start); result.indicators.quote[0].volume[index] = -1; },
  ];
  for (const mutate of mutations) {
    const changed = changedMinute(mutate);
    assert.throws(() => normalizeExpansionMinute(changed.bytes, changed.request, '2330', '2026-10-05'), MinuteCoverageError);
  }
});

test('official daily closes use named columns, correct source month/symbol and exactly five prior dates', () => {
  const { bytes, request } = dailyFixture();
  const raw = JSON.parse(bytes.toString('utf8'));
  const order = [...raw.fields.keys()].reverse();
  raw.fields = order.map(index => raw.fields[index]);
  raw.data = raw.data.map(row => order.map(index => row[index]));
  const reordered = Buffer.from(JSON.stringify(raw));
  const actual = normalizeExpansionDaily(reordered, { ...request, sha256: sha(reordered) }, '2330');
  assert.equal(actual.find(row => row.date === '2026-09-24').close, 2475);
  assert.throws(() => normalizeExpansionDaily(bytes, request, '2317'));
  raw.date = '20261001';
  const wrongMonth = Buffer.from(JSON.stringify(raw));
  assert.throws(() => normalizeExpansionDaily(wrongMonth, { ...request, sha256: sha(wrongMonth) }, '2330'));
  const reference = buildMorningExpansion(root).datasets[0].dataset.provenance.priorDailyReferences.filter(row => row.code === '2330');
  assert.deepEqual(previousFiveCloses(reference, '2330', '2026-10-05').map(row => row.date), ['2026-09-24', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.throws(() => previousFiveCloses(reference.slice(1), '2330', '2026-10-05'));
  assert.throws(() => previousFiveCloses([...reference, reference[0]], '2330', '2026-10-05'));
  assert.throws(() => previousFiveCloses(reference.map((row, index) => index === 4 ? { ...row, close: null } : row), '2330', '2026-10-05'));
  assert.equal(previousFiveCloses([...reference, { ...reference[4], date: '2026-10-05', close: 99999 }], '2330', '2026-10-05').at(-1).close, 2500);
});
