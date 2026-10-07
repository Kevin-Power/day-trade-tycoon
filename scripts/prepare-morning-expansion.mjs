import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preservedLessonSha256 = '71b5294b2f484708e7506506688195eeb0e07c346d68c2feb9fe22797df4490a';
export const expansionDirectory = 'research/daily-market/2026-10-07-morning-expansion';
export const expansionDates = ['2026-10-02', '2026-10-05', '2026-10-07'];
export const expansionCodes = ['2330', '2317', '2454', '2382', '2308'];
const names = { '2330': '台積電', '2317': '鴻海', '2454': '聯發科', '2382': '廣達', '2308': '台達電' };
const previousDates = {
  '2026-10-02': ['2026-09-23', '2026-09-24', '2026-09-29', '2026-09-30', '2026-10-01'],
  '2026-10-05': ['2026-09-24', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'],
  '2026-10-07': ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'],
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (root, path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const localTime = stamp => new Date(stamp * 1000 + 28_800_000).toISOString().slice(11, 19);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function evidenceBytes(root, path, sha256) {
  assert.match(sha256, /^[a-f0-9]{64}$/);
  const actualRoot = realpathSync(root);
  const actualPath = realpathSync(resolve(root, path));
  const inside = relative(actualRoot, actualPath);
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), 'Evidence must stay in the repository');
  const bytes = readFileSync(actualPath);
  assert.equal(digest(bytes), sha256, `Retained source hash mismatch: ${path}`);
  return bytes;
}
export class MinuteCoverageError extends Error {
  constructor(issues) { super('The five-stock lesson is unavailable until all original minute bars are complete'); this.issues = issues; }
}

/** Original vendor timestamp + quote arrays only. Null is not a price or a zero volume. */
export function normalizeExpansionMinute(bytes, request, code, date) {
  assert.ok(validDate(date));
  assert.equal(digest(bytes), request.sha256, 'Minute raw SHA-256');
  assert.equal(request.status, 200, 'Minute source HTTP status');
  const url = new URL(request.url);
  assert.equal(url.protocol, 'https:');
  assert.ok(['query1.finance.yahoo.com', 'query2.finance.yahoo.com'].includes(url.hostname));
  assert.equal(url.username + url.password + url.hash, '');
  assert.equal(decodeURIComponent(url.pathname), `/v8/finance/chart/${code}.TW`);
  assert.equal(url.searchParams.get('interval'), '1m');
  const start = Date.parse(`${date}T09:00:00+08:00`) / 1000;
  const end = start + 90 * 60;
  assert.ok(Date.parse(request.fetchedAt) >= end * 1000, 'Minute source must be collected after the full lesson window');
  const raw = JSON.parse(bytes.toString('utf8'));
  assert.equal(raw.chart?.error, null);
  assert.equal(raw.chart?.result?.length, 1);
  const result = raw.chart.result[0];
  assert.equal(result.meta?.symbol, `${code}.TW`);
  assert.equal(result.meta?.currency, 'TWD');
  assert.equal(result.meta?.exchangeTimezoneName, 'Asia/Taipei');
  assert.equal(result.meta?.gmtoffset, 28_800);
  assert.equal(result.meta?.dataGranularity, '1m');
  const stamps = result.timestamp;
  const quote = result.indicators?.quote?.[0];
  assert.ok(Array.isArray(stamps) && quote);
  assert.ok(stamps.every(stamp => Number.isSafeInteger(stamp) && stamp > 0));
  for (const key of ['open', 'high', 'low', 'close', 'volume']) assert.equal(quote[key]?.length, stamps.length, `${key} length`);
  const selected = stamps.flatMap((stamp, index) => stamp >= start && stamp < end ? [index] : []);
  const issues = [];
  const bars = [];
  if (selected.length !== 90) issues.push({ reason: 'minute_count', expected: 90, actual: selected.length });
  for (const [index, sourceIndex] of selected.entries()) {
    const stamp = stamps[sourceIndex];
    if (stamp !== start + index * 60) issues.push({ reason: 'minute_grid', time: localTime(stamp), sourceIndex });
    const fields = Object.fromEntries(['open', 'high', 'low', 'close', 'volume'].map(key => [key, quote[key][sourceIndex]]));
    const invalid = Object.entries(fields).filter(([key, value]) => !Number.isFinite(value) || (key === 'volume' ? value < 0 : value <= 0)).map(([key]) => key);
    if (invalid.length) { issues.push({ reason: 'missing_or_invalid_raw_value', time: localTime(stamp), sourceIndex, fields: invalid }); continue; }
    const { open: o, high: h, low: l, close: c, volume: v } = fields;
    if (l > Math.min(o, c) || h < Math.max(o, c) || l > h) {
      issues.push({ reason: 'invalid_ohlc_envelope', time: localTime(stamp), sourceIndex }); continue;
    }
    bars.push({ t: stamp - start, o, h, l, c, v });
  }
  if (issues.length) throw new MinuteCoverageError(issues);
  return { bars, audit: { code, date, bars: bars.length, firstMinute: '09:00', lastMinute: '10:29', revealedThrough: '10:30',
    sourceFirstRow: selected[0], sourceLastRow: selected.at(-1), ignoredOutsideWindow: stamps.length - selected.length,
    zeroVolumeBars: bars.filter(bar => bar.v === 0).length, sourceSha256: request.sha256, sourceUrl: request.url,
    sourcePath: request.path, fetchedAt: request.fetchedAt } };
}

function rocDate(value) {
  const match = typeof value === 'string' && /^(\d{3})\/(\d{2})\/(\d{2})$/.exec(value.trim());
  assert.ok(match, 'Official trading date');
  const date = `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
  assert.ok(validDate(date));
  return date;
}
/** Official completed daily closes, located by header name and restricted strictly before the lesson date. */
export function normalizeExpansionDaily(bytes, request, code) {
  assert.equal(digest(bytes), request.sha256, 'Daily raw SHA-256');
  assert.equal(request.status, 200);
  const url = new URL(request.url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'www.twse.com.tw');
  assert.equal(url.username + url.password + url.hash, '');
  assert.equal(url.searchParams.get('stockNo'), code);
  assert.ok(Number.isFinite(Date.parse(request.fetchedAt)), 'Official daily fetch timestamp');
  const raw = JSON.parse(bytes.toString('utf8'));
  assert.equal(raw.stat, 'OK');
  assert.equal(raw.date, url.searchParams.get('date'));
  assert.ok(typeof raw.title === 'string' && new RegExp(`(?:^|\\s)${code}(?:\\s|$)`).test(raw.title), 'Official symbol title');
  assert.ok(Array.isArray(raw.fields) && Array.isArray(raw.data));
  const dateColumn = raw.fields.indexOf('日期');
  const closeColumn = raw.fields.indexOf('收盤價');
  assert.ok(dateColumn >= 0 && closeColumn >= 0 && new Set(raw.fields).size === raw.fields.length, 'Unique official daily column names');
  return raw.data.map((row, sourceRow) => {
    const date = rocDate(row[dateColumn]);
    assert.equal(date.slice(0, 7).replace('-', ''), raw.date.slice(0, 6), 'Official row month');
    const text = typeof row[closeColumn] === 'string' ? row[closeColumn].trim().replaceAll(',', '') : '';
    const close = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
    return { code, date, close, sourceRow, sourcePath: request.path, sourceSha256: request.sha256, sourceUrl: request.url, fetchedAt: request.fetchedAt };
  });
}
export function previousFiveCloses(rows, code, date) {
  const previous = rows.filter(row => row.code === code && row.date < date).sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(new Set(previous.map(row => row.date)).size, previous.length, 'Duplicate official prior trading day');
  const selected = previous.slice(-5);
  assert.deepEqual(selected.map(row => row.date), previousDates[date], 'Exact five completed trading days required');
  assert.ok(selected.every(row => Number.isFinite(row.close) && row.close > 0), 'Missing prior daily close');
  return selected;
}

export function buildMorningExpansion(root = workspace) {
  assert.equal(digest(readFileSync(resolve(root, 'server/data/morning-2026-10-06.json'))), preservedLessonSha256, 'Existing 10/06 lesson bytes must remain unchanged');
  const oldIntraday = 'research/daily-market/2026-10-06-collection/intraday';
  const oldDaily = 'research/daily-market/2026-10-06-strategy-supplement/daily-prices';
  const minuteManifest = json(root, `${oldIntraday}/requests.json`);
  const newManifest = json(root, `${expansionDirectory}/requests.json`);
  const dailyManifest = json(root, `${oldDaily}/manifest.json`);
  assert.equal(newManifest.date, '2026-10-07');
  assert.equal(newManifest.attempts.length, 5, 'Exactly five bounded source requests');
  const allDaily = [];
  for (const code of expansionCodes) for (const month of ['2026-09', '2026-10']) {
    const matches = dailyManifest.requests.filter(item => item.symbol === code && item.month === month);
    assert.equal(matches.length, 1);
    const item = matches[0];
    const request = { path: `${oldDaily}/${item.rawFile}`, sha256: item.rawSha256, url: item.url,
      status: item.httpStatus ?? item.originalHttpStatus, fetchedAt: item.completedAt ?? item.originalRetrievedAt };
    allDaily.push(...normalizeExpansionDaily(evidenceBytes(root, request.path, request.sha256), request, code));
  }
  const datasets = [];
  const lessons = [];
  for (const date of expansionDates) {
    const bars = {};
    const sources = [];
    const failures = [];
    const references = expansionCodes.flatMap(code => previousFiveCloses(allDaily, code, date));
    for (const code of expansionCodes) {
      const records = date === '2026-10-07'
        ? newManifest.attempts.filter(item => item.code === code)
        : minuteManifest.attempts.filter(item => item.id === `yahoo-${code}-7d-1m`);
      assert.equal(records.length, 1, 'One recorded minute request per symbol');
      const item = records[0];
      const request = { path: `${date === '2026-10-07' ? expansionDirectory : oldIntraday}/${item.rawFile}`,
        sha256: item.sha256, url: item.url, status: item.status ?? item.httpStatus, fetchedAt: item.fetchedAt ?? item.completedAt };
      try {
        const normalized = normalizeExpansionMinute(evidenceBytes(root, request.path, request.sha256), request, code, date);
        bars[code] = normalized.bars;
        sources.push(normalized.audit);
      } catch (error) {
        if (!(error instanceof MinuteCoverageError)) throw error;
        failures.push({ code, date, sourcePath: request.path, sourceSha256: request.sha256, sourceUrl: request.url,
          fetchedAt: request.fetchedAt, issues: error.issues });
      }
    }
    if (failures.length) {
      lessons.push({ date, status: 'unavailable', serverPath: null, reason: 'Incomplete original five-stock minute source; no server dataset generated',
        completeSymbols: sources.map(source => source.code), failedSymbols: failures, priorDailyReferences: references });
      continue;
    }
    const minuteHash = digest(JSON.stringify({ date, sources, bars }));
    const dailyHash = digest(JSON.stringify(references));
    const sourceHash = digest(JSON.stringify({ version: 1, date, minuteHash, dailyHash }));
    const symbols = expansionCodes.map(code => {
      const previous = references.filter(row => row.code === code);
      return { code, name: names[code], previousClose: previous.at(-1).close,
        previous5CloseMean: previous.reduce((sum, row) => sum + row.close, 0) / 5 };
    });
    const catalog = {
      lessonId: `morning-${date.replaceAll('-', '')}-v1-${sourceHash.slice(0, 12)}`,
      title: '先寫計畫，再核對真實早盤', date, start: '09:00', end: '10:30', maxCursor: 90, symbols,
      context: [{ label: '當日盤前背景', value: '尚未取得可核對的當日國際指數、台指期夜盤、法人及融資融券教材。',
        asOf: `${date}：背景缺資料；未引用其他日期背景` }],
      strategy: [
        '開始前寫下觀察標的、進場與停損條件；條件未到可以只觀察，不要求一定交易。',
        '主要練習 09:00–10:00，可延伸至 10:30；每分鐘完成後才揭露，結束不自動平倉。',
        '先核對已知價格與原計畫，沒有真實五檔、逐筆順序或未來走勢提示。',
        '前五個完整交易日收盤均值僅作歷史參考；EMA11 週期與計算口徑未確認，不自動加入訊號。',
      ],
      notices: [
        `價格來源：Yahoo Finance ${date} 歷史 1 分鐘原始 OHLC；每檔 09:00–10:29 共 90 根，最後一根於 10:30 可見。`,
        '當日盤前背景與影片尚未取得；不以其他日期內容冒充，也未驗證當時盤前可得性。',
        '昨收與前五個完整交易日收盤均值由保留的 TWSE 日資料核對，不使用 Yahoo 多日期回應的整段昨收欄位。',
        '分鐘量保留原值，零量不改寫；量單位與完整性尚未核對，不顯示量柱、VWAP 或量能訊號。',
        '紙上成交依下一分鐘開盤價模擬，不代表真實排隊、滑價、委託深度或券商成交。',
        '僅提供這份已保存的歷史教材，尚非每日自動更新、即時券商行情或真實下單。',
      ], videoUrl: null,
    };
    const sourcePaths = [...new Set([...sources.map(source => source.sourcePath), ...references.map(row => row.sourcePath)])];
    const dataset = { catalog, bars, provenance: {
      minuteSourceSha256: minuteHash, dailySourceSha256: dailyHash, sourceSha256: sourceHash,
      minuteSource: 'Yahoo Finance', dailySource: 'TWSE STOCK_DAY', volumeVerified: false,
      sourcePaths, sourceUrls: [...new Set([...sources.map(source => source.sourceUrl), ...references.map(row => row.sourceUrl)])],
      minuteSources: sources, priorDailyReferences: references,
      evidenceNote: 'Original Yahoo minute quote arrays and official prior daily closes; no independent official minute-by-minute verification.',
    } };
    const serverPath = `server/data/morning-${date}.json`;
    datasets.push({ serverPath, dataset });
    lessons.push({ date, status: 'ready', serverPath, lessonId: catalog.lessonId, minuteSourceSha256: minuteHash,
      dailySourceSha256: dailyHash, sourceSha256: sourceHash, bars: 450, symbols, minuteSources: sources,
      priorDailyReferences: references, datasetSha256: digest(`${JSON.stringify(dataset, null, 2)}\n`) });
  }
  return { datasets, report: { version: 1, availableDates: lessons.filter(lesson => lesson.status === 'ready').map(lesson => lesson.date),
    unavailableDates: lessons.filter(lesson => lesson.status === 'unavailable').map(lesson => lesson.date), lessons,
    preservedExisting: { path: 'server/data/morning-2026-10-06.json', sha256: digest(readFileSync(resolve(root, 'server/data/morning-2026-10-06.json'))) },
    limitations: ['Source gaps reject the whole five-stock lesson; no interpolation, rounding, substituted OHLC or replacement symbols.',
      'Unverified minute volume stays hidden; daily prices do not authenticate each historical minute.',
      'Full private replay sources must not be copied into public assets or offline packages.'] } };
}

export function prepareMorningExpansion({ root = workspace, check = false } = {}) {
  const { datasets, report } = buildMorningExpansion(root);
  for (const date of report.unavailableDates)
    assert.equal(existsSync(resolve(root, `server/data/morning-${date}.json`)), false, `An unavailable lesson must not have a server dataset: ${date}`);
  const outputs = [...datasets.map(({ serverPath, dataset }) => [serverPath, dataset]), [`${expansionDirectory}/verification-report.json`, report]];
  for (const [path, value] of outputs) {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (check) assert.equal(readFileSync(resolve(root, path), 'utf8'), serialized, `${path}: differs from original source evidence`);
    else writeFileSync(resolve(root, path), serialized);
  }
  return { readyDates: report.availableDates, unavailableDates: report.unavailableDates, readyBars: datasets.length * 450, existingLessonPreserved: report.preservedExisting };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify({ check: process.argv.includes('--check'), ...prepareMorningExpansion({ check: process.argv.includes('--check') }) }));
