// Disposable QA fixture only: start a plan, buy two lots, replay to 09:27.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:18811";
async function call(action) {
  const response = await fetch(
    base + "/api/morning",
    action
      ? {
          method: "POST",
          headers: { origin: base, "content-type": "application/json" },
          body: JSON.stringify({ ...action, requestId: randomUUID() }),
        }
      : {},
  );
  assert.equal(response.status, 200);
  return response.json();
}
let data = await call();
const code = data.catalog.symbols[0].code;
data = await call({
  action: "start",
  plan: {
    exerciseId: "first-order",
    focusCode: code,
    bias: "observe",
    reason: "驗收模擬下單與庫存平均成本顯示。",
    entry: "觀察開盤價格區間，核對條件後建立部位；每次一張，逐筆檢查成交。",
    stop: "完成隔離測試後停止。",
  },
});
async function advance() {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, data.state.nextAdvanceAt - Date.now()) + 30),
  );
  data = await call({ action: "advance", id: data.state.id, expectedRevision: data.state.revision });
}
await advance();
for (let i = 0; i < 2; i++) {
  data = await call({
    action: "order",
    id: data.state.id,
    expectedRevision: data.state.revision,
    code,
    side: "buy",
    lots: 1,
  });
  await advance();
}
assert.equal(data.state.positions[0].shares, 2000);
while (data.state.cursor < 27) await advance();
console.log(JSON.stringify({ cursor: data.state.cursor, fills: data.state.fills.length }));
