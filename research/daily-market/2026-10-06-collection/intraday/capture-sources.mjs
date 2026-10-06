import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root, 'sources'), { recursive: true });
const pages = [
  ['fubon-historical-candles', 'https://www.fbs.com.tw/TradeAPI/docs/market-data/http-api/historical/candles/'],
  ['fubon-intraday-candles', 'https://www.fbs.com.tw/TradeAPI/docs/market-data/http-api/intraday/candles/'],
  ['fubon-intraday-trades', 'https://www.fbs.com.tw/TradeAPI/docs/market-data/http-api/intraday/trades/'],
  ['fubon-prepare', 'https://www.fbs.com.tw/TradeAPI/docs/trading/prepare/'],
  ['finmind-technical', 'https://finmind.github.io/tutor/TaiwanMarket/Technical/'],
  ['yahoo-chart-intervals', 'https://help.yahoo.com/kb/period-scale-screen-charts-yahoo-finance-sln29029.html'],
  ['yahoo-historical-download', 'https://help.yahoo.com/kb/finance/certain-amounts-sln2311.html'],
];
const records = [];
for (const [id, url] of pages) {
  const record = { id, url, startedAt: new Date().toISOString(), purpose: 'documentation evidence, not market data' };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const file = `sources/${id}.html`;
    await writeFile(path.join(root, file), bytes);
    Object.assign(record, { completedAt: new Date().toISOString(), status: response.status, responseUrl: response.url, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  } catch (error) { Object.assign(record, { completedAt: new Date().toISOString(), error: error.message }); }
  records.push(record);
}
await writeFile(path.join(root, 'source-snapshots.json'), `${JSON.stringify(records, null, 2)}\n`);
console.log(JSON.stringify(records.map(({ id, status, bytes, error }) => ({ id, status, bytes, error }))));
