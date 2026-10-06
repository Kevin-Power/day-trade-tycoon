import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(root, 'raw');
await mkdir(rawDir, { recursive: true });
if ((await readdir(rawDir)).length) throw new Error('Existing collection evidence found; use a new collection directory instead of overwriting raw responses.');
const attempts = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function request(id, source, url) {
  const startedAt = new Date().toISOString();
  const record = { id, source, method: 'GET', url, startedAt, authentication: 'none' };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const rawFile = `raw/${id}.response`;
    await writeFile(path.join(root, rawFile), bytes);
    Object.assign(record, {
      completedAt: new Date().toISOString(), httpStatus: response.status,
      responseUrl: response.url, contentType: response.headers.get('content-type'),
      responseDate: response.headers.get('date'), rawFile, bytes: bytes.length,
      sha256: sha256(bytes),
    });
    let data = null;
    try { data = JSON.parse(bytes.toString('utf8')); } catch {}
    attempts.push(record);
    console.log(JSON.stringify({ ...record, bodyPreview: bytes.toString('utf8').slice(0, 220) }));
    return { record, data };
  } catch (error) {
    Object.assign(record, { completedAt: new Date().toISOString(), error: error.message });
    attempts.push(record);
    console.log(JSON.stringify(record));
    return { record, data: null };
  }
}

const date = '2026-10-05';
for (const dataset of ['TaiwanStockKBar', 'TaiwanStockPriceTick']) {
  const params = new URLSearchParams({ dataset, data_id: '2330', start_date: date });
  await request(`finmind-${dataset}-${date}-2330`, 'FinMind', `https://api.finmindtrade.com/api/v4/data?${params}`);
}
const yahooResults = [];
for (const symbol of ['2330', '2317', '2454', '2382', '2308']) {
  const result = await request(`yahoo-${symbol}-7d-1m`, 'Yahoo Finance', `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.TW?range=7d&interval=1m&includePrePost=false`);
  yahooResults.push({ symbol, ...result });
  if ([401, 403, 429].includes(result.record.httpStatus)) break;
}
await writeFile(path.join(root, 'requests.json'), `${JSON.stringify({ collectedAt: new Date().toISOString(), attempts }, null, 2)}\n`);
const available = yahooResults.map(({ symbol, record, data }) => {
  const chart = data?.chart?.result?.[0];
  const timestamps = chart?.timestamp ?? [];
  const dates = [...new Set(timestamps.map(t => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t * 1000))))];
  return { symbol, httpStatus: record.httpStatus, timestamps: timestamps.length, dates, timezone: chart?.meta?.exchangeTimezoneName, granularity: chart?.meta?.dataGranularity, error: data?.chart?.error ?? null };
});
await writeFile(path.join(root, 'availability.json'), `${JSON.stringify(available, null, 2)}\n`);
console.log(JSON.stringify({ availability: available }));
