import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
await fs.mkdir(path.join(base, 'raw'), { recursive: true });
const requests = [
  ['twse-foreign-20261005', 'https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&dayDate=20261005&type=day'],
  ['twse-margin-20261005', 'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=20261005&selectType=MS'],
  ['twse-index5s-20261005', 'https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?response=json&date=20261005'],
  ['twse-indexdaily-202610', 'https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json&date=20261005'],
  ['taifex-api-schema', 'https://openapi.taifex.com.tw/swagger.json'],
  ['taifex-contracts-20261005', 'https://www.taifex.com.tw/cht/3/futContractsDate?queryDate=2026%2F10%2F05'],
];
const attempts = await Promise.all(requests.map(async ([id, url]) => {
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(22000), headers: { Accept: 'application/json,text/html;q=0.9', 'User-Agent': 'DayTradeTycoon-Research/1.0' } });
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type');
    let parsed = null;
    try { parsed = JSON.parse(bytes.toString('utf8')); } catch {}
    const extension = parsed ? 'json' : 'html';
    const filename = `raw/${id}.${extension}`;
    await fs.writeFile(path.join(base, filename), bytes);
    const result = { id, url, finalUrl: response.url, fetchedAt, status: response.status, contentType, filename, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), stat: parsed?.stat ?? null, date: parsed?.date ?? null, title: parsed?.title ?? null, fields: parsed?.fields ?? null, rowCount: parsed?.data?.length ?? null };
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    const result = { id, url, fetchedAt, error: error.message, cause: error.cause?.message ?? null };
    console.log(JSON.stringify(result));
    return result;
  }
}));
await fs.writeFile(path.join(base, 'collection-attempts.json'), JSON.stringify({ timezone: 'Asia/Taipei', intendedDataDate: '2026-10-05', intendedLessonDate: null, classroomUseApproved: false, attempts }, null, 2) + '\n');
