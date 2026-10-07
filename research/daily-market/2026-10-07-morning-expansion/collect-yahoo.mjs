import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(root, 'requests.json');
if (existsSync(manifestPath)) throw new Error('Existing request evidence must not be overwritten or retried automatically.');
mkdirSync(resolve(root, 'raw'), { recursive: true });
const date = '2026-10-07';
const period1 = Date.parse(`${date}T09:00:00+08:00`) / 1000;
const period2 = Date.parse(`${date}T10:30:00+08:00`) / 1000;
const manifest = { schemaVersion: 1, date, timezone: 'Asia/Taipei', window: { start: '09:00', endExclusive: '10:30' },
  requestLimit: 5, retries: 0, authentication: 'none', attempts: [] };
// Exactly one bounded request per explicitly selected symbol; no exchange/broker endpoint.
for (const code of ['2330', '2317', '2454', '2382', '2308']) {
  const rawFile = `raw/yahoo-${code}-${date}-1m.response`;
  const path = resolve(root, rawFile);
  if (existsSync(path)) throw new Error('Existing raw evidence must not be overwritten.');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.TW?period1=${period1}&period2=${period2}&interval=1m&includePrePost=false`;
  const attempt = { code, symbol: `${code}.TW`, interval: '1m', url, startedAt: new Date().toISOString() };
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2_000_000) throw new Error('Unexpectedly large source response');
    writeFileSync(path, bytes, { flag: 'wx' });
    Object.assign(attempt, { status: response.status, responseUrl: response.url, fetchedAt: new Date().toISOString(),
      responseDate: response.headers.get('date'), contentType: response.headers.get('content-type'), rawFile,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  } catch (error) {
    Object.assign(attempt, { fetchedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'Source request failed' });
  }
  manifest.attempts.push(attempt);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ code, status: attempt.status ?? null, bytes: attempt.bytes ?? null, error: attempt.error ?? null }));
}
