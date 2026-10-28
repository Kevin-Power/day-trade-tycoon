import test from "node:test";
import assert from "node:assert/strict";
import { MAX_RUN_CODES, chooseDefaultCodes, defaultNote } from "./default-codes.ts";
import type { RadarList } from "./types.ts";

const NO_LIST_TITLE = "前一交易日沒有熱門當沖名單，改用成交值前 5 名";

function listOf(date: string, codes: string[]): RadarList {
  return { date, symbols: codes.map((code) => ({ code, name: `名${code}` })) };
}

type Input = Parameters<typeof chooseDefaultCodes>[0];
function input(overrides: Partial<Input> = {}): Input {
  return {
    lessonDate: "2026-10-28",
    fullMarketDays: ["2026-10-27", "2026-10-28"],
    radar: listOf("2026-10-27", ["2330", "2317"]),
    practisable: new Set(["2330", "2317", "2454", "1101", "2603", "2002"]),
    otc: new Set(["6488"]),
    top5: ["2603", "2330", "2317", "2454", "1101"],
    guest: false,
    ...overrides,
  };
}

test("MAX_RUN_CODES is 80", () => {
  assert.equal(MAX_RUN_CODES, 80);
});

test("a fresh list: radar basis with the codes sorted by code, and the list date", () => {
  const choice = chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["2330", "1101", "2317"]) }));
  assert.deepEqual(choice, {
    basis: "radar",
    radarDate: "2026-10-27",
    codes: ["1101", "2317", "2330"],
    counts: { listed: 3, otc: 0, missing: 0 },
  });
});

test("guest comes first: top 5 sorted by code, no radarDate and no counts, even with a fresh list", () => {
  const choice = chooseDefaultCodes(input({ guest: true }));
  assert.deepEqual(choice, { basis: "top5", reason: "guest", codes: ["1101", "2317", "2330", "2454", "2603"] });
  assert.equal("radarDate" in choice, false);
  assert.equal("counts" in choice, false);
});

test("guest never looks at the list: a throwing getter on it is never touched", () => {
  const radar = new Proxy({ date: "2026-10-27", symbols: [] } as RadarList, {
    get() {
      throw new Error("the guest path read the list");
    },
  });
  assert.equal(chooseDefaultCodes(input({ guest: true, radar })).basis, "top5");
});

test("no list at all: top5 / no-list, sorted, no counts", () => {
  const choice = chooseDefaultCodes(input({ radar: null }));
  assert.deepEqual(choice, { basis: "top5", reason: "no-list", codes: ["1101", "2317", "2330", "2454", "2603"] });
  assert.equal("counts" in choice, false);
});

test("list dated the lesson day or later counts as no list", () => {
  const same = chooseDefaultCodes(input({ radar: listOf("2026-10-28", ["2330"]) }));
  assert.equal(same.basis, "top5");
  assert.equal(same.basis === "top5" && same.reason, "no-list");
  const later = chooseDefaultCodes(input({ radar: listOf("2026-10-29", ["2330"]) }));
  assert.equal(later.basis, "top5");
  assert.equal(later.basis === "top5" && later.reason, "no-list");
});

test("stale: another full-market day sits between the list and the lesson", () => {
  const choice = chooseDefaultCodes(
    input({
      lessonDate: "2026-10-27",
      radar: listOf("2026-10-21", ["2330"]),
      fullMarketDays: ["2026-10-21", "2026-10-22", "2026-10-27"],
    }),
  );
  assert.deepEqual(choice, { basis: "top5", reason: "stale", codes: ["1101", "2317", "2330", "2454", "2603"] });
});

test("closed days in between do not make the list stale (typhoon 10/23, holiday 10/26)", () => {
  const choice = chooseDefaultCodes(
    input({
      lessonDate: "2026-10-27",
      radar: listOf("2026-10-22", ["2330", "2317"]),
      fullMarketDays: ["2026-10-21", "2026-10-22", "2026-10-27"],
    }),
  );
  assert.equal(choice.basis, "radar");
  assert.equal(choice.basis === "radar" && choice.radarDate, "2026-10-22");
});

test("the list day itself and the lesson day in fullMarketDays are not 'in between'", () => {
  const choice = chooseDefaultCodes(input({ fullMarketDays: ["2026-10-27", "2026-10-28"] }));
  assert.equal(choice.basis, "radar");
});

test("a full-market day after the lesson day is not in between", () => {
  const choice = chooseDefaultCodes(input({ fullMarketDays: ["2026-10-27", "2026-10-28", "2026-10-29"] }));
  assert.equal(choice.basis, "radar");
});

test("duplicates keep the first occurrence and count once", () => {
  const choice = chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["2330", "2317", "2330", "2330", "2317"]) }));
  assert.deepEqual(choice, {
    basis: "radar",
    radarDate: "2026-10-27",
    codes: ["2317", "2330"],
    counts: { listed: 2, otc: 0, missing: 0 },
  });
});

test("counts: OTC stocks, and stocks with no practice data (including codes the catalogue does not know)", () => {
  const choice = chooseDefaultCodes(
    input({ radar: listOf("2026-10-27", ["2330", "6488", "8888", "9999", "2317", "6488"]) }),
  );
  // 6488 is OTC (counted once), 8888 and 9999 are neither OTC nor practisable
  assert.deepEqual(choice, {
    basis: "radar",
    radarDate: "2026-10-27",
    codes: ["2317", "2330"],
    counts: { listed: 5, otc: 1, missing: 2 },
  });
});

test("an OTC code is never counted as missing", () => {
  const choice = chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["2330", "6488"]) }));
  assert.deepEqual(choice.basis === "radar" && choice.counts, { listed: 2, otc: 1, missing: 0 });
});

test("codes are capped at 80, smallest codes first", () => {
  const codes = Array.from({ length: 100 }, (_, index) => String(1000 + index));
  const practisable = new Set(codes);
  const choice = chooseDefaultCodes(input({ radar: listOf("2026-10-27", [...codes].reverse()), practisable }));
  assert.equal(choice.basis, "radar");
  if (choice.basis !== "radar") return;
  assert.equal(choice.codes.length, MAX_RUN_CODES);
  assert.equal(choice.codes[0], "1000");
  assert.equal(choice.codes[79], "1079");
  assert.deepEqual(choice.counts, { listed: 100, otc: 0, missing: 0 });
});

test("nothing practisable left: top5 / empty, with the counts", () => {
  const choice = chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["6488", "8888", "9999"]) }));
  assert.deepEqual(choice, {
    basis: "top5",
    reason: "empty",
    codes: ["1101", "2317", "2330", "2454", "2603"],
    counts: { listed: 3, otc: 1, missing: 2 },
  });
});

test("a list with no symbols is empty too", () => {
  const choice = chooseDefaultCodes(input({ radar: listOf("2026-10-27", []) }));
  assert.deepEqual(choice, {
    basis: "top5",
    reason: "empty",
    codes: ["1101", "2317", "2330", "2454", "2603"],
    counts: { listed: 0, otc: 0, missing: 0 },
  });
});

test("the caller's top5 array is not reordered", () => {
  const top5 = ["2603", "2330", "2317", "2454", "1101"];
  chooseDefaultCodes(input({ radar: null, top5 }));
  assert.deepEqual(top5, ["2603", "2330", "2317", "2454", "1101"]);
});

test("note, radar: the date is MM/DD with zero padding, detail is null when nothing was left out", () => {
  const note = defaultNote(chooseDefaultCodes(input()));
  assert.deepEqual(note, { title: "預設：前一交易日熱門當沖股（10/27 盤後）", detail: null });
  const padded = defaultNote(
    chooseDefaultCodes(input({ lessonDate: "2026-02-04", radar: listOf("2026-02-03", ["2330"]), fullMarketDays: [] })),
  );
  assert.equal(padded.title, "預設：前一交易日熱門當沖股（02/03 盤後）");
});

test("note, radar: detail with only OTC", () => {
  const note = defaultNote(chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["2330", "2317", "6488"]) })));
  assert.deepEqual(note, {
    title: "預設：前一交易日熱門當沖股（10/27 盤後）",
    detail: "名單 3 檔：上櫃 1 檔不在教材範圍",
  });
});

test("note, radar: detail with only missing data", () => {
  const note = defaultNote(chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["2330", "2317", "8888", "9999"]) })));
  assert.deepEqual(note, {
    title: "預設：前一交易日熱門當沖股（10/27 盤後）",
    detail: "名單 4 檔：另 2 檔這天沒有可練習的資料",
  });
});

test("note, radar: detail with both", () => {
  const note = defaultNote(
    chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["2330", "2317", "6488", "8888", "9999", "7777"]) })),
  );
  assert.deepEqual(note, {
    title: "預設：前一交易日熱門當沖股（10/27 盤後）",
    detail: "名單 6 檔：上櫃 1 檔不在教材範圍，另 3 檔這天沒有可練習的資料",
  });
});

test("note, no-list and stale: the fallback title, no detail", () => {
  const noList = defaultNote(chooseDefaultCodes(input({ radar: null })));
  assert.deepEqual(noList, { title: NO_LIST_TITLE, detail: null });
  const stale = defaultNote(
    chooseDefaultCodes(input({ lessonDate: "2026-10-27", radar: listOf("2026-10-21", ["2330"]), fullMarketDays: ["2026-10-22"] })),
  );
  assert.deepEqual(stale, { title: NO_LIST_TITLE, detail: null });
});

test("note, empty: the fallback title and the detail that says why", () => {
  const onlyOtc = defaultNote(chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["6488"]) })));
  assert.deepEqual(onlyOtc, { title: NO_LIST_TITLE, detail: "名單 1 檔：上櫃 1 檔不在教材範圍" });
  const mixed = defaultNote(chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["6488", "8888", "9999"]) })));
  assert.deepEqual(mixed, {
    title: NO_LIST_TITLE,
    detail: "名單 3 檔：上櫃 1 檔不在教材範圍，另 2 檔這天沒有可練習的資料",
  });
  const missingOnly = defaultNote(chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["8888"]) })));
  assert.deepEqual(missingOnly, { title: NO_LIST_TITLE, detail: "名單 1 檔：另 1 檔這天沒有可練習的資料" });
});

test("note, empty list with no symbols: just the list size", () => {
  const note = defaultNote(chooseDefaultCodes(input({ radar: listOf("2026-10-27", []) })));
  assert.deepEqual(note, { title: NO_LIST_TITLE, detail: "名單 0 檔" });
});

test("note, guest: its own title, no detail", () => {
  const note = defaultNote(chooseDefaultCodes(input({ guest: true })));
  assert.deepEqual(note, { title: "預設：成交值前 5 名", detail: null });
});

test("no text promises or ranks: no 推薦 / 勝率 / 漲停雷達 / score in any note", () => {
  const choices = [
    chooseDefaultCodes(input()),
    chooseDefaultCodes(input({ radar: listOf("2026-10-27", ["6488", "8888"]) })),
    chooseDefaultCodes(input({ radar: null })),
    chooseDefaultCodes(input({ guest: true })),
  ];
  for (const choice of choices) {
    const note = defaultNote(choice);
    const text = `${note.title}${note.detail ?? ""}`;
    assert.doesNotMatch(text, /推薦|勝率|漲停雷達|分數|等級/);
  }
});
