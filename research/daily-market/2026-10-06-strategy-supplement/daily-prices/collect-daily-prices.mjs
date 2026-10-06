import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const previousRoot = path.resolve(root, '../../2026-10-06-collection/intraday/cross-check');
const previousReport = JSON.parse(await readFile(path.join(previousRoot, 'twse-2026-10-06-report.json'), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const rawRoot = path.join(root, 'raw');
await mkdir(rawRoot, { recursive: true });
if ((await readdir(rawRoot)).length) throw new Error('Existing evidence found. Refusing to overwrite collection.');
const symbols = ['2330', '2317', '2454', '2382', '2308'];
const cutoff = '2026-10-05';
const requests = [];
const results = [];
const records = [];
const originalHashes = {};
const toDate = value => {
  const match = /^(\d{3})\/(\d{2})\/(\d{2})$/.exec(value);
  if (!match) throw new Error(`Unexpected TWSE date: ${value}`);
  return `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
};
for (const symbol of symbols) {
  const former = previousReport.reports.find(report => report.symbol === symbol);
  const formerPath = path.join(previousRoot, former.rawFile);
  const octoberBytes = await readFile(formerPath);
  if (sha256(octoberBytes) !== former.rawSha256) throw new Error(`Original October hash mismatch: ${symbol}`);
  originalHashes[formerPath] = former.rawSha256;
  const octoberFile = `raw/twse-STOCK_DAY-202610-${symbol}.response`;
  await writeFile(path.join(root, octoberFile), octoberBytes, { flag: 'wx' });
  const copiedRecord = { symbol, month: '2026-10', operation: 'copy-existing-snapshot', url: former.url, originalRetrievedAt: former.completedAt, originalHttpStatus: former.httpStatus, originalFile: path.relative(root, formerPath).replaceAll('\\', '/'), rawFile: octoberFile, rawBytes: octoberBytes.length, rawSha256: sha256(octoberBytes), copiedAt: new Date().toISOString() };
  requests.push(copiedRecord);
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20260901&stockNo=${symbol}`;
  const request = { symbol, month: '2026-09', operation: 'GET', url, authentication: 'none', startedAt: new Date().toISOString() };
  requests.push(request);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const septemberFile = `raw/twse-STOCK_DAY-202609-${symbol}.response`;
    await writeFile(path.join(root, septemberFile), bytes, { flag: 'wx' });
    Object.assign(request, { completedAt: new Date().toISOString(), httpStatus: response.status, responseUrl: response.url, rawFile: septemberFile, rawBytes: bytes.length, rawSha256: sha256(bytes) });
    const months = [{ content: JSON.parse(bytes.toString('utf8')), source: request }, { content: JSON.parse(octoberBytes.toString('utf8')), source: copiedRecord }];
    const parsed = [];
    for (const { content, source } of months) {
      if (content.stat !== 'OK') throw new Error(`Official response not OK for ${symbol}/${source.month}: ${content.stat}`);
      const dateIndex = content.fields.indexOf('日期');
      if (dateIndex < 0) throw new Error('TWSE date field missing');
      for (const [sourceRowIndex, row] of content.data.entries()) {
        const date = toDate(row[dateIndex]);
        const number = field => {
          const index = content.fields.indexOf(field);
          if (index < 0) throw new Error(`TWSE field missing: ${field}`);
          const value = Number(String(row[index]).replaceAll(',', ''));
          if (!Number.isFinite(value)) throw new Error(`TWSE non-numeric field ${field}/${date}`);
          return value;
        };
        if (date > cutoff) continue;
        parsed.push({ date, symbol, timezone: 'Asia/Taipei', granularity: '1d', source: 'TWSE STOCK_DAY', priceBasis: 'unadjusted official daily price as returned', open: number('開盤價'), high: number('最高價'), low: number('最低價'), close: number('收盤價'), tradingVolumeShares: number('成交股數'), tradingValueTwd: number('成交金額'), sourceUrl: source.url, sourceRawFile: source.rawFile, sourceRawSha256: source.rawSha256, sourceRowIndex });
      }
    }
    parsed.sort((a, b) => a.date.localeCompare(b.date));
    const dates = parsed.map(row => row.date);
    if (new Set(dates).size !== dates.length) throw new Error(`Duplicate dates for ${symbol}`);
    const selected = parsed.slice(-5);
    if (selected.length !== 5 || selected.at(-1).date !== cutoff) throw new Error(`Five completed dates ending ${cutoff} unavailable for ${symbol}`);
    const invalid = selected.filter(row => row.low > Math.min(row.open, row.close) || row.high < Math.max(row.open, row.close) || row.low > row.high || Math.min(row.low, row.open, row.high, row.close) <= 0 || row.tradingVolumeShares < 0);
    if (invalid.length) throw new Error(`Invalid daily price envelope for ${symbol}`);
    records.push(...selected);
    const outputFile = `${symbol}-daily-prices-through-2026-10-05.json`;
    const outputBytes = Buffer.from(`${JSON.stringify(selected, null, 2)}\n`);
    await writeFile(path.join(root, outputFile), outputBytes, { flag: 'wx' });
    results.push({ symbol, availableCompleteDatesThroughCutoff: parsed.length, selectedDates: selected.map(row => row.date), selectedRows: selected.length, outputFile, outputSha256: sha256(outputBytes), priceEnvelopeValid: true });
    console.log(JSON.stringify(results.at(-1)));
  } catch (error) {
    Object.assign(request, { error: error.message });
    results.push({ symbol, error: error.message });
    console.log(JSON.stringify(results.at(-1)));
  }
}
const sourceUnchanged = (await Promise.all(Object.entries(originalHashes).map(async ([file, expected]) => sha256(await readFile(file)) === expected))).every(Boolean);
const dates = results[0]?.selectedDates ?? [];
const sameFiveDates = results.length === 5 && results.every(result => JSON.stringify(result.selectedDates) === JSON.stringify(dates));
const combinedBytes = Buffer.from(`${JSON.stringify(records, null, 2)}\n`);
await writeFile(path.join(root, 'daily-prices-through-2026-10-05.json'), combinedBytes, { flag: 'wx' });
const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'official-daily-prices-collected-sma-definition-pending', cutoffDateInclusive: cutoff, timezone: 'Asia/Taipei', symbols, selectedDates: dates, totalRows: records.length, sameFiveDatesForAllSymbols: sameFiveDates, originalOctoberSnapshotsUnchanged: sourceUnchanged, smaCalculated: false, teacherSmaDefinitionConfirmed: false, scope: 'Official completed daily OHLCV input only. No claim about whether the teacher SMA5 includes an incomplete current daily candle, uses adjusted prices, or uses a specific vendor calculation.', excludedAfterCutoff: '2026-10-06 rows can remain in copied October raw snapshots as source evidence, but are excluded from every normalized output.', combinedFile: 'daily-prices-through-2026-10-05.json', combinedSha256: sha256(combinedBytes), requests, results };
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ totalRows: records.length, selectedDates: dates, sameFiveDates, sourceUnchanged, smaCalculated: false }));
if (!sameFiveDates || !sourceUnchanged || records.length !== 25) process.exitCode = 1;
