import assert from "node:assert/strict";
import test from "node:test";
import { gradeFor, GRADE_LADDER, SCENARIOS } from "./scenarios.ts";
import { DayMarket, DISCIPLINE_RULES, POSITION_CAP } from "../market/engine.ts";
import { LOT_SHARES } from "../market/ticks.ts";
import { LESSONS } from "./curriculum.ts";

/**
 * 教室在教紀律，評等就不能只看損益。這裡釘住的是「守紀律的小賠不會輸給
 * 亂做的大賺」這條線，以及每一課的預設標的學員買得起。
 */

const lesson1 = SCENARIOS.find((s) => s.id === "wed-open")!;

/** step() 每次最多推 8 秒，要走到收盤得反覆呼叫，跟畫面迴圈一樣。 */
function runToClose(m: DayMarket) {
  for (let i = 0; i < 100_000 && !m.ended; i++) m.step(8);
}

test("gradeFor 沒有交易就是觀盤", () => {
  assert.equal(gradeFor(0, 0, 0), "觀盤");
  assert.equal(gradeFor(5, 0, 0, 3), "觀盤");
});

test("全程沒違規升一級，有違規逐項降級", () => {
  // pnlPct 0.5 → 基準 B
  assert.equal(gradeFor(0.5, 3, 0.01, 0), "A");
  assert.equal(gradeFor(0.5, 3, 0.01, 1), "C");
  assert.equal(gradeFor(0.5, 3, 0.01, 2), "D");
  assert.equal(gradeFor(0.5, 3, 0.01, 3), "F");
  // 最多降三級，不會再往下溢位
  assert.equal(gradeFor(0.5, 3, 0.01, 99), "F");
});

test("守紀律的小賠，贏過違規累累的大賺", () => {
  const disciplinedLoss = gradeFor(-0.5, 2, 0.01, 0);
  const recklessWin = gradeFor(3, 20, 0.01, 3);
  assert.equal(disciplinedLoss, "C");
  assert.equal(recklessWin, "C");
  // 這是本次修正的重點：以前分別是 D 和 S。
  assert.ok(
    GRADE_LADDER.indexOf(disciplinedLoss) >= GRADE_LADDER.indexOf(recklessWin),
    "守紀律小賠不該低於亂做大賺",
  );
});

test("評等不會超出級距兩端", () => {
  for (const v of [0, 1, 2, 3, 10]) {
    for (const pct of [-9, -1, 0, 0.5, 1.5, 9]) {
      assert.ok(GRADE_LADDER.includes(gradeFor(pct, 1, 0.01, v) as never));
    }
  }
});

test("每一課的預設標的，一張都放得進權益三成", () => {
  for (const sc of SCENARIOS) {
    const m = new DayMarket(sc);
    const code = m.defaultFocus();
    const q = m.quote(code);
    assert.ok(q, `${sc.id} 找不到預設標的 ${code}`);
    const perLot = q!.last * LOT_SHARES;
    assert.ok(
      perLot <= sc.capital * POSITION_CAP + 1e-6,
      `${sc.id} 預設 ${code} 一張 ${perLot}，超過權益三成 ${sc.capital * POSITION_CAP}`,
    );
  }
});

test("第 1 課不會預設在買不起的台積電上", () => {
  const m = new DayMarket(lesson1);
  assert.notEqual(m.defaultFocus(), "2330");
  const tsmc = m.quote("2330")!;
  assert.ok(tsmc.last * LOT_SHARES > lesson1.capital, "前提變了：台積電已經買得起");
});

test("沒寫停損就進場，記一次六式 04", () => {
  const m = new DayMarket(lesson1);
  const code = m.defaultFocus();
  const res = m.place({ code, side: "buy", type: "market", lots: 1 });
  assert.equal(res.ok, true);
  assert.equal(m.discipline.noStop, 1);
  assert.equal(m.violations(), 1);
});

test("寫了停損就不記，且停損要站在虧損側", () => {
  const m = new DayMarket(lesson1);
  const code = m.defaultFocus();
  const px = m.quote(code)!.ask;
  const wrongSide = m.place({ code, side: "buy", type: "limit", lots: 1, price: px, stop: px * 1.02 });
  assert.equal(wrongSide.ok, false);
  assert.equal(m.violations(), 0, "被退件的單不該記違規");

  const ok = m.place({ code, side: "buy", type: "limit", lots: 1, price: px, stop: px * 0.98 });
  assert.equal(ok.ok, true);
  assert.equal(m.discipline.noStop, 0);
  assert.ok((m.stops.get(code) ?? 0) > 0);
});

test("虧損部位加碼記一次六式 03", () => {
  const m = new DayMarket(lesson1);
  const code = m.defaultFocus();
  const px = m.quote(code)!.ask;
  m.place({ code, side: "buy", type: "limit", lots: 1, price: px, stop: px * 0.98 });
  // 把持倉均價墊高到市價之上，下一筆加碼就是往虧損方向加。
  const pos = m.positions.get(code)!;
  pos.avg = m.quote(code)!.last * 1.05;
  m.place({ code, side: "buy", type: "market", lots: 1 });
  assert.equal(m.discipline.averageDown, 1);
});

test("收盤還要系統代平，記一次六式 06", () => {
  const m = new DayMarket(lesson1);
  const code = m.defaultFocus();
  const px = m.quote(code)!.ask;
  m.place({ code, side: "buy", type: "limit", lots: 1, price: px, stop: px * 0.98 });
  runToClose(m);
  assert.equal(m.ended, true);
  assert.equal(m.discipline.forcedClose, 1);
  assert.equal(m.openPositions().length, 0);
});

test("提前結算會真的平倉收盤，不是留著部位算帳面市值", () => {
  const m = new DayMarket(lesson1);
  const code = m.defaultFocus();
  const px = m.quote(code)!.ask;
  m.place({ code, side: "buy", type: "limit", lots: 1, price: px, stop: px * 0.98 });
  m.step(8);
  // step() 每次上限 8 秒，靠它快轉到收盤永遠到不了。
  m.step(m.endT - m.t + 1);
  assert.equal(m.ended, false, "前提變了：step 不再有 8 秒上限");
  m.endNow();
  assert.equal(m.ended, true);
  assert.equal(m.openPositions().length, 0, "提前結算後不該還有未平倉部位");
  assert.equal(m.discipline.forcedClose, 1);
});

test("自己平掉就不算被代平", () => {
  const m = new DayMarket(lesson1);
  const code = m.defaultFocus();
  const px = m.quote(code)!.ask;
  m.place({ code, side: "buy", type: "limit", lots: 1, price: px, stop: px * 0.98 });
  m.flatten(code);
  runToClose(m);
  assert.equal(m.discipline.forcedClose, 0);
});

test("部位歸零後停損跟著清掉，下次進場要重寫", () => {
  const m = new DayMarket(lesson1);
  const code = m.defaultFocus();
  const px = m.quote(code)!.ask;
  m.place({ code, side: "buy", type: "limit", lots: 1, price: px, stop: px * 0.98 });
  assert.ok(m.stops.has(code));
  m.flatten(code);
  m.step(2);
  assert.equal(m.stops.has(code), false);
  m.place({ code, side: "buy", type: "market", lots: 1 });
  assert.equal(m.discipline.noStop, 1);
});

test("觸及停損沒出場記一次六式 04，出場後不再累加", () => {
  // 先跑一趟找出這檔當天真的走過的低點，停損才擺得到一定會碰到的位置。
  const probe = new DayMarket(lesson1);
  const code = probe.defaultFocus();
  const entry = probe.quote(code)!.ask;
  runToClose(probe);
  const low = probe.quote(code)!.low;
  assert.ok(low < entry, "前提變了：這檔當天沒有跌破進場價，換一個情境");

  const m = new DayMarket(lesson1);
  const stop = (low + entry) / 2;
  const res = m.place({ code, side: "buy", type: "limit", lots: 1, price: entry, stop });
  assert.equal(res.ok, true);
  assert.equal(m.discipline.stopBreached, 0);

  for (let i = 0; i < 100_000 && !m.ended && m.discipline.stopBreached === 0; i++) m.step(8);
  assert.equal(m.discipline.stopBreached, 1, "跌破停損應該記一次");
  assert.ok(m.breachedStops.has(code));
  assert.match(m.warning ?? "", /停損/);

  // 同一段部位反覆進出停損區間，不該每秒重複扣分。
  const before = m.discipline.stopBreached;
  for (let i = 0; i < 200 && !m.ended; i++) m.step(8);
  assert.equal(m.discipline.stopBreached, before, "同一段部位只記一次");

  // 出場後警示清掉，停損也一併清掉。
  if (!m.ended) {
    m.flatten(code);
    m.step(2);
    assert.equal(m.breachedStops.has(code), false);
    assert.equal(m.stops.has(code), false);
  }
});

test("平倉單不會因為沒填停損被記違規", () => {
  const m = new DayMarket(lesson1);
  const code = m.defaultFocus();
  const px = m.quote(code)!.ask;
  m.place({ code, side: "buy", type: "limit", lots: 2, price: px, stop: px * 0.98 });
  assert.equal(m.discipline.noStop, 0);
  m.place({ code, side: "sell", type: "market", lots: 1 });
  assert.equal(m.discipline.noStop, 0, "減碼不是進場，不該要求停損");
  assert.equal(m.discipline.averageDown, 0);
});

test("每一條紀律規則都對得上六式其中一式", () => {
  const nos = new Set(["01", "02", "03", "04", "05", "06"]);
  for (const r of DISCIPLINE_RULES) {
    assert.ok(nos.has(r.principle), `${r.key} 對到不存在的第 ${r.principle} 式`);
    assert.ok(r.fix.length > 0, `${r.key} 沒有寫替代動作`);
  }
});

test("課程過關目標只能引用該盤跑得到的時間", () => {
  for (const sc of SCENARIOS) {
    const endMinute = sc.startMinute + sc.minutes;
    const clock = /(\d{1,2}):(\d{2})/g;
    for (const m of sc.objective.matchAll(clock)) {
      const minute = (Number(m[1]) - 9) * 60 + Number(m[2]);
      assert.ok(
        minute >= sc.startMinute && minute <= endMinute,
        `${sc.id} 的目標寫了 ${m[0]}，但這盤只跑 ${sc.startMinute}–${endMinute} 分`,
      );
    }
  }
});

test("每一課的課前準備都有東西可讀", () => {
  for (const l of LESSONS) {
    assert.ok(l.prep.length > 0, `${l.no} 沒有課前準備`);
  }
});
