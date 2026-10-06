import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const base = path.dirname(fileURLToPath(import.meta.url));
const requests = [
 ['taifex-market-latest', 'https://openapi.taifex.com.tw/v1/DailyMarketReportFut'],
 ['taifex-contracts-20261002', 'https://www.taifex.com.tw/cht/3/futContractsDate?queryDate=2026%2F10%2F02'],
 ['twse-index5s-20261006', 'https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?response=json&date=20261006'],
];
const attempts = await Promise.all(requests.map(async ([id, url]) => {
 const fetchedAt = new Date().toISOString();
 try {
  const response = await fetch(url, {signal: AbortSignal.timeout(22000), headers: {Accept:'application/json,text/html;q=0.9','User-Agent':'DayTradeTycoon-Research/1.0'}});
  const bytes = Buffer.from(await response.arrayBuffer());
  let parsed = null; try {parsed=JSON.parse(bytes.toString('utf8'));} catch {}
  const filename=`raw/${id}.${parsed?'json':'html'}`;
  await fs.writeFile(path.join(base,filename),bytes);
  const result={id,url,finalUrl:response.url,fetchedAt,status:response.status,contentType:response.headers.get('content-type'),filename,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),stat:parsed?.stat??null,date:parsed?.date??null,title:parsed?.title??null,rowCount:Array.isArray(parsed)?parsed.length:parsed?.data?.length??null};
  console.log(JSON.stringify(result));
  if(Array.isArray(parsed)) console.log(JSON.stringify(parsed.filter(x=>x.Contract==='TX').slice(0,12)));
  return result;
 } catch(error) {const result={id,url,fetchedAt,error:error.message}; console.log(JSON.stringify(result)); return result;}
}));
await fs.writeFile(path.join(base,'extra-attempts.json'),JSON.stringify({attempts},null,2)+'\n');
