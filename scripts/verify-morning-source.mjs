import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supplement = 'research/daily-market/2026-10-06-strategy-supplement';
const intraday = 'research/daily-market/2026-10-06-collection/intraday';
const expectedCodes = ['2330', '2317', '2454', '2382', '2308'];
const start = Date.parse('2026-10-06T09:00:00+08:00') / 1000;
const end = Date.parse('2026-10-06T10:30:00+08:00') / 1000;
const fieldPairs = [['o', 'open'], ['h', 'high'], ['l', 'low'], ['c', 'close'], ['v', 'volume']];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Compare the served values directly to vendor quote arrays, without using an intermediate OHLC file. */
export function compareRawMinuteSeries(code, served, raw) {
  const result = raw.chart?.result?.[0];
  assert.ok(result && !raw.chart.error, `${code}: missing Yahoo chart result`);
  assert.equal(result.meta.symbol, `${code}.TW`, `${code}: vendor symbol`);
  assert.equal(result.meta.exchangeTimezoneName, 'Asia/Taipei', `${code}: timezone`);
  assert.equal(result.meta.gmtoffset, 28800, `${code}: UTC offset`);
  assert.equal(result.meta.dataGranularity, '1m', `${code}: minute granularity`);
  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0];
  assert.ok(Array.isArray(timestamps) && quote, `${code}: missing timestamp or quote arrays`);
  for (const [, field] of fieldPairs) assert.equal(quote[field]?.length, timestamps.length, `${code}: ${field} length`);
  const selected = timestamps.flatMap((timestamp, index) => timestamp >= start && timestamp < end ? [{ timestamp, index }] : []);
  assert.equal(selected.length, 90, `${code}: exactly 90 retained vendor minutes`);
  assert.equal(served?.length, 90, `${code}: exactly 90 server minutes`);
  let zeroVolumeBars = 0;
  for (let minute = 0; minute < 90; minute++) {
    const { timestamp, index } = selected[minute];
    assert.equal(timestamp, start + minute * 60, `${code}: original minute ${minute} is consecutive and unique`);
    assert.deepEqual(Object.keys(served[minute]).sort(), ['t', 'o', 'h', 'l', 'c', 'v'].sort(), `${code}: unexpected bar fields`);
    assert.equal(served[minute].t, timestamp - start, `${code}: minute ${minute} time differs from Yahoo timestamp`);
    for (const [target, field] of fieldPairs) {
      const value = quote[field][index];
      assert.ok(Number.isFinite(value), `${code}: minute ${minute} missing raw ${field}; never interpolate`);
      assert.ok(target === 'v' ? value >= 0 : value > 0, `${code}: minute ${minute} invalid raw ${field}`);
      assert.equal(served[minute][target], value, `${code}: minute ${minute} ${field} differs from original Yahoo quote`);
    }
    const { o, h, l, c, v } = served[minute];
    assert.ok(l <= Math.min(o, c) && h >= Math.max(o, c) && l <= h, `${code}: invalid original OHLC relationship`);
    if (v === 0) zeroVolumeBars++;
  }
  return { symbol: code, bars: 90, firstMinute: '09:00', lastMinute: '10:29', firstCompletedAt: '09:01', lastCompletedAt: '10:30',
    timeComparisons: 90, ohlcComparisons: 360, volumeComparisons: 90, differences: 0, zeroVolumeBars };
}

export function verifyMorningSource(root = workspace) {
  const read = path => readFileSync(resolve(root, path));
  const json = path => JSON.parse(read(path).toString('utf8'));
  const dataset = json('server/data/morning-2026-10-06.json');
  const manifest = json(supplement + '/replay-manifest.json');
  const requests = json(intraday + '/requests.json');
  assert.equal(dataset.catalog.date, '2026-10-06');
  assert.equal(dataset.catalog.maxCursor, 90);
  assert.deepEqual(dataset.catalog.symbols.map(symbol => symbol.code), expectedCodes);
  assert.deepEqual(Object.keys(dataset.bars).sort(), [...expectedCodes].sort());
  assert.equal(dataset.provenance.volumeVerified, false, 'Minute volume remains unverified');
  const retainedFile = supplement + '/bars-2026-10-06-0900-1030.json';
  assert.equal(digest(read(retainedFile)), manifest.sha256, 'Intermediate source evidence hash');
  assert.equal(dataset.provenance.minuteSourceSha256, manifest.sha256, 'Server evidence hash');
  assert.ok(dataset.catalog.lessonId.endsWith(manifest.sha256.slice(0, 12)), 'Lesson version must pin the source hash');
  // This is a narrow guard on the real preparation script, in addition to exact value comparisons.
  const preparation = read('scripts/prepare-morning-data.mjs').toString('utf8');
  assert.doesNotMatch(preparation, /\b(?:roundToTick|clampLimit|projectStock|interpolate\w*)\s*\(/i, 'No tick rounding, projected path or OHLC interpolation in preparation');
  assert.doesNotMatch(preparation, /\badjclose\b|\badjustedClose\b/, 'Do not substitute adjusted close for raw minute OHLC');
  const reports = [];
  for (const code of expectedCodes) {
    const report = manifest.reports.find(item => item.symbol === code);
    const request = requests.attempts.find(item => item.id === `yahoo-${code}-7d-1m`);
    assert.ok(report && request, `${code}: retained request evidence`);
    assert.equal(request.httpStatus, 200);
    const rawFile = resolve(root, intraday, 'raw', `yahoo-${code}-7d-1m.response`);
    const expectedRoot = resolve(root, intraday, 'raw');
    const rel = relative(expectedRoot, rawFile);
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Vendor evidence path stays in raw directory');
    assert.equal(resolve(root, supplement, report.rawFile), rawFile, `${code}: manifest vendor path`);
    assert.equal(resolve(root, intraday, request.rawFile), rawFile, `${code}: request vendor path`);
    const rawBytes = readFileSync(rawFile);
    const rawHash = digest(rawBytes);
    assert.equal(rawHash, report.rawSha256, `${code}: vendor bytes match replay manifest`);
    assert.equal(rawHash, request.sha256, `${code}: vendor bytes match original request record`);
    const comparison = compareRawMinuteSeries(code, dataset.bars[code], JSON.parse(rawBytes.toString('utf8')));
    const officialBytes = read(`${intraday}/cross-check/raw/twse-STOCK_DAY-202610-${code}.response`);
    assert.equal(digest(officialBytes), report.officialDailyCheckSha256, `${code}: retained daily corroboration hash`);
    const official = JSON.parse(officialBytes.toString('utf8'));
    assert.equal(official.stat, 'OK');
    const daily = official.data.find(row => row[0] === '115/10/06');
    assert.ok(daily, `${code}: daily corroboration exists`);
    const number = name => Number(String(daily[official.fields.indexOf(name)]).replaceAll(',', ''));
    const opening = number('開盤價'), low = number('最低價'), high = number('最高價');
    assert.ok([opening, low, high].every(Number.isFinite));
    const insideDailyRange = dataset.bars[code].every(bar => [bar.o, bar.h, bar.l, bar.c].every(value => value >= low && value <= high));
    assert.equal(insideDailyRange, true, `${code}: minute prices fall within the official DAILY range`);
    reports.push({ ...comparison, originalSha256: rawHash, dailyCorroboration: {
      openingMatches: dataset.bars[code][0].o === opening, pricesInsideDailyRange: insideDailyRange,
      scope: 'Daily opening and daily price envelope only; does not independently verify minute OHLC or tick sequence.',
    } });
  }
  return { ok: true, lessonId: dataset.catalog.lessonId, bars: 450, ohlcComparisons: 1800, timeComparisons: 450,
    volumeComparisons: 450, differences: 0, networkRequests: 0, writes: 0,
    comparison: 'Server t/O/H/L/C/V directly against retained Yahoo timestamp and indicators.quote arrays; no adjusted close or price transformation.',
    limits: 'Vendor-source equality only. TWSE daily corroboration does not validate each minute; zero opening-minute volume, volume units and actual tick order remain unverified.', reports };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2, 'Usage: node scripts/verify-morning-source.mjs');
    console.log(JSON.stringify(verifyMorningSource(), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
