import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const intradayRoot = path.dirname(root);
const rawDir = path.join(root, 'raw');
await mkdir(rawDir, { recursive: true });
if ((await readdir(rawDir)).length) throw new Error('Existing cross-check evidence found; do not overwrite.');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const frozenFiles = ['normalized/2026-10-06/bars.json', 'normalized/2026-10-06/manifest.json', 'normalized/2026-10-05/bars.json', 'normalized/2026-10-05/manifest.json'];
const beforeHashes = Object.fromEntries(await Promise.all(frozenFiles.map(async file => [file, sha256(await readFile(path.join(intradayRoot, file)))])));
const minuteBars = JSON.parse(await readFile(path.join(intradayRoot, frozenFiles[0]), 'utf8'));
const reports = [];
for (const symbol of ['2330', '2317', '2454', '2382', '2308']) {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20261001&stockNo=${symbol}`;
  const record = { symbol, source: 'TWSE STOCK_DAY', requestedMonth: '2026-10', targetDate: '2026-10-06', url, method: 'GET', authentication: 'none', startedAt: new Date().toISOString() };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    const raw = Buffer.from(await response.arrayBuffer());
    const rawFile = `raw/twse-STOCK_DAY-202610-${symbol}.response`;
    await writeFile(path.join(root, rawFile), raw);
    Object.assign(record, { completedAt: new Date().toISOString(), httpStatus: response.status, responseUrl: response.url, contentType: response.headers.get('content-type'), rawFile, rawBytes: raw.length, rawSha256: sha256(raw) });
    const payload = JSON.parse(raw.toString('utf8'));
    Object.assign(record, { apiStatus: payload.stat, title: payload.title, fields: payload.fields, notes: payload.notes ?? null });
    if (response.status !== 200 || payload.stat !== 'OK') throw new Error('Official daily response not OK');
    const dateIndex = payload.fields.indexOf('日期');
    const row = payload.data.find(row => row[dateIndex] === '115/10/06');
    if (!row) throw new Error('Official 2026-10-06 daily row not available in response');
    record.officialRawRow = row;
    const number = field => {
      const index = payload.fields.indexOf(field);
      if (index < 0) throw new Error(`Official field missing: ${field}`);
      const value = Number(String(row[index]).replaceAll(',', ''));
      if (!Number.isFinite(value)) throw new Error(`Official value not numeric: ${field}`);
      return value;
    };
    const daily = { open: number('開盤價'), high: number('最高價'), low: number('最低價'), close: number('收盤價'), tradingVolumeShares: number('成交股數') };
    const bars = minuteBars.filter(bar => bar.symbol === symbol);
    const first = bars.find(bar => bar.timestampTaipei === '2026-10-06T09:00:00.000+08:00');
    if (bars.length !== 60 || !first) throw new Error('Expected 60 bars and 09:00 source minute not present');
    const outsideRange = bars.flatMap(bar => ['open', 'high', 'low', 'close'].flatMap(field => bar[field] < daily.low - 1e-7 || bar[field] > daily.high + 1e-7 ? [{ timestampTaipei: bar.timestampTaipei, field, value: bar[field], officialLow: daily.low, officialHigh: daily.high }] : []));
    Object.assign(record, { officialDaily: daily, minuteWindow: { startInclusive: '2026-10-06T09:00:00+08:00', endExclusive: '2026-10-06T10:00:00+08:00', bars: bars.length }, observedMinuteLow: Math.min(...bars.map(bar => bar.low)), observedMinuteHigh: Math.max(...bars.map(bar => bar.high)), comparedPriceValues: bars.length * 4, allMinuteOhlcWithinOfficialDailyRange: outsideRange.length === 0, outsideRange, yahoo0900Open: first.open, openingPriceDifference: first.open - daily.open, openingPriceEqualWithinFloatTolerance: Math.abs(first.open - daily.open) <= 1e-7, floatTolerance: 1e-7, yahoo0900Volume: first.volume, result: outsideRange.length === 0 ? 'price-range-consistent' : 'price-range-discrepancy', volumeCompletenessVerified: false });
  } catch (error) { Object.assign(record, { checkError: error.message, result: 'unverified' }); }
  reports.push(record);
  console.log(JSON.stringify({ symbol, httpStatus: record.httpStatus, result: record.result, officialDaily: record.officialDaily, openDifference: record.openingPriceDifference, outOfRange: record.outsideRange?.length, error: record.checkError }));
}
const afterHashes = Object.fromEntries(await Promise.all(frozenFiles.map(async file => [file, sha256(await readFile(path.join(intradayRoot, file)))])));
const unchanged = frozenFiles.every(file => beforeHashes[file] === afterHashes[file]);
const report = {
  generatedAt: new Date().toISOString(), targetDate: '2026-10-06', timezone: 'Asia/Taipei',
  officialSourcePage: 'https://www.twse.com.tw/zh/trading/historical/stock-day.html',
  scope: 'Independent daily price-envelope and opening-price cross-check of the five previously collected Yahoo minute series only.',
  frozenInputsUnchanged: unchanged, frozenInputSha256Before: beforeHashes, frozenInputSha256After: afterHashes,
  completedSymbols: reports.filter(r => !r.checkError).length,
  allPriceRangesConsistent: reports.length === 5 && reports.every(r => r.allMinuteOhlcWithinOfficialDailyRange),
  allOpeningPricesMatch: reports.length === 5 && reports.every(r => r.openingPriceEqualWithinFloatTolerance),
  interpretation: [
    'Minute aggregation and vendor sampling do not guarantee the 09:00 minute opening equals the exchange opening-auction price. Report the observed difference without altering either source.',
    'A pass only establishes the sampled OHLC values lie within the official daily range and the observed opening comparison. It cannot verify minute trade sequence, exact execution, minute volume, or tick completeness.',
    'The zero-volume 09:00 bars remain an unresolved source-quality caveat. Daily total volume is retained for provenance, not used to impute missing intraday volume.',
    'Daily high/low are end-of-day evidence for quality checking only. Do not reveal them during a 09:00-10:00 replay or treat them as known then.',
  ], reports,
};
await writeFile(path.join(root, 'twse-2026-10-06-report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (!unchanged) throw new Error('Frozen input changed during cross-check');
console.log(JSON.stringify({ completedSymbols: report.completedSymbols, allPriceRangesConsistent: report.allPriceRangesConsistent, allOpeningPricesMatch: report.allOpeningPricesMatch, frozenInputsUnchanged: unchanged }));
