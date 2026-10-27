// Explicit read-only broker probe. It never imports an order adapter. The only
// injected failure disconnects THIS probe's socket, not another session.
import { FubonFeed } from '../src/lib/broker/fubon-feed.server.ts';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';
const feed = new FubonFeed({ enabled: true, verification: true,
  python: join(homedir(), 'YilutekServices/DayTradeTycoon/fetcher/.venv/Scripts/python.exe'),
  worker: resolve('tools/fubon-live/worker.py'), credentials: join(homedir(), '.fubon/credentials.local.py') });
const client = randomUUID();
const result = { startedAt: new Date().toISOString(), readOnly: true, initial: null, reconnected: null, transitions: [], passed: false };
let interrupted = false, lastState = '';
const until = Date.now() + 100000;
try {
  while (Date.now() < until) {
    const state = feed.touch(client, ['2330', '2317', '9999']);
    const key = `${state.state}:${state.generation}`;
    if (key !== lastState) {
      const entry = { state: state.state, generation: state.generation, reason: state.reason, at: new Date().toISOString() };
      result.transitions.push(entry); console.log(JSON.stringify(entry)); lastState = key;
    }
    if (state.state === 'stopped') break;
    const valid = state.rows.filter(r => r.symbol !== '9999');
    const invalid = state.rows.find(r => r.symbol === '9999');
    if (valid.every(r => r.acknowledged && r.tradeTime && r.bookTime) && invalid?.issue === 'SNAPSHOT_FAILED') {
      const evidence = { generation: state.generation, invalidSymbolIsolated: invalid.issue, rows: valid.map(r => ({ symbol: r.symbol,
        tradeTime: r.tradeTime, bookTime: r.bookTime, pricePresent: r.price !== null, bids: r.bids.length,
        asks: r.asks.length, tradeFresh: r.tradeFresh, issue: r.issue })) };
      if (!interrupted) {
        result.initial = evidence;
        interrupted = true;
        // TypeScript private field is inspected only by this local verification
        // script; no corresponding route or browser control exists.
        feed.child.stdin.write(JSON.stringify({ verifyDisconnect: true }) + '\n');
      } else if (state.generation > result.initial.generation) {
        result.reconnected = evidence; result.passed = valid.every(r => r.issue === null); break;
      }
    }
    await new Promise(done => setTimeout(done, 500));
  }
} finally {
  feed.close(); result.finishedAt = new Date().toISOString();
  writeFileSync(resolve('artifacts/fubon-live-probe-2026-10-23.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
