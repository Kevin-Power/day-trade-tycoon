import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareRawMinuteSeries, verifyMorningSource } from './verify-morning-source.mjs';

test('all 450 served minute bars match original retained Yahoo quotes and timestamps', () => {
  const report = verifyMorningSource();
  assert.equal(report.bars, 450);
  assert.equal(report.ohlcComparisons, 1800);
  assert.equal(report.timeComparisons, 450);
  assert.equal(report.differences, 0);
  assert.ok(report.reports.every(item => item.zeroVolumeBars === 1 && item.dailyCorroboration.openingMatches));
});

test('raw minute comparison rejects time shifts, missing or interpolated bars, price transforms and wrong ticker', () => {
  const dataset = JSON.parse(readFileSync(new URL('../server/data/morning-2026-10-06.json', import.meta.url), 'utf8'));
  const raw = JSON.parse(readFileSync(new URL('../research/daily-market/2026-10-06-collection/intraday/raw/yahoo-2330-7d-1m.response', import.meta.url), 'utf8'));
  const pristine = dataset.bars['2330'];
  const reject = (mutate, pattern) => {
    const bars = structuredClone(pristine);
    mutate(bars);
    assert.throws(() => compareRawMinuteSeries('2330', bars, raw), pattern);
  };
  reject(bars => { bars[0].t += 60; }, /time differs/);
  reject(bars => { bars.pop(); }, /90 server minutes/);
  reject(bars => { bars[1].c = (bars[0].c + bars[2].c) / 2 + .01; }, /close differs/);
  for (const field of ['o', 'h', 'l', 'c']) reject(bars => { bars[30][field] += .01; }, /differs from original Yahoo quote/);
  reject(bars => { bars[0].v = 1; }, /volume differs/);
  const missingRaw = structuredClone(raw);
  const firstIndex = missingRaw.chart.result[0].timestamp.indexOf(Date.parse('2026-10-06T09:00:00+08:00') / 1000);
  missingRaw.chart.result[0].indicators.quote[0].open[firstIndex] = null;
  assert.throws(() => compareRawMinuteSeries('2330', pristine, missingRaw), /missing raw open/);
  const shiftedRaw = structuredClone(raw);
  shiftedRaw.chart.result[0].timestamp[firstIndex + 1] += 1;
  assert.throws(() => compareRawMinuteSeries('2330', pristine, shiftedRaw), /consecutive and unique/);
  const wrongSymbol = structuredClone(raw);
  wrongSymbol.chart.result[0].meta.symbol = '2317.TW';
  assert.throws(() => compareRawMinuteSeries('2330', pristine, wrongSymbol), /vendor symbol/);
  // Adjusted-close content is deliberately ignored: only the raw quote fields are authoritative here.
  const adjusted = structuredClone(raw);
  adjusted.chart.result[0].indicators.adjclose = [{ adjclose: pristine.map(() => 1) }];
  assert.equal(compareRawMinuteSeries('2330', pristine, adjusted).differences, 0);
});
