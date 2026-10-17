import test from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "../game/types.ts";
import { roundToTick } from "../market/ticks.ts";
import { DAILY_REASONS, dailyAnswerSchema, validateStop } from "./answer.ts";
import { suggestedStops } from "./pick.ts";

function questionAround(level: number) {
  const close = roundToTick(level * 0.998);
  const bars: Bar[] = [{ t: 0, o: close, h: close, l: close, c: close, v: 1 }, { t: 60, o: close, h: close, l: close, c: close, v: 1 }];
  const pullbackLow = roundToTick(level * 0.99);
  return { bars, questionT: 60, referencePrice: roundToTick(level * 0.97), stops: suggestedStops(level, pullbackLow, close) };
}

test("suggested stops always pass validation across tick bands", () => {
  for (const level of [9.98, 36.75, 49.95, 50, 99.9, 100, 499.5, 500, 999, 1000, 2590]) {
    const question = questionAround(level);
    for (const stop of [question.stops.pullback, question.stops.belowLevel])
      assert.equal(validateStop(question, "enter", stop), null, `${level} ${stop}`);
  }
});

test("entering needs a stop; watching or skipping must not carry one", () => {
  const question = questionAround(100);
  assert.equal(validateStop(question, "enter", undefined), "選進場要先設停損");
  assert.equal(validateStop(question, "watch", 99), "觀望或不追不需要停損");
  assert.equal(validateStop(question, "skip", undefined), null);
});

test("a stop at or above the current price, off tick, or under limit down is refused", () => {
  const question = questionAround(100); // close 99.8, reference 97, limit down 87.3
  const message = "停損要是合法價位，並且低於目前價格";
  assert.equal(validateStop(question, "enter", 99.8), message);
  assert.equal(validateStop(question, "enter", 99.73), message);
  assert.equal(validateStop(question, "enter", 80), message);
  assert.equal(validateStop(question, "enter", 99.7), null);
});

test("the answer body is strict and reasons are the four fixed ones", () => {
  assert.deepEqual(DAILY_REASONS.map((reason) => reason.label), ["量能放大", "前高有賣壓", "大盤偏強", "看不清楚先等"]);
  assert.equal(dailyAnswerSchema.safeParse({ questionId: "2026-10-16", choice: "enter", stopPrice: 99, reason: "volume" }).success, true);
  assert.equal(dailyAnswerSchema.safeParse({ questionId: "2026-10-16", choice: "enter", extra: 1 }).success, false);
  assert.equal(dailyAnswerSchema.safeParse({ questionId: "../x", choice: "watch" }).success, false);
  assert.equal(dailyAnswerSchema.safeParse({ questionId: "2026-10-16", choice: "watch", reason: "luck" }).success, false);
  assert.equal(dailyAnswerSchema.safeParse({ questionId: "2026-10-16", choice: "watch", guestTerms: true }).success, true);
});
