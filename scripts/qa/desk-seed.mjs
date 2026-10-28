// Disposable QA fixture only: start a plan on a daily lesson, buy two lots of 台積電, replay to 09:27.
// Usage: node scripts/qa/desk-seed.mjs <baseUrl> [defaults|hot] [lessonId]
//   defaults (the default): the day's default 自選 as the picker offers it (on the fixture's newest day, 10/27, the
//            63 practisable stocks of the 70-stock 當沖 list);
//   hot:     the five stocks the older desk QA was written for, in code order as the picker keeps them
//            (2308, 2317, 2330, 2382, 2454).
//   lessonId: e.g. fubon-20261021-am; without it the newest day. The 主角股 is 台積電 2330 either way. An unfinished
//            run of the owner on that day is given up first, so the run always starts at 09:00.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const [base = "http://127.0.0.1:18811", which = "defaults", lesson] = process.argv.slice(2);
const HOT = ["2308", "2317", "2330", "2382", "2454"];
const FOCUS = "2330";
const query = lesson ? `?lesson=${encodeURIComponent(lesson)}` : "";
async function call(action) {
  const response = await fetch(
    base + "/api/morning" + query,
    action
      ? {
          method: "POST",
          headers: { origin: base, "content-type": "application/json" },
          body: JSON.stringify({ ...action, requestId: randomUUID() }),
        }
      : {},
  );
  assert.equal(response.status, 200, `/api/morning ${action?.action ?? "GET"}: HTTP ${response.status}`);
  return response.json();
}
let data = await call();
assert.ok(!data.unavailable, `the classroom has no daily lessons: ${data.unavailable}`);
if (data.state && !data.state.completed) {
  await call({ action: "abandon", id: data.state.id, expectedRevision: data.state.revision });
  data = await call();
}
assert.ok(data.picker, "the day sent no picker");
const codes = which === "hot" ? HOT : data.picker.defaults;
assert.ok(codes.includes(FOCUS), `the ${which} list has no ${FOCUS}`);
data = await call({
  action: "start",
  codes,
  plan: {
    exerciseId: "first-order",
    focusCode: FOCUS,
    bias: "observe",
    reason: "驗收模擬下單與庫存平均成本顯示。",
    entry: "觀察開盤價格區間，核對條件後建立部位；每次一張，逐筆檢查成交。",
    stop: "完成隔離測試後停止。",
  },
});
assert.equal(data.state.cursor, 0, "the run did not start at 09:00");
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
    code: FOCUS,
    side: "buy",
    lots: 1,
  });
  await advance();
}
assert.equal(data.state.positions[0].shares, 2000);
while (data.state.cursor < 27) await advance();
console.log(JSON.stringify({ lesson: data.state.lessonId, stocks: data.state.codes.length, cursor: data.state.cursor, fills: data.state.fills.length }));
