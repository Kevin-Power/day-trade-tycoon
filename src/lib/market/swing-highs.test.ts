import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bar } from "../game/types.ts";
import { deriveSwingHighs } from "./swing-highs.ts";

function minuteBars(highs: readonly number[], start = 0): Bar[] {
  return highs.map((h, index) => ({ t: start + index * 60, o: h, h, l: h, c: h, v: 1 }));
}

test("a high confirms only after the second following minute has closed", () => {
  const bars = minuteBars([100, 101, 105, 103, 102]);
  assert.deepEqual(deriveSwingHighs(bars, 299, 0, 600), {
    confirmed: [],
    comparison: null,
    candidate: { t: 120, p: 105 },
  });
  assert.deepEqual(deriveSwingHighs(bars, 300, 0, 600), {
    confirmed: [{ t: 120, p: 105, confirmedAt: 300 }],
    comparison: null,
  });
});

test("future and current incomplete full bars cannot affect either confirmation or candidate", () => {
  const bars = minuteBars([100, 101, 105, 103, 102, 999, 1000]);
  const observed = deriveSwingHighs(bars.slice(0, 3), 215, 0, 600);
  assert.deepEqual(deriveSwingHighs(bars, 215, 0, 600), observed);
  assert.deepEqual(observed.candidate, { t: 120, p: 105 });
  const changedUnobserved = bars.map((bar, index) => ({ ...bar, h: index >= 3 ? 5000 : bar.h }));
  assert.deepEqual(deriveSwingHighs(changedUnobserved, 215, 0, 600), observed);
  assert.deepEqual(deriveSwingHighs(bars, 359, 0, 600), {
    confirmed: [{ t: 120, p: 105, confirmedAt: 300 }],
    comparison: null,
  });
});

test("equal-price plateaus remain unconfirmed observations", () => {
  const result = deriveSwingHighs(minuteBars([100, 102, 105, 105, 102, 100]), 360, 0, 600);
  assert.deepEqual(result, {
    confirmed: [],
    comparison: null,
    candidate: { t: 120, p: 105 },
  });
  assert.deepEqual(deriveSwingHighs(minuteBars([100, 100, 100, 100, 100]), 300, 0, 600), {
    confirmed: [],
    comparison: null,
  });
});

for (const [second, comparison] of [
  [108, "higher"],
  [104, "lower"],
  [106, "equal"],
] as const) {
  test(`two separated confirmed highs compare as ${comparison}`, () => {
    const bars = minuteBars([100, 102, 106, 102, 100, 102, second, 101, 100]);
    assert.deepEqual(deriveSwingHighs(bars, 540, 0, 600), {
      confirmed: [
        { t: 120, p: 106, confirmedAt: 300 },
        { t: 360, p: second, confirmedAt: 540 },
      ],
      comparison,
    });
  });
}

test("only the latest two confirmed highs are returned, independent of older peaks", () => {
  const bars = minuteBars([100, 101, 105, 102, 100, 101, 108, 101, 100, 102, 107, 101, 100]);
  assert.deepEqual(deriveSwingHighs(bars, 780, 0, 1200), {
    confirmed: [
      { t: 360, p: 108, confirmedAt: 540 },
      { t: 600, p: 107, confirmedAt: 780 },
    ],
    comparison: "lower",
  });
});

test("a single point and a descending sequence do not invent an opening candidate", () => {
  for (const highs of [[], [105], [105, 104, 103, 102, 101]]) {
    assert.deepEqual(deriveSwingHighs(minuteBars(highs), 300, 0, 600), {
      confirmed: [],
      comparison: null,
    });
  }
  assert.deepEqual(deriveSwingHighs(minuteBars([100, 101]), 120, 0, 600).candidate, {
    t: 60,
    p: 101,
  });
});

test("candidate needs rising evidence after the latest confirmed high and takes the highest observation", () => {
  const bars = minuteBars([100, 102, 110, 106, 102, 104, 108, 107]);
  assert.deepEqual(deriveSwingHighs(bars, 480, 0, 600), {
    confirmed: [{ t: 120, p: 110, confirmedAt: 300 }],
    comparison: null,
    candidate: { t: 360, p: 108 },
  });
});

test("warm-up minutes and incomplete end-of-session minutes cannot confirm lesson highs", () => {
  const bars = minuteBars([100, 101, 105, 102, 100]);
  assert.equal(deriveSwingHighs(bars, 600, 120, 600).confirmed.length, 0);
  assert.equal(deriveSwingHighs(bars, 600, 0, 299).confirmed.length, 0);
  assert.deepEqual(deriveSwingHighs(bars, 600, 0, 300).confirmed, [
    { t: 120, p: 105, confirmedAt: 300 },
  ]);
  assert.deepEqual(deriveSwingHighs(bars, -1, 0, 600), { confirmed: [], comparison: null });
});

test("missing and duplicate minute intervals cannot substitute for contiguous observations", () => {
  const bars = minuteBars([100, 101, 105, 102, 100]);
  const gap = bars.map((bar, index) => ({ ...bar, t: bar.t + (index >= 3 ? 60 : 0) }));
  assert.equal(deriveSwingHighs(gap, 600, 0, 600).confirmed.length, 0);
  assert.equal(deriveSwingHighs([...bars, { ...bars[1]! }], 600, 0, 600).confirmed.length, 0);
  assert.equal(
    deriveSwingHighs([{ ...bars[0]! }, { ...bars[1]!, t: 180 }], 600, 0, 600).candidate,
    undefined,
  );
});

test("invalid values fail closed without changing input arrays or bars", () => {
  const bars = minuteBars([100, 101, 105, 102, 100]);
  const reversed = [...bars].reverse();
  const snapshot = structuredClone(reversed);
  reversed.forEach(Object.freeze);
  Object.freeze(reversed);
  assert.deepEqual(deriveSwingHighs(reversed, 300, 0, 600).confirmed, [
    { t: 120, p: 105, confirmedAt: 300 },
  ]);
  assert.deepEqual(reversed, snapshot);
  assert.deepEqual(deriveSwingHighs(bars, NaN, 0, 600), { confirmed: [], comparison: null });
  assert.deepEqual(deriveSwingHighs(bars, 300, 600, 0), { confirmed: [], comparison: null });
  const invalid = bars.map((bar, index) => ({ ...bar, h: index === 1 ? NaN : bar.h }));
  assert.equal(deriveSwingHighs(invalid, 600, 0, 600).confirmed.length, 0);
});
