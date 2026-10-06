import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const requests = JSON.parse(await readFile(path.join(root, 'requests.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const symbols = ['2330', '2317', '2454', '2382', '2308'];
const fields = ['open', 'high', 'low', 'close', 'volume'];
const localIso = seconds => new Date((seconds + 28800) * 1000).toISOString().replace('Z', '+08:00');
const sources = [];
for (const symbol of symbols) {
  const request = requests.attempts.find(r => r.id === `yahoo-${symbol}-7d-1m`);
  if (!request || request.httpStatus !== 200) throw new Error(`Missing successful request for ${symbol}`);
  const raw = await readFile(path.join(root, request.rawFile));
  if (hash(raw) !== request.sha256) throw new Error(`Raw checksum mismatch for ${symbol}`);
  const result = JSON.parse(raw.toString('utf8')).chart.result[0];
  if (result.meta.exchangeTimezoneName !== 'Asia/Taipei' || result.meta.gmtoffset !== 28800 || result.meta.dataGranularity !== '1m') throw new Error(`Unexpected clock or interval for ${symbol}`);
  const quote = result.indicators.quote[0];
  for (const field of fields) if (quote[field].length !== result.timestamp.length) throw new Error(`Array mismatch ${symbol}/${field}`);
  sources.push({ symbol, request, result, quote });
}

const overview = [];
for (const date of ['2026-10-06', '2026-10-05']) {
  const start = Date.parse(`${date}T09:00:00+08:00`) / 1000;
  const end = Date.parse(`${date}T10:00:00+08:00`) / 1000;
  const destination = path.join(root, 'normalized', date);
  await mkdir(destination, { recursive: true });
  const allRows = [];
  const reports = [];
  for (const { symbol, request, result, quote } of sources) {
    const rows = result.timestamp.flatMap((t, i) => t >= start && t < end ? [{
      date, symbol, yahooSymbol: `${symbol}.TW`, source: 'Yahoo Finance',
      granularity: '1m', timezone: 'Asia/Taipei', intervalSeconds: 60,
      timestampUnixSeconds: t, timestampUtc: new Date(t * 1000).toISOString(),
      timestampTaipei: localIso(t),
      intervalEndUtc: new Date((t + 60) * 1000).toISOString(),
      replayAvailableAt: new Date((t + 60) * 1000).toISOString(),
      replayAvailableAtTaipei: localIso(t + 60),
      ...Object.fromEntries(fields.map(field => [field, quote[field][i]])),
      sourceRowIndex: i,
    }] : []);
    const timestamps = rows.map(r => r.timestampUnixSeconds);
    const expected = Array.from({ length: 60 }, (_, i) => start + i * 60);
    const missing = expected.filter(t => !timestamps.includes(t));
    const duplicates = timestamps.filter((t, i) => timestamps.indexOf(t) !== i);
    const offGrid = timestamps.filter(t => (t - start) % 60 !== 0);
    const nullOrNonFinite = rows.filter(r => fields.some(k => !Number.isFinite(r[k]))).map(r => r.timestampTaipei);
    const invalidPriceEnvelopes = rows.filter(r => [r.open, r.high, r.low, r.close].every(Number.isFinite) && (r.low > Math.min(r.open, r.close) || r.high < Math.max(r.open, r.close) || r.high < r.low || Math.min(r.open, r.high, r.low, r.close) <= 0)).map(r => r.timestampTaipei);
    const negativeVolumes = rows.filter(r => Number.isFinite(r.volume) && r.volume < 0).map(r => r.timestampTaipei);
    const zeroVolumes = rows.filter(r => r.volume === 0).map(r => r.timestampTaipei);
    const nonAscending = rows.some((r, i) => i > 0 && rows[i - 1].timestampUnixSeconds >= r.timestampUnixSeconds);
    const passed = rows.length === 60 && !missing.length && !duplicates.length && !offGrid.length && !nullOrNonFinite.length && !invalidPriceEnvelopes.length && !negativeVolumes.length && !nonAscending;
    const csvFields = ['date', 'symbol', 'yahooSymbol', 'source', 'granularity', 'timezone', 'intervalSeconds', 'timestampUnixSeconds', 'timestampUtc', 'timestampTaipei', 'intervalEndUtc', 'replayAvailableAt', 'replayAvailableAtTaipei', ...fields, 'sourceRowIndex'];
    const csv = `${csvFields.join(',')}\n${rows.map(r => csvFields.map(f => r[f] ?? '').join(',')).join('\n')}\n`;
    const csvName = `${symbol}-1m-0900-1000.csv`;
    await writeFile(path.join(destination, csvName), csv);
    allRows.push(...rows);
    reports.push({ symbol, sourceUrl: request.url, retrievedAt: request.completedAt, rawFile: request.rawFile, rawSha256: request.sha256, csvFile: csvName, csvSha256: hash(Buffer.from(csv)), providerRows: result.timestamp.length, selectedRows: rows.length, firstTimestamp: rows[0]?.timestampTaipei, lastTimestamp: rows.at(-1)?.timestampTaipei, lastReplayAvailableAt: rows.at(-1)?.replayAvailableAtTaipei, excluded1000BarPresent: result.timestamp.includes(end), missingMinuteTimestamps: missing.map(localIso), duplicateTimestamps: duplicates.map(localIso), offGridTimestamps: offGrid.map(localIso), nullOrNonFinite, invalidPriceEnvelopes, negativeVolumes, zeroVolumeTimestamps: zeroVolumes, nonAscending, structuralValidationPassed: passed, volumeQuality: zeroVolumes.length ? 'zero-volume-bars-present-unverified' : 'provider-native-unit-unverified' });
  }
  const jsonBytes = Buffer.from(`${JSON.stringify(allRows, null, 2)}\n`);
  await writeFile(path.join(destination, 'bars.json'), jsonBytes);
  const manifest = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), date,
    status: 'research-collected-not-approved-for-public-course',
    candidateMeaning: '技術驗證用候選，非波哥推薦、非投資建議',
    source: 'Yahoo Finance public chart response', timeframe: '1m OHLCV, not tick data',
    primaryDate: date === '2026-10-06', timezone: 'Asia/Taipei', utcOffsetSeconds: 28800,
    window: { startInclusive: `${date}T09:00:00+08:00`, endExclusive: `${date}T10:00:00+08:00`, expectedBarsPerSymbol: 60, timestampRule: 'Select source timestamps >= 09:00 and < 10:00; do not include the source 10:00 bar.' },
    revealRule: { sourceTimestampInterpretation: 'one-minute bucket label, treated as interval start for replay', minimumDelaySeconds: 60, field: 'replayAvailableAt', meaning: 'Conservative bar-completion gate: source timestamp + 60 seconds. Actual historical publication/arrival time is not supplied or verified; this is not a zero-latency guarantee. Never reveal the full OHLC before this gate.' },
    dataHandling: { interpolation: false, forwardFill: false, priceRounding: false, ohlcPathInvented: false, volumeUnit: 'provider-native; not independently verified', zeroVolumes: 'preserved and flagged; not corrected or interpreted as no trading', rights: 'Commercial classroom display, redistribution and long-term storage rights not confirmed; do not deploy this research set.' },
    allStructuralChecksPassed: reports.every(x => x.structuralValidationPassed), totalBars: allRows.length,
    combinedJson: 'bars.json', combinedJsonSha256: hash(jsonBytes), symbols: reports,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(destination, 'manifest.json'), manifestBytes);
  overview.push({ date, primary: manifest.primaryDate, totalBars: allRows.length, passed: manifest.allStructuralChecksPassed, manifest: `normalized/${date}/manifest.json`, manifestSha256: hash(manifestBytes), zeroVolumes: reports.map(r => ({ symbol: r.symbol, timestamps: r.zeroVolumeTimestamps })) });
}
await writeFile(path.join(root, 'normalized-summary.json'), `${JSON.stringify(overview, null, 2)}\n`);
console.log(JSON.stringify(overview, null, 2));
