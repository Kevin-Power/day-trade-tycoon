import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTwseIndex5s, taiexMinuteBars } from "./taiex-minutes.mjs";

const raw = (day) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../research/daily-market/2026-10-06-collection/taiwan/raw/twse-index5s-${day}.json`, import.meta.url),
      ),
      "utf8",
    ),
  );
const ohlc = ({ t, o, h, l, c }) => ({ t, o, h, l, c });

test("10/06: 90 bars of 12 real points, the 09:00:00 placeholder left out", () => {
  const bars = taiexMinuteBars(parseTwseIndex5s(raw("20261006")), { previousClose: 49712.04, minutes: 90 });
  assert.equal(bars.length, 90);
  assert.ok(bars.every((bar) => bar.p.length === 12));
  assert.deepEqual(ohlc(bars[0]), { t: 0, o: 49736.37, h: 49932.26, l: 49736.37, c: 49932.26 });
  assert.equal(bars[0].p[0], 49736.37);
  assert.equal(bars[0].p[11], 49932.26);
  assert.deepEqual(ohlc(bars[1]), { t: 60, o: 49933.58, h: 49968.92, l: 49884.75, c: 49966.88 });
  assert.deepEqual(ohlc(bars[89]), { t: 5340, o: 49611.45, h: 49639.18, l: 49589.01, c: 49590.16 });
  for (const bar of bars) {
    assert.equal(bar.o, bar.p[0]);
    assert.equal(bar.c, bar.p[11]);
    assert.equal(bar.h, Math.max(...bar.p));
    assert.equal(bar.l, Math.min(...bar.p));
  }
});

test("10/05: the open is 09:00:05 (48,574.95), never the 48,475.74 placeholder", () => {
  const bars = taiexMinuteBars(parseTwseIndex5s(raw("20261005")), { previousClose: 48475.74, minutes: 90 });
  assert.deepEqual(ohlc(bars[0]), { t: 0, o: 48574.95, h: 49441.55, l: 48574.95, c: 49441.55 });
  assert.equal(Math.min(...bars.map((bar) => bar.l)), 48574.95);
  assert.deepEqual(ohlc(bars[89]), { t: 5340, o: 49735.16, h: 49739.19, l: 49687.69, c: 49739.19 });
});

test("parse: 3,241 points 09:00:00–13:30:00 every 5 seconds", () => {
  for (const day of ["20261005", "20261006"]) {
    const points = parseTwseIndex5s(raw(day));
    assert.equal(points.length, 3241);
    assert.equal(points[0].time, "09:00:00");
    assert.equal(points.at(-1).time, "13:30:00");
  }
});

test("the first point must equal the previous close, or the file is not the expected kind", () => {
  assert.throws(() => taiexMinuteBars(parseTwseIndex5s(raw("20261006")), { previousClose: 1, minutes: 90 }));
});

test("a missing 5-second point is refused", () => {
  const points = parseTwseIndex5s(raw("20261006"));
  points.splice(500, 1);
  assert.throws(() => taiexMinuteBars(points, { previousClose: 49712.04, minutes: 90 }));
});
